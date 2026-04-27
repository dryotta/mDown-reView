import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

/**
 * #65 Group C — G3: print stylesheet smoke test.
 *
 * Mounts a markdown file, switches the page into the `print` media context
 * via `page.emulateMedia`, and asserts that:
 *   - the viewer toolbar (which hosts the new Print button) is hidden;
 *   - the rendered `.markdown-body` is still visible.
 *
 * Other surfaces hidden by `src/styles/print.css` (sidebar, comments panel,
 * status bar, top toolbar, etc.) are exercised by the same media-rule, so
 * the toolbar is a sufficient sentinel for the rule actually applying.
 */
function setupMarkdownMock(page: Page) {
  return page.addInitScript((dir: string) => {
    window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "get_launch_args") return { files: [], folders: [dir] };
      if (cmd === "read_dir")
        return [{ name: "sample.md", path: `${dir}/sample.md`, is_dir: false }];
      if (cmd === "read_text_file") {
        const path = (args as { path: string }).path;
        if (path.endsWith("sample.md")) return "# Hello print\n\nBody text for the print test.";
        return "";
      }
      if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
      if (cmd === "get_file_badges") return {};
      if (cmd === "check_path_exists") return "file";
      if (cmd === "get_log_path") return "/mock/log.log";
      return null;
    };
  }, FIXTURES_DIR);
}

test.describe("#65 G3 print media stylesheet", () => {
  test("hides app chrome and keeps markdown body visible under print media", async ({
    page,
  }) => {
    await setupMarkdownMock(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("sample.md").click();
    await expect(page.locator(".markdown-body")).toBeVisible();
    // Sanity: toolbar is normally visible on the screen media.
    await expect(page.locator(".viewer-toolbar")).toBeVisible();

    await page.emulateMedia({ media: "print" });

    await expect(page.locator(".viewer-toolbar")).toBeHidden();
    await expect(page.locator(".folder-tree")).toBeHidden();
    await expect(page.locator(".markdown-body")).toBeVisible();
  });

  test("Print button appears in the viewer toolbar for markdown files", async ({
    page,
  }) => {
    await setupMarkdownMock(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("sample.md").click();
    await expect(page.locator(".markdown-body")).toBeVisible();

    // The button has aria-label="Print"; scope to the viewer toolbar so it
    // does not collide with any other actionable element.
    await expect(
      page.locator(".viewer-toolbar").getByRole("button", { name: /^print$/i }),
    ).toBeVisible();
  });
});
