import { test, expect, setRootViaTest, waitForTauriEvent } from "./fixtures";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

test.describe("Native .mrsf.yaml config reload (full-stack watcher)", () => {
  // Listen-then-write pattern (issue #304 / FLAKE-1): register a Tauri event
  // listener for `sidecar-config-changed` BEFORE writing .mrsf.yaml, then
  // deterministically await the emit instead of polling get_sidecar_config.
  // Must run as a native E2E because it exercises real OS file events, the
  // Rust watcher's 300 ms debouncer, and the window-scoped Tauri IPC emit
  // path — none of which are present in the browser-mock layer.
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

      // Wait for the app to render the file. The markdown-viewer being
      // visible proves the workspace opened and the tree rendered, so the
      // watcher has been registered for this root via update_tree_watched_dirs
      // (from the frontend's useTreeWatcher hook).
      await expect(nativePage.locator(".markdown-viewer")).toBeVisible({ timeout: 10_000 });
      await expect(nativePage.locator(".markdown-viewer")).toContainText("Hello", {
        timeout: 5_000,
      });

      // Phase 1: register the listener BEFORE writing .mrsf.yaml. The helper
      // returns a Promise that resolves when the watcher emits the
      // window-scoped `sidecar-config-changed` event (or rejects on timeout).
      const eventPromise = waitForTauriEvent<{ path: string }>(
        nativePage,
        "sidecar-config-changed",
        10_000,
      );

      // Phase 2: drop .mrsf.yaml — the watcher's 300 ms debouncer detects
      // the create, reloads the config, and emits sidecar-config-changed.
      fs.writeFileSync(
        path.join(tmpDir, ".mrsf.yaml"),
        "sidecar_root: .reviews\n",
      );

      // Phase 3: deterministic await — fail loudly if no event arrives.
      // If the watcher or emit_config_changed regresses, this rejects at
      // 10 s with `timeout waiting for sidecar-config-changed`.
      const payload = await eventPromise;
      expect(payload.path).toBe(tmpDir);

      // Phase 4: verify cache state via the IPC oracle.
      const cached = await nativePage.evaluate((root: string) => {
        // @ts-ignore — Tauri internals
        return window.__TAURI_INTERNALS__.invoke("get_sidecar_config", { root });
      }, tmpDir);
      expect((cached as { enabled: boolean }).enabled).toBe(true);

      // Phase 5: verify add_comment writes the sidecar into .reviews/.
      const reviewsDir = path.join(tmpDir, ".reviews");
      const sidecarPath = path.join(reviewsDir, "readme.md.review.yaml");
      const colocated = path.join(tmpDir, "readme.md.review.yaml");

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
