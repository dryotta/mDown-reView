import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

// 1×1 transparent PNG, base64-encoded. The viewer treats the IPC return as
// the raw base64 body of a data URL — actual bytes are irrelevant.
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

async function setupImageMocks(page: Page) {
  await page.addInitScript(({ dir, b64 }: { dir: string; b64: string }) => {
    window.__TAURI_IPC_MOCK__ = async (cmd: string, _args: Record<string, unknown>) => {
      if (cmd === "get_launch_args") return { files: [], folders: [dir] };
      if (cmd === "read_dir")
        return [{ name: "pic.png", path: `${dir}/pic.png`, is_dir: false }];
      if (cmd === "read_binary_file") return b64;
      if (cmd === "load_review_comments") return null;
      if (cmd === "get_log_path") return "/mock/log.log";
      if (cmd === "get_file_comments") return [];
      return null;
    };
  }, { dir: FIXTURES_DIR, b64: TINY_PNG_B64 });
}

test.describe("Image viewer zoom + pan (#65 D1/D2/D3)", () => {
  test("Ctrl+= zooms; drag translates the image", async ({ page }) => {
    await setupImageMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("pic.png").click();

    const img = page.locator(".image-viewer img");
    await expect(img).toBeVisible();

    // Zoom in several steps so zoom > 1 (drag-to-pan only enabled then).
    for (let i = 0; i < 6; i++) await page.keyboard.press("Control+=");

    // Capture position before drag.
    const before = await img.boundingBox();
    expect(before).not.toBeNull();

    // Drag inside the canvas. Use the canvas (parent) for mousedown to ensure
    // the handler is attached to the element under the cursor, then move via
    // window mousemove (matches how the component listens).
    const canvas = page.locator(".image-viewer-canvas");
    const cb = await canvas.boundingBox();
    expect(cb).not.toBeNull();
    const startX = cb!.x + cb!.width / 2;
    const startY = cb!.y + cb!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 80, startY + 60, { steps: 10 });
    await page.mouse.up();

    const after = await img.boundingBox();
    expect(after).not.toBeNull();
    // Image should have translated — its bounding box origin moves.
    const dx = Math.abs((after!.x) - (before!.x));
    const dy = Math.abs((after!.y) - (before!.y));
    expect(dx + dy).toBeGreaterThan(20);
  });
});
