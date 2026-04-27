import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";
const FILE = `${FIXTURES_DIR}/anchors.md`;

const MD_BODY = "## Hello world\n\nbody\n";

async function setupMocks(page: Page): Promise<void> {
  await page.addInitScript(
    ({ dir, file, body }: { dir: string; file: string; body: string }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") return { files: [], folders: [dir] };
        if (cmd === "read_dir") return [{ name: "anchors.md", path: file, is_dir: false }];
        if (cmd === "read_text_file") return body;
        if (cmd === "load_review_comments") return null;
        if (cmd === "save_review_comments") return null;
        if (cmd === "get_log_path") return "/mock/log.log";
        if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
        return null;
      };
    },
    { dir: FIXTURES_DIR, file: FILE, body: MD_BODY },
  );
}

test.describe("MarkdownViewer heading anchors (A5)", () => {
  test("rehype-autolink-headings injects <a class='heading-anchor' href='#…'>", async ({
    page,
  }) => {
    await setupMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("anchors.md").click();
    await expect(page.locator(".markdown-body h2")).toHaveText(/Hello world/);

    const anchor = page.locator(".markdown-body h2 a.heading-anchor");
    await expect(anchor).toHaveAttribute("href", "#hello-world");
  });
});
