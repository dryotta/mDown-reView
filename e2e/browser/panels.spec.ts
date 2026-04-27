import { test, expect } from "./fixtures";

const FIXTURES_DIR = "/e2e/fixtures";

test.describe("Panels and Keyboard Shortcuts", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(({ dir }: { dir: string }) => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") return { files: [], folders: [dir] };
        if (cmd === "read_dir")
          return [{ name: "doc.md", path: `${dir}/doc.md`, is_dir: false }];
        if (cmd === "read_text_file") return "# Doc\n\nContent";
        if (cmd === "load_review_comments") return null;
        if (cmd === "check_path_exists") return "file";
        if (cmd === "get_log_path") return "/mock/log.log";
        if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
        return null;
      };
    }, { dir: FIXTURES_DIR });
  });

  test("24.2 - Ctrl+Shift+C toggles the comments panel", async ({ page }) => {
    await page.goto("/");
    await page.locator(".folder-tree").getByText("doc.md").click();

    // Comments panel is visible by default after opening a file
    await expect(page.locator(".comments-panel")).toBeVisible();

    // Ctrl+Shift+C should hide it
    await page.keyboard.press("Control+Shift+C");
    await expect(page.locator(".comments-panel")).not.toBeVisible();

    // Ctrl+Shift+C again should show it
    await page.keyboard.press("Control+Shift+C");
    await expect(page.locator(".comments-panel")).toBeVisible();
  });

  test("24.4 - Comments toolbar button toggles comments panel", async ({ page }) => {
    await page.goto("/");
    const commentsBtn = page.getByTitle("Toggle comments pane (Ctrl+Shift+C)");
    await expect(commentsBtn).toBeVisible();
    await expect(commentsBtn).toHaveClass(/active/);

    await commentsBtn.click();
    await expect(commentsBtn).not.toHaveClass(/active/);

    await commentsBtn.click();
    await expect(commentsBtn).toHaveClass(/active/);
  });

  test("24.5 - Open File and Open Folder buttons are visible in toolbar", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTitle("Open file(s)")).toBeVisible();
    await expect(page.getByTitle("Open folder")).toBeVisible();
  });

  test("24.6 - toolbar has one button group", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".toolbar-btn-group")).toHaveCount(1);
  });

  test("24.7 - welcome view shows when no file is open", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".welcome-view")).toBeVisible();
    await expect(page.locator(".welcome-view").getByText("Open File")).toBeVisible();
    await expect(page.locator(".welcome-view").getByText("Open Folder")).toBeVisible();
  });

  test("24.8 - folder pane is hidden when no folder is open", async ({ page }) => {
    // Override mock to start with no folder
    await page.addInitScript(() => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") return { files: [], folders: [] };
        if (cmd === "load_review_comments") return null;
        if (cmd === "check_path_exists") return "file";
        if (cmd === "get_log_path") return "/mock/log.log";
        if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
        return null;
      };
    });
    await page.goto("/");
    await expect(page.locator(".folder-tree")).not.toBeVisible();
  });
});
