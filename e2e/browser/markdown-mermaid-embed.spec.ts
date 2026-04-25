import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";
const FILE = `${FIXTURES_DIR}/diagram.md`;

const MD_BODY = "# D\n\n```mermaid\ngraph LR; A-->B\n```\n";

async function setupMocks(page: Page): Promise<void> {
  await page.addInitScript(
    ({ dir, file, body }: { dir: string; file: string; body: string }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") return { files: [], folders: [dir] };
        if (cmd === "read_dir") return [{ name: "diagram.md", path: file, is_dir: false }];
        if (cmd === "read_text_file") return body;
        if (cmd === "load_review_comments") return null;
        if (cmd === "save_review_comments") return null;
        if (cmd === "get_log_path") return "/mock/log.log";
        if (cmd === "get_file_comments") return [];
        return null;
      };
    },
    { dir: FIXTURES_DIR, file: FILE, body: MD_BODY },
  );
}

test.describe("MarkdownViewer embedded mermaid (A3)", () => {
  test("```mermaid fenced block renders an svg", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("diagram.md").click();
    await expect(page.locator(".markdown-body")).toBeVisible();

    // Mermaid renders an <svg>; tolerate up to a few seconds for lazy-load.
    await expect(page.locator(".markdown-body svg")).toBeVisible({ timeout: 15_000 });
  });

  test("```Mermaid (case-insensitive) also renders an svg", async ({ page }) => {
    await page.addInitScript(
      ({ dir, file }: { dir: string; file: string }) => {
        const w = window as unknown as Record<string, unknown>;
        w.__TAURI_IPC_MOCK__ = async (cmd: string) => {
          if (cmd === "get_launch_args") return { files: [], folders: [dir] };
          if (cmd === "read_dir")
            return [{ name: "diagram2.md", path: file, is_dir: false }];
          if (cmd === "read_text_file")
            return "# D\n\n```Mermaid\ngraph LR; X-->Y\n```\n";
          if (cmd === "load_review_comments") return null;
          if (cmd === "save_review_comments") return null;
          if (cmd === "get_log_path") return "/mock/log.log";
          if (cmd === "get_file_comments") return [];
          return null;
        };
      },
      { dir: FIXTURES_DIR, file: `${FIXTURES_DIR}/diagram2.md` },
    );
    await page.goto("/");
    await page.locator(".folder-tree").getByText("diagram2.md").click();
    await expect(page.locator(".markdown-body")).toBeVisible();
    await expect(page.locator(".markdown-body svg")).toBeVisible({ timeout: 15_000 });
  });
});
