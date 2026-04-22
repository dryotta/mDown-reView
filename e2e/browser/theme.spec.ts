import { test, expect } from "./fixtures";

test.describe("Theme", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") return { files: [], folders: [] };
        return null;
      };
    });
  });

  test("24.4 - theme toggle cycles System → Light → Dark", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".toolbar-btn", { hasText: "System" })).toBeVisible();
    // Click to go to Light
    await page.locator(".toolbar-btn", { hasText: "System" }).click();
    await expect(page.locator(".toolbar-btn", { hasText: "Light" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    // Click to go to Dark
    await page.locator(".toolbar-btn", { hasText: "Light" }).click();
    await expect(page.locator(".toolbar-btn", { hasText: "Dark" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    // Click to go back to System
    await page.locator(".toolbar-btn", { hasText: "Dark" }).click();
    await expect(page.locator(".toolbar-btn", { hasText: "System" })).toBeVisible();
  });
});
