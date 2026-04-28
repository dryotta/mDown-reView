import { test, expect, setRootViaTest } from "./fixtures";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

test.describe("Native .mrsf.yaml config reload (full-stack watcher)", () => {
  test("29.1 - dropping .mrsf.yaml triggers config reload and redirects sidecar writes", async ({
    nativePage,
  }) => {
    const rawTmpDir = path.join(os.tmpdir(), `mdownreview-mrsf-${Date.now()}`);
    fs.mkdirSync(rawTmpDir, { recursive: true });
    // Canonicalize to resolve 8.3 short names on Windows CI (RUNNER~1 vs runneradmin)
    const tmpDir = fs.realpathSync(rawTmpDir);
    const docFile = path.join(tmpDir, "readme.md");
    fs.writeFileSync(docFile, "# Hello\n\nTest content for MRSF config reload.");

    try {
      await setRootViaTest(nativePage, tmpDir);

      // Wait for the app to render the file
      await expect(nativePage.locator(".markdown-viewer")).toBeVisible({ timeout: 10_000 });
      await expect(nativePage.locator(".markdown-viewer")).toContainText("Hello", {
        timeout: 5_000,
      });

      // Drop .mrsf.yaml — watcher should detect and reload config internally.
      // The watcher needs to have registered the workspace root first
      // (via update_tree_watched_dirs from the frontend's useTreeWatcher hook).
      // The markdown-viewer being visible proves the workspace opened and
      // the tree rendered, so the watcher should be watching by now.
      fs.writeFileSync(
        path.join(tmpDir, ".mrsf.yaml"),
        "sidecar_root: .reviews\n",
      );

      // Phase 1: Poll `get_sidecar_config` until the watcher picks up
      // .mrsf.yaml. This is deterministic (IPC query to the config cache)
      // and avoids relying on filesystem side-effects that are
      // timing-sensitive on slow CI runners.
      const MAX_CONFIG_POLLS = 60; // 60 × 500ms = 30s budget
      let configDetected = false;
      for (let i = 0; i < MAX_CONFIG_POLLS; i++) {
        await nativePage.waitForTimeout(500);
        const result = await nativePage.evaluate((root: string) => {
          // @ts-ignore — Tauri internals
          return window.__TAURI_INTERNALS__.invoke("get_sidecar_config", { root });
        }, tmpDir);
        if (result && (result as { enabled: boolean }).enabled) {
          configDetected = true;
          break;
        }
      }
      expect(
        configDetected,
        "get_sidecar_config should report enabled=true after watcher reloads .mrsf.yaml",
      ).toBe(true);

      // Phase 2: Config is confirmed loaded — verify add_comment writes
      // the sidecar into .reviews/.
      const reviewsDir = path.join(tmpDir, ".reviews");
      const sidecarPath = path.join(reviewsDir, "readme.md.review.yaml");
      const colocated = path.join(tmpDir, "readme.md.review.yaml");

      // Clean up any artifacts from Phase 1 probes (get_sidecar_config
      // doesn't write, but be safe).
      if (fs.existsSync(colocated)) fs.unlinkSync(colocated);
      if (fs.existsSync(sidecarPath)) fs.unlinkSync(sidecarPath);

      await nativePage.evaluate((fp: string) => {
        // @ts-ignore — Tauri internals
        return window.__TAURI_INTERNALS__.invoke("add_comment", {
          filePath: fp,
          author: "e2e-test",
          text: "Comment under sidecar_root",
          anchor: null,
          commentType: null,
          severity: null,
          document: null,
        });
      }, docFile);

      // Give the write a moment to flush
      await nativePage.waitForTimeout(500);

      // Verify: sidecar landed in .reviews/ directory
      expect(fs.existsSync(sidecarPath), `sidecar should exist at ${sidecarPath}`).toBe(true);
      expect(fs.existsSync(reviewsDir)).toBe(true);

      // Verify co-located sidecar was NOT created
      expect(
        fs.existsSync(colocated),
        "co-located sidecar should NOT exist when sidecar_root is configured",
      ).toBe(false);

      // Read sidecar and verify content
      const content = fs.readFileSync(sidecarPath, "utf-8");
      expect(content).toContain("Comment under sidecar_root");
      expect(content).toContain("e2e-test");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
