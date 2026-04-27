import { test, expect, queueLaunchArgs, dispatchTauriEvent } from "./fixtures";

test.describe("CLI File Open", () => {
  test("25.1 - first-instance get_launch_args drains the queue and opens the file", async ({ page }) => {
    // Pre-seed the in-page launch-args queue so the bootstrap effect picks
    // it up on first mount. The fixture's installer runs before this script
    // (Playwright runs addInitScripts in registration order).
    await page.addInitScript((vals) => {
      const fn = (window as unknown as {
        __TAURI_QUEUE_LAUNCH_ARGS__?: (v: unknown) => void;
      }).__TAURI_QUEUE_LAUNCH_ARGS__;
      if (typeof fn === "function") fn(vals);
    }, [{ files: ["/test/readme.md"], folders: [] }]);

    await page.addInitScript(() => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        // get_launch_args is served by the fixture's draining queue.
        if (cmd === "read_dir") return [];
        if (cmd === "read_text_file") return "# Launched File\n\nContent";
        if (cmd === "load_review_comments") return null;
        if (cmd === "check_path_exists") return "file";
        if (cmd === "get_log_path") return "/mock/log.log";
        if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
        return null;
      };
    });

    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();

    await expect(page.locator(".tab-bar").getByText("readme.md")).toBeVisible();
    await expect(page.getByText("Launched File")).toBeVisible();

    // Queue is now drained: a fresh IPC call must return empty LaunchArgs.
    const drained = await page.evaluate(async () => {
      const internals = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__;
      return internals.invoke("get_launch_args");
    });
    expect(drained).toEqual({ files: [], folders: [] });
  });

  test("25.2 - args-received signal triggers a fresh drain that opens a new tab", async ({ page }) => {
    await page.addInitScript(() => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "read_dir") return [];
        if (cmd === "read_text_file") return "# Second Instance File\n\nContent";
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

    // Queue what the next drain (triggered by the signal) will return,
    // then fire the signal-only event.
    await queueLaunchArgs(page, [{ files: ["/test/newfile.md"], folders: [] }]);
    await dispatchTauriEvent(page, "args-received");

    await expect(page.locator(".tab-bar").getByText("newfile.md")).toBeVisible();
  });

  test("25.3 - two rapid args-received signals drain twice; overlapping files dedupe", async ({ page }) => {
    await page.addInitScript(() => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "read_dir") return [];
        if (cmd === "read_text_file") return "# File\n\nContent";
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

    // Queue two distinct drains where /test/b.md appears in both: it must
    // open exactly once thanks to openFilesFromArgs's dedupe.
    await queueLaunchArgs(page, [
      { files: ["/test/a.md", "/test/b.md"], folders: [] },
      { files: ["/test/b.md", "/test/c.md"], folders: [] },
    ]);

    await dispatchTauriEvent(page, "args-received");
    await dispatchTauriEvent(page, "args-received");

    await expect(page.locator(".tab-bar").getByText("a.md")).toBeVisible();
    await expect(page.locator(".tab-bar").getByText("b.md")).toBeVisible();
    await expect(page.locator(".tab-bar").getByText("c.md")).toBeVisible();
    // Three unique files ⇒ three tabs (not four).
    await expect(page.locator(".tab-bar .tab")).toHaveCount(3);
  });
});
