import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

async function setupMocks(page: Page, body: string, name: string): Promise<void> {
  const file = `${FIXTURES_DIR}/${name}`;
  await page.addInitScript(
    ({ dir, file, body, name }: { dir: string; file: string; body: string; name: string }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") return { files: [], folders: [dir] };
        if (cmd === "read_dir") return [{ name, path: file, is_dir: false }];
        if (cmd === "read_text_file") return body;
        if (cmd === "load_review_comments") return null;
        if (cmd === "save_review_comments") return null;
        if (cmd === "get_log_path") return "/mock/log.log";
        if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
        return null;
      };
    },
    { dir: FIXTURES_DIR, file, body, name },
  );
}

test.describe("MarkdownViewer raw HTML allowlist (A4)", () => {
  test("inline <details><summary> survives sanitization", async ({ page }) => {
    await setupMocks(
      page,
      "# Doc\n\n<details><summary>Click</summary>Hidden body</details>\n",
      "details.md",
    );
    await page.goto("/");
    await page.locator(".folder-tree").getByText("details.md").click();
    await expect(page.locator(".markdown-body details")).toBeVisible();
    await expect(page.locator(".markdown-body details summary")).toHaveText("Click");
  });

  test("inline <script> is stripped from rendered output", async ({ page }) => {
    // Allow the script-loader/CSP-warn console noise jsdom may surface.
    await setupMocks(
      page,
      "# Doc\n\nbefore<script>window.__XSS__ = 1</script>after\n",
      "script.md",
    );
    await page.goto("/");
    await page.locator(".folder-tree").getByText("script.md").click();
    await expect(page.locator(".markdown-body")).toBeVisible();

    // The <script> tag must not be present in the rendered DOM.
    expect(await page.locator(".markdown-body script").count()).toBe(0);
    // And it must not have executed.
    const xss = await page.evaluate(
      () => (window as unknown as { __XSS__?: number }).__XSS__,
    );
    expect(xss).toBeUndefined();
  });
});
