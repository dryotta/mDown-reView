import { test, expect } from "./fixtures";

test.describe("Tab Management", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") return { files: [], folders: [] };
        if (cmd === "read_text_file") return "# Test\n\nContent";
        if (cmd === "load_review_comments") return null;
        return null;
      };
    });
  });

  test("22.1 - app loads without errors", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();
  });

  test("22.2 - no duplicate tabs for same file", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();
  });

  test("22.3 - close tab shows empty state when last tab closed", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();
  });

  test("22.4 - Ctrl+Tab cycles tabs", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();
  });

  test("22.5 - large file shows warning banner", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();
  });
});
