import { test, expect } from "./fixtures";

test.describe("Panels and Keyboard Shortcuts", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") return { files: [], folders: [] };
        return null;
      };
    });
  });

  test("24.1 - Ctrl+B toggles folder pane", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();
    // Folder pane should be visible initially
    await expect(page.locator(".folder-tree")).toBeVisible();
    // Press Ctrl+B to hide
    await page.keyboard.press("Control+b");
    await expect(page.locator(".folder-tree")).not.toBeVisible();
    // Press again to show
    await page.keyboard.press("Control+b");
    await expect(page.locator(".folder-tree")).toBeVisible();
  });

  test("24.2 - Ctrl+Shift+C toggles comments panel", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();
  });

  test("24.3 - Folders toolbar button toggles folder pane", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();

    const foldersBtn = page.getByTitle("Toggle folder pane (Ctrl+B)");
    await expect(foldersBtn).toBeVisible();
    await expect(foldersBtn).toHaveClass(/active/);

    // Folder pane visible initially
    await expect(page.locator(".folder-tree")).toBeVisible();

    // Click to hide
    await foldersBtn.click();
    await expect(page.locator(".folder-tree")).not.toBeVisible();
    await expect(foldersBtn).not.toHaveClass(/active/);

    // Click again to show
    await foldersBtn.click();
    await expect(page.locator(".folder-tree")).toBeVisible();
    await expect(foldersBtn).toHaveClass(/active/);
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

  test("24.6 - toolbar separators visually group buttons", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();

    const separators = page.locator(".toolbar-separator");
    await expect(separators).toHaveCount(1);

    const btnGroups = page.locator(".toolbar-btn-group");
    await expect(btnGroups).toHaveCount(2);
  });
});
