import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// asset.localhost URLs are unreachable in browser-only tests (no Tauri shell);
// the mock returns the URL but the <audio>/<video> network fetch fails with
// ERR_CONNECTION_REFUSED. Suppress that resource error from the console-spy.
test.use({ consoleErrorAllowlist: ["Failed to load resource", "asset.localhost"] });

const FIXTURES_DIR = "/e2e/fixtures";

async function setupMediaMocks(page: Page) {
  await page.addInitScript((dir: string) => {
    window.__TAURI_IPC_MOCK__ = async (cmd: string, _args: Record<string, unknown>) => {
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
      if (cmd === "get_file_comments") return [];
      // Audio/video viewers don't issue read_text_file or read_binary_file —
      // they stream via the asset:// URL. This mock returns null for any
      // unrelated command so accidental reads surface as test failures.
      return null;
    };
  }, FIXTURES_DIR);
}

test.describe("Media viewers (#65 F1/F2)", () => {
  test("opens .mp3 in AudioViewer with native <audio> controls", async ({ page }) => {
    await setupMediaMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("song.mp3").click();

    const audio = page.locator(".audio-viewer audio");
    await expect(audio).toBeVisible();
    await expect(audio).toHaveAttribute("controls", "");
    await expect(audio).toHaveAttribute("preload", "metadata");

    const src = await audio.getAttribute("src");
    expect(src).not.toBeNull();
    expect((src ?? "").length).toBeGreaterThan(0);

    // L4 — filename + MIME live in the FileActionsBar above the player.
    await expect(page.locator(".file-actions-bar__mime")).toContainText("audio/mpeg");
  });

  test("opens .mp4 in VideoViewer with native <video> controls", async ({ page }) => {
    await setupMediaMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("clip.mp4").click();

    const video = page.locator(".video-viewer video");
    await expect(video).toBeVisible();
    await expect(video).toHaveAttribute("controls", "");
    await expect(video).toHaveAttribute("preload", "metadata");

    const src = await video.getAttribute("src");
    expect(src).not.toBeNull();
    expect((src ?? "").length).toBeGreaterThan(0);

    await expect(page.locator(".file-actions-bar__mime")).toContainText("video/mp4");
  });
});
