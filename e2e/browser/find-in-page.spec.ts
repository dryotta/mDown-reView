import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

const FIND_FIXTURE = `# Find Test\n\nThe quick brown fox jumps over the lazy dog.\n\nThe brown fox returns. Brown fox brown fox.\n`;

async function setupFindMocks(page: Page) {
  await page.addInitScript(({ dir, body }: { dir: string; body: string }) => {
    const contents: Record<string, string> = {
      [`${dir}/find.md`]: body,
    };
    window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "get_launch_args") return { files: [], folders: [dir] };
      if (cmd === "read_dir")
        return [{ name: "find.md", path: `${dir}/find.md`, is_dir: false }];
      if (cmd === "read_text_file") {
        const path = (args as { path: string }).path;
        return contents[path] ?? "";
      }
      if (cmd === "load_review_comments") return null;
      if (cmd === "save_review_comments") return null;
      if (cmd === "check_path_exists") return "file";
      if (cmd === "get_log_path") return "/mock/log.log";
      if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
      return null;
    };
  }, { dir: FIXTURES_DIR, body: FIND_FIXTURE });
}

test.describe("Find in page (#65 G1)", () => {
  test("Ctrl+F opens bar, Enter advances current, Escape closes & clears", async ({ page }) => {
    test.skip(
      !(await page.evaluate(() => typeof CSS !== "undefined" && "highlights" in CSS)),
      "CSS Custom Highlight API not available in this browser",
    );

    await setupFindMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("find.md").click();
    await expect(page.locator(".markdown-viewer")).toBeVisible();

    // Open the find bar.
    await page.keyboard.press("Control+f");
    const bar = page.locator(".find-bar");
    await expect(bar).toBeVisible();
    const input = bar.getByRole("textbox", { name: /find in page/i });
    await expect(input).toBeFocused();

    // Type a known query that appears multiple times ("brown" → 4 hits).
    await input.fill("brown");
    await expect(bar.locator(".count")).toHaveText(/of 4$/);
    expect(
      await page.evaluate(() =>
        (CSS as unknown as { highlights: Map<string, unknown> }).highlights.size,
      ),
    ).toBeGreaterThan(0);

    // Counter starts at "1 of 4".
    await expect(bar.locator(".count")).toHaveText("1 of 4");
    // Enter → next match → "2 of 4".
    await input.press("Enter");
    await expect(bar.locator(".count")).toHaveText("2 of 4");
    // Shift+Enter → prev → "1 of 4".
    await input.press("Shift+Enter");
    await expect(bar.locator(".count")).toHaveText("1 of 4");

    // Escape closes the bar AND clears CSS.highlights.
    await input.press("Escape");
    await expect(bar).toBeHidden();
    expect(
      await page.evaluate(() =>
        (CSS as unknown as { highlights: Map<string, unknown> }).highlights.size,
      ),
    ).toBe(0);
  });
});
