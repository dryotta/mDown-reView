import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

// 400×400 black PNG (raw zeros, deflate-compressed). Big enough that at
// zoom > 1 the image overflows a typical viewport, so the pan clamp produces
// non-zero limits and a real drag actually translates the image.
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAZAAAAGQCAAAAACl1GkQAAAAsklEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeDRyrgABKT7rhwAAAABJRU5ErkJggg==";

async function setupImageMocks(page: Page) {
  await page.addInitScript(({ dir, b64 }: { dir: string; b64: string }) => {
    window.__TAURI_IPC_MOCK__ = async (cmd: string, _args: Record<string, unknown>) => {
      if (cmd === "get_launch_args") return { files: [], folders: [dir] };
      if (cmd === "read_dir")
        return [{ name: "pic.png", path: `${dir}/pic.png`, is_dir: false }];
      if (cmd === "read_binary_file") return b64;
      if (cmd === "load_review_comments") return null;
      if (cmd === "check_path_exists") return "file";
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

  /**
   * R2 — even with a wildly long drag, the (zoomed) image must not be
   * translated entirely outside the canvas. The clamp keeps at least part
   * of it visible inside the container.
   */
  test("pan is clamped so the image cannot leave the canvas", async ({ page }) => {
    await setupImageMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("pic.png").click();

    const img = page.locator(".image-viewer img");
    const canvas = page.locator(".image-viewer-canvas");
    await expect(img).toBeVisible();

    // Zoom in to enable pan.
    for (let i = 0; i < 6; i++) await page.keyboard.press("Control+=");

    const cb = await canvas.boundingBox();
    expect(cb).not.toBeNull();
    const cx = cb!.x + cb!.width / 2;
    const cy = cb!.y + cb!.height / 2;

    // Drag a huge distance — much further than the canvas can possibly hold.
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 5000, cy + 5000, { steps: 20 });
    await page.mouse.up();

    const after = await img.boundingBox();
    expect(after).not.toBeNull();
    // The image's bbox must still intersect the canvas — i.e. not pushed off-screen.
    const intersects =
      after!.x < cb!.x + cb!.width &&
      after!.x + after!.width > cb!.x &&
      after!.y < cb!.y + cb!.height &&
      after!.y + after!.height > cb!.y;
    expect(intersects).toBe(true);
  });
});
