import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

async function setupZoomMocks(page: Page) {
  await page.addInitScript(({ dir }: { dir: string }) => {
    const contents: Record<string, string> = {
      [`${dir}/a.md`]: "# File A\n\nLine one.\nLine two.\nLine three.\n",
    };
    window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "get_launch_args") return { files: [], folders: [dir] };
      if (cmd === "read_dir")
        return [{ name: "a.md", path: `${dir}/a.md`, is_dir: false }];
      if (cmd === "read_text_file") {
        const path = (args as { path: string }).path;
        return contents[path] ?? "";
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

test.describe("Source viewer zoom (#92)", () => {
  // `.source-view .source-lines` is the canonical zoomed-text container —
  // see docs/best-practices-project/test-patterns.md §6 and the production
  // rule `font-size: calc(13px * var(--source-zoom))` in source-viewer.css.
  const SELECTOR = ".source-view .source-lines";

  // Open a .md file and toggle the toolbar to "Source" so we exercise the
  // SourceView while the visualizable-file toolbar (with the Zoom control)
  // is rendered. Mirrors the markdown-zoom spec's setup pattern.
  async function openSourceView(page: Page) {
    await setupZoomMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("a.md").click();
    await expect(page.locator(".markdown-viewer")).toBeVisible();
    await page.getByRole("button", { name: "Source" }).click();
    await expect(page.locator(SELECTOR)).toBeVisible();
  }

  test("Ctrl+= grows .source-lines font and Ctrl+0 resets", async ({ page }) => {
    await openSourceView(page);

    const baseline = await fontSize(page, SELECTOR);
    expect(baseline).toBeGreaterThan(0);

    // Two zoom-in steps (×1.1 each → ~×1.21).
    await page.keyboard.press("Control+=");
    await page.keyboard.press("Control+=");
    await expect.poll(async () => await fontSize(page, SELECTOR)).toBeGreaterThan(baseline * 1.15);
    const grown = await fontSize(page, SELECTOR);

    // One zoom-out step → smaller than the two-step zoomed value.
    await page.keyboard.press("Control+-");
    await expect.poll(async () => await fontSize(page, SELECTOR)).toBeLessThan(grown);

    // Reset → back to baseline.
    await page.keyboard.press("Control+0");
    await expect.poll(async () => await fontSize(page, SELECTOR)).toBeCloseTo(baseline, 0);
  });

  test("toolbar Zoom in button has the same effect as Ctrl+=", async ({ page }) => {
    await openSourceView(page);

    const baseline = await fontSize(page, SELECTOR);
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(async () => await fontSize(page, SELECTOR)).toBeGreaterThan(baseline * 1.15);
  });
});

