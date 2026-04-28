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

      // Poll for .mrsf.yaml config to be picked up by the watcher by
      // attempting add_comment and checking the result location. This
      // replaces the previous fixed-sleep approach.
      const reviewsDir = path.join(tmpDir, ".reviews");
      const sidecarPath = path.join(reviewsDir, "readme.md.review.yaml");
      const colocated = path.join(tmpDir, "readme.md.review.yaml");

      let found = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        // Clean up any prior attempt artifacts
        if (fs.existsSync(colocated)) fs.unlinkSync(colocated);
        if (fs.existsSync(sidecarPath)) fs.unlinkSync(sidecarPath);

        await nativePage.waitForTimeout(500);

        // Try adding a comment — the sidecar should land in .reviews/
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
        await nativePage.waitForTimeout(200);

        if (fs.existsSync(sidecarPath)) {
          found = true;
          break;
        }
      }

      // Verify: sidecar landed in .reviews/ directory
      expect(found, `sidecar should exist at ${sidecarPath} within 10s`).toBe(true);
      expect(fs.existsSync(reviewsDir)).toBe(true);
      expect(fs.existsSync(sidecarPath)).toBe(true);

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
