import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

async function setupPersistenceMocks(page: Page) {
  await page.addInitScript(({ dir }: { dir: string }) => {
    window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "get_launch_args") return { files: [], folders: [dir] };
      if (cmd === "read_dir")
        return [{ name: "readme.md", path: `${dir}/readme.md`, is_dir: false }];
      if (cmd === "read_text_file") return "# Persistence Test\n\nContent.";
      if (cmd === "load_review_comments") return null;
      if (cmd === "save_review_comments") return null;
      if (cmd === "check_path_exists") return "file";
      if (cmd === "get_log_path") return "/mock/log.log";
      if (cmd === "get_file_comments") return [];
      return null;
    };
  }, { dir: FIXTURES_DIR });
}

test.describe("State Persistence Across Refresh", () => {
  // Theme persistence is covered by unit tests:
  //   - src/__tests__/store/persistence.test.ts ("persists theme through all valid values")
  //   - src/hooks/__tests__/useApplyTheme.test.ts (DOM data-theme attribute application)
  //   - src/__tests__/App.test.tsx ("menu-theme-light event sets theme to light")
  // The toolbar Theme button was removed in favour of the application menu (issue #41,
  // Group A), so there is no e2e UI surface left to drive theme changes from the browser
  // harness without dispatching synthetic Tauri menu events — which adds no coverage on
  // top of the unit suites.

  test("workspace root survives page reload and folder tree is visible", async ({ page }) => {
    await setupPersistenceMocks(page);
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();

    // Folder tree should be visible (workspace root set via launch args)
    await expect(page.locator(".folder-tree")).toBeVisible();
    await expect(page.locator(".folder-tree").getByText("readme.md")).toBeVisible();

    // Reload page
    await page.reload();
    await expect(page.locator(".app-layout")).toBeVisible();

    // Folder tree should still be visible with the same file listed
    await expect(page.locator(".folder-tree")).toBeVisible();
    await expect(page.locator(".folder-tree").getByText("readme.md")).toBeVisible();
  });

  test("comments panel visibility survives page reload", async ({ page }) => {
    await setupPersistenceMocks(page);
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();

    // Open a file — comments panel is enabled by default
    await page.locator(".folder-tree").getByText("readme.md").click();
    await expect(page.locator(".comments-panel")).toBeVisible();

    // Toggle comments panel OFF
    await page.locator('button[title*="Toggle comments"]').click();
    await expect(page.locator(".comments-panel")).not.toBeVisible();

    // Reload page
    await page.reload();
    await expect(page.locator(".app-layout")).toBeVisible();

    // After reload, open file again — comments panel should still be OFF
    await page.locator(".folder-tree").getByText("readme.md").click();
    await expect(page.locator(".comments-panel")).not.toBeVisible();
  });

  test("author name persists across page reload", async ({ page }) => {
    await setupPersistenceMocks(page);
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();

    // Inject author name directly into localStorage in the format Zustand persist uses
    await page.evaluate(() => {
      const key = "mdownreview-ui";
      const raw = localStorage.getItem(key);
      const data = raw ? JSON.parse(raw) : { state: {}, version: 0 };
      data.state.authorName = "Test Author (test)";
      localStorage.setItem(key, JSON.stringify(data));
    });

    // Reload so the app rehydrates from localStorage
    await page.reload();
    await expect(page.locator(".app-layout")).toBeVisible();

    // Verify the author name survived the reload
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem("mdownreview-ui");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.state?.authorName ?? null;
    });

    expect(stored).toBe("Test Author (test)");
  });
});
