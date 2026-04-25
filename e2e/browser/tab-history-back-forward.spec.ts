import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";
const FILE_A = `${FIXTURES_DIR}/a.md`;
const FILE_B = `${FIXTURES_DIR}/b.md`;

const BODY_A = `# A\n\n[go to b](./b.md)\n`;
const BODY_B = `# B\n\nhello\n`;

async function setupMocks(page: Page): Promise<void> {
  await page.addInitScript(
    ({ dir, fileA, fileB, bodyA, bodyB }: {
      dir: string;
      fileA: string;
      fileB: string;
      bodyA: string;
      bodyB: string;
    }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "get_launch_args") return { files: [], folders: [dir] };
        if (cmd === "read_dir")
          return [
            { name: "a.md", path: fileA, is_dir: false },
            { name: "b.md", path: fileB, is_dir: false },
          ];
        if (cmd === "read_text_file") {
          const path = (args as { path: string }).path;
          if (path === fileA) return bodyA;
          if (path === fileB) return bodyB;
          return "";
        }
        if (cmd === "load_review_comments") return null;
        if (cmd === "save_review_comments") return null;
        if (cmd === "check_path_exists") return "file";
        if (cmd === "get_log_path") return "/mock/log.log";
        if (cmd === "get_file_comments") return [];
        return null;
      };
    },
    { dir: FIXTURES_DIR, fileA: FILE_A, fileB: FILE_B, bodyA: BODY_A, bodyB: BODY_B },
  );
}

async function activeTabName(page: Page): Promise<string | null> {
  return await page.locator(".tab-bar .tab.active .tab-name").textContent();
}

test.describe("Tab back/forward history (C1)", () => {
  test("Alt+Left then Alt+Right walks the history", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/");

    // Open A from the sidebar.
    await page.locator(".folder-tree").getByText("a.md").click();
    await expect(page.locator(".markdown-body")).toBeVisible();
    expect(await activeTabName(page)).toBe("a.md");

    // Click in-doc link to navigate to B.
    await page.locator(".markdown-body a", { hasText: "go to b" }).click();
    await expect(page.locator(".tab-bar .tab.active .tab-name")).toHaveText("b.md");

    // Alt+Left → should go back to A.
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(page.locator(".tab-bar .tab.active .tab-name")).toHaveText("a.md");

    // Alt+Right → should go forward to B.
    await page.keyboard.press("Alt+ArrowRight");
    await expect(page.locator(".tab-bar .tab.active .tab-name")).toHaveText("b.md");
  });
});
