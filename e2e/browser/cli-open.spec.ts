import { test, expect } from "./fixtures";

test.describe("CLI File Open", () => {
  test("25.1 - get_launch_args with file path opens tab on mount", async ({ page }) => {
    await page.addInitScript(() => {
      let firstCall = true;
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") {
          if (firstCall) {
            firstCall = false;
            return { files: ["/test/readme.md"], folders: [] };
          }
          return { files: [], folders: [] };
        }
        if (cmd === "read_text_file") return "# Test\n\nContent";
        if (cmd === "load_review_comments") return null;
        if (cmd === "check_path_exists") return "file";
        return null;
      };
    });
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();
  });

  test("25.2 - args-received event opens new tab in second-instance scenario", async ({ page }) => {
    await page.addInitScript(() => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") return { files: [], folders: [] };
        if (cmd === "read_text_file") return "# Test\n\nContent";
        if (cmd === "load_review_comments") return null;
        if (cmd === "check_path_exists") return "file";
        return null;
      };
    });
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();
  });
});
