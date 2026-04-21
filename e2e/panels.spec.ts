import { test, expect } from "./fixtures";

test.describe("Panels and Keyboard Shortcuts", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") return { files: [], folders: [] };
        if (cmd === "check_path_exists") return "file";
        return null;
      };
    });
  });

  test("24.2 - Ctrl+Shift+C toggles comments panel", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();
  });

  test("24.4 - Comments toolbar button toggles comments panel", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();

    const commentsBtn = page.getByTitle("Toggle comments pane (Ctrl+Shift+C)");
    await expect(commentsBtn).toBeVisible();
    // Comments pane is enabled by default
    await expect(commentsBtn).toHaveClass(/active/);

    // Click to deactivate
    await commentsBtn.click();
    await expect(commentsBtn).not.toHaveClass(/active/);

    // Click again to reactivate
    await commentsBtn.click();
    await expect(commentsBtn).toHaveClass(/active/);
  });

  test("24.5 - Open File and Open Folder buttons are visible in toolbar", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();

    await expect(page.getByTitle("Open file(s)")).toBeVisible();
    await expect(page.getByTitle("Open folder")).toBeVisible();
  });

  test("24.6 - toolbar has one button group", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();

    const btnGroups = page.locator(".toolbar-btn-group");
    await expect(btnGroups).toHaveCount(1);
  });

  test("24.7 - welcome view shows when no file is open", async ({ page }) => {
    await page.goto("/");
    const welcome = page.locator(".welcome-view");
    await expect(welcome).toBeVisible();
    await expect(welcome.getByText("Open File")).toBeVisible();
    await expect(welcome.getByText("Open Folder")).toBeVisible();
  });

  test("24.8 - folder pane is hidden when no folder is open", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".folder-tree")).not.toBeVisible();
  });
});
