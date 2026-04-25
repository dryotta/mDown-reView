import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

async function setupZoomMocks(page: Page) {
  await page.addInitScript(({ dir }: { dir: string }) => {
    const contents: Record<string, string> = {
      [`${dir}/a.md`]: "# File A\n\nThis is markdown file A.",
      [`${dir}/b.md`]: "# File B\n\nThis is markdown file B.",
    };
    window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "get_launch_args") return { files: [], folders: [dir] };
      if (cmd === "read_dir")
        return [
          { name: "a.md", path: `${dir}/a.md`, is_dir: false },
          { name: "b.md", path: `${dir}/b.md`, is_dir: false },
        ];
      if (cmd === "read_text_file") {
        const path = (args as { path: string }).path;
        return contents[path] ?? "# default";
      }
      if (cmd === "load_review_comments") return null;
      if (cmd === "save_review_comments") return null;
      if (cmd === "check_path_exists") return "file";
      if (cmd === "get_log_path") return "/mock/log.log";
      if (cmd === "get_file_comments") return [];
      return null;
    };
  }, { dir: FIXTURES_DIR });
}

async function fontSize(page: Page, selector: string): Promise<number> {
  return await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error(`element not found: ${sel}`);
    return parseFloat(getComputedStyle(el).fontSize);
  }, selector);
}

test.describe("Markdown viewer zoom (#65 D1/D2/D3)", () => {
  test("Ctrl+= grows font and Ctrl+0 resets", async ({ page }) => {
    await setupZoomMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("a.md").click();
    await expect(page.locator(".markdown-viewer")).toBeVisible();

    const baseline = await fontSize(page, ".markdown-viewer");
    expect(baseline).toBeGreaterThan(0);

    // Two zoom-in steps (×1.1 each → ~×1.21).
    await page.keyboard.press("Control+=");
    await page.keyboard.press("Control+=");
    await expect.poll(async () => await fontSize(page, ".markdown-viewer")).toBeGreaterThan(baseline * 1.15);

    // Reset → back to baseline.
    await page.keyboard.press("Control+0");
    await expect.poll(async () => await fontSize(page, ".markdown-viewer")).toBeCloseTo(baseline, 0);
  });

  test("zoom persists across tab switch (markdown ↔ markdown)", async ({ page }) => {
    await setupZoomMocks(page);
    await page.goto("/");

    // Open A and zoom in twice.
    await page.locator(".folder-tree").getByText("a.md").click();
    await expect(page.locator(".markdown-viewer")).toBeVisible();
    const baseline = await fontSize(page, ".markdown-viewer");
    await page.keyboard.press("Control+=");
    await page.keyboard.press("Control+=");
    await expect.poll(async () => await fontSize(page, ".markdown-viewer")).toBeGreaterThan(baseline * 1.15);
    const zoomed = await fontSize(page, ".markdown-viewer");

    // Switch to B — it should also be at the same zoom (shared by `.md` key).
    await page.locator(".folder-tree").getByText("b.md").click();
    await expect(page.locator(".markdown-viewer")).toBeVisible();
    await expect.poll(async () => await fontSize(page, ".markdown-viewer")).toBeCloseTo(zoomed, 0);

    // Switch back to A — still zoomed.
    await page.locator(".tab-bar").getByText("a.md").click();
    await expect(page.locator(".markdown-viewer")).toBeVisible();
    await expect.poll(async () => await fontSize(page, ".markdown-viewer")).toBeCloseTo(zoomed, 0);
  });
});
