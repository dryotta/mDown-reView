import { test, expect, queueLaunchArgs, dispatchTauriEvent } from "./fixtures";

/**
 * Browser-E2E coverage of the renderer half of the drag-drop flow.
 *
 * The actual `WindowEvent::DragDrop` event is OS-native and cannot be
 * synthesized in a browser-only Playwright run. But the renderer-side
 * bootstrap path is identical to CLI/single-instance: the Rust side
 * `push_args(label, ...)` + `emit_to(label, "args-received", ())`,
 * and `useLaunchArgsBootstrap` drains via `get_launch_args`. Faking
 * those signals exercises the same `openFilesFromArgs` flow drag-drop
 * relies on in production — without it, a regression in `openFile`
 * after the drag-drop emit (but not after the CLI emit) would not
 * surface in any browser-layer test.
 *
 * Native end-to-end (real Drop event, real Tauri runtime) is tracked
 * separately as `e2e/native/drag-drop.spec.ts` (issue #373).
 */
test.describe("Drag-drop renderer bootstrap", () => {
  test("dispatching args-received with a single dropped file opens it as a tab", async ({ page }) => {
    await page.addInitScript(() => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "read_dir") return [];
        if (cmd === "read_text_file") return "# Dropped File\n\nDragged from Explorer";
        if (cmd === "load_review_comments") return null;
        if (cmd === "check_path_exists") return "file";
        if (cmd === "get_log_path") return "/mock/log.log";
        if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
        return null;
      };
    });
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();
    await expect(page.locator(".tab-bar .tab")).toHaveCount(0);

    // Simulate the `commands::drag_drop::handle_dropped_paths` push_args
    // + emit_to sequence: queue the file, then signal.
    await queueLaunchArgs(page, [{ files: ["/test/dropped.md"], folders: [] }]);
    await dispatchTauriEvent(page, "args-received");

    await expect(page.locator(".tab-bar").getByText("dropped.md")).toBeVisible();
    await expect(page.getByText("Dropped File")).toBeVisible();
  });

  test("dispatching args-received with multiple dropped files opens all as tabs (deduped)", async ({ page }) => {
    await page.addInitScript(() => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "read_dir") return [];
        if (cmd === "read_text_file") return "# File\n\n";
        if (cmd === "load_review_comments") return null;
        if (cmd === "check_path_exists") return "file";
        if (cmd === "get_log_path") return "/mock/log.log";
        if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
        return null;
      };
    });
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();

    // Multi-file Explorer drag → single args-received with N paths.
    await queueLaunchArgs(page, [
      { files: ["/test/a.md", "/test/b.md", "/test/a.md"], folders: [] },
    ]);
    await dispatchTauriEvent(page, "args-received");

    await expect(page.locator(".tab-bar").getByText("a.md")).toBeVisible();
    await expect(page.locator(".tab-bar").getByText("b.md")).toBeVisible();
    // Three positions but "a.md" deduped → 2 unique tabs.
    await expect(page.locator(".tab-bar .tab")).toHaveCount(2);
  });

  test("dispatching args-received with a dropped folder sets it as workspace root", async ({ page }) => {
    await page.addInitScript(() => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "read_dir") return [];
        if (cmd === "load_review_comments") return null;
        if (cmd === "check_path_exists") return "directory";
        if (cmd === "register_window_folder") return null;
        if (cmd === "get_log_path") return "/mock/log.log";
        if (cmd === "scan_review_files") return [];
        if (cmd === "canonicalize_path") return "/test/proj";
        return null;
      };
    });
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();
    // Welcome view is visible while no workspace exists.
    await expect(page.locator(".welcome-view")).toBeVisible();

    await queueLaunchArgs(page, [{ files: [], folders: ["/test/proj"] }]);
    await dispatchTauriEvent(page, "args-received");

    // After the bootstrap drain, FolderTree appears on the left.
    // The welcome view is NOT mutually exclusive with FolderTree — App
    // renders WelcomeView whenever `activeTabPath === null`, which is
    // still the case here (folder open, no tabs). The original spec
    // over-asserted on `.welcome-view` being hidden; that contradicts
    // the production layout (App.tsx: viewer-area shows WelcomeView when
    // no active tab, regardless of `root`). FolderTree visibility is
    // the correct oracle for "folder was claimed via args-received".
    await expect(page.locator(".folder-tree")).toBeVisible();
  });

  test("the drag-drop-rejected event renders a transient toast", async ({ page }) => {
    await page.addInitScript(() => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_log_path") return "/mock/log.log";
        return null;
      };
    });
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();

    // Dispatching `drag-drop-rejected` should show the transient toast
    // even when no drop ever fired (handler is independent of the
    // overlay state).
    await dispatchTauriEvent(page, "drag-drop-rejected", {
      count: 2,
      reason: "no usable file or folder",
    });

    await expect(page.locator(".drag-drop-rejection-toast")).toContainText(
      "Couldn't open 2 dropped items",
    );
    await expect(page.locator(".drag-drop-rejection-toast")).toContainText(
      "no usable file or folder",
    );
  });
});
