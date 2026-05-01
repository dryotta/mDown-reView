import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

async function setupMediaMocks(page: Page) {
  await page.addInitScript((dir: string) => {
    window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "get_launch_args") return { files: [], folders: [dir] };
      if (cmd === "read_dir") {
        return [
          { name: "song.mp3", path: `${dir}/song.mp3`, is_dir: false },
          { name: "clip.mp4", path: `${dir}/clip.mp4`, is_dir: false },
        ];
      }
      if (cmd === "load_review_comments") return null;
      if (cmd === "check_path_exists") return "file";
      if (cmd === "get_log_path") return "/mock/log.log";
      if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
      // Audio and video files have no dedicated viewers — they fall through
      // to readTextFile which the real Rust backend rejects as binary_file.
      if (cmd === "read_text_file") {
        const p = String(args.path ?? "");
        if (p.endsWith(".mp3") || p.endsWith(".mp4")) throw new Error("binary_file");
      }
      // stat_file is called after a binary_file rejection to populate size/mtime.
      if (cmd === "stat_file") return { size_bytes: 1024, mtime_ms: null };
      // Return null for any unrelated command so accidental reads surface as
      // test failures.
      return null;
    };
  }, FIXTURES_DIR);
}

test.describe("Media files route to binary placeholder (no dedicated viewers)", () => {
  test("opens .mp3 in binary placeholder", async ({ page }) => {
    await setupMediaMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("song.mp3").click();

    // Audio files route through the binary viewer shell. Verify the
    // placeholder and toolbar are visible and FileActionsBar is present.
    await expect(page.locator(".viewer-placeholder")).toBeVisible();
    await expect(page.locator(".viewer-toolbar")).toBeVisible();
    await expect(page.locator(".file-actions-bar")).toBeVisible();
  });

  test("opens .mp4 in binary placeholder (no dedicated video viewer)", async ({ page }) => {
    await setupMediaMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("clip.mp4").click();

    // Video files route through the binary viewer shell after the toolbar
    // UX cleanup removed the dedicated VideoViewer. Verify the placeholder
    // and toolbar are visible.
    await expect(page.locator(".viewer-placeholder")).toBeVisible();
    await expect(page.locator(".viewer-toolbar")).toBeVisible();
  });
});
