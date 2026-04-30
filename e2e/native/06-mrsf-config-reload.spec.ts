import { test, expect, setRootViaTest } from "./fixtures";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

test.describe("Native .mrsf.yaml config reload (full-stack watcher)", () => {
  // Polled-IPC pattern (issue #304 / FLAKE-1): we cannot listen for
  // `sidecar-config-changed` from inside `page.evaluate` —
  // `__TAURI_INTERNALS__` exposes `invoke()` but no `event.listen` API,
  // and `@tauri-apps/api/event` is not reachable in the page context.
  // Instead we use `expect.poll` against `get_sidecar_config` (a
  // deterministic IPC oracle) to wait for the watcher's reload to land.
  // The event-side contract — `sidecar-config-changed` fans out to the
  // tracking windows only — is covered by the Rust unit tests in
  // `src-tauri/tests/watcher_emit_test.rs`.
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

      // Drop .mrsf.yaml — watcher detects, reloads SidecarConfigState, emits
      // sidecar-config-changed window-scoped (issue #304 / FLAKE-1). We poll
      // get_sidecar_config (the deterministic IPC oracle) rather than
      // listen for the event — page.evaluate cannot reach
      // @tauri-apps/api/event and __TAURI_INTERNALS__ does not expose a
      // listen API. The event-side contract is covered by the Rust unit
      // tests in src-tauri/tests/watcher_emit_test.rs.
      fs.writeFileSync(
        path.join(tmpDir, ".mrsf.yaml"),
        "sidecar_root: .reviews\n",
      );

      // Phase 1: poll get_sidecar_config until the watcher's config cache
      // reflects the new sidecar_root. With the watcher fix in place, this
      // typically takes ~300ms (debounce + reload). 15s is a generous CI budget
      // for slow Windows runners (matches the timeout used by other native
      // specs e.g. e2e/native/03-file-reload.spec.ts).
      await expect
        .poll(
          async () => {
            return nativePage.evaluate((root: string) => {
              // @ts-ignore — Tauri internals
              return window.__TAURI_INTERNALS__.invoke("get_sidecar_config", { root });
            }, tmpDir);
          },
          {
            message:
              "watcher should reload .mrsf.yaml and update SidecarConfigState within 15s",
            timeout: 15_000,
            intervals: [200, 500, 1000],
          },
        )
        .toMatchObject({ enabled: true });

      // Phase 2: verify add_comment writes the sidecar to the configured root.
      const reviewsDir = path.join(tmpDir, ".reviews");
      const sidecarPath = path.join(reviewsDir, "readme.md.review.yaml");
      const colocated = path.join(tmpDir, "readme.md.review.yaml");
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

      // Wait for sidecar file to appear (also via expect.poll)
      await expect
        .poll(async () => fs.existsSync(sidecarPath), {
          message: `sidecar should land at ${sidecarPath} within 15s`,
          timeout: 15_000,
        })
        .toBe(true);

      expect(fs.existsSync(reviewsDir)).toBe(true);
      expect(fs.existsSync(colocated)).toBe(false);

      const content = fs.readFileSync(sidecarPath, "utf-8");
      expect(content).toContain("Comment under sidecar_root");
      expect(content).toContain("e2e-test");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
