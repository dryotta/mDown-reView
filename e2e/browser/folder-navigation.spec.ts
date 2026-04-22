import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

async function mockTauriInvoke(page: Page) {
  await page.addInitScript(() => {
    const dirData = {
      "/e2e/fixtures": [
        { name: "sample.md", path: "/e2e/fixtures/sample.md", is_dir: false },
        { name: "sample.ts", path: "/e2e/fixtures/sample.ts", is_dir: false },
        { name: "subfolder", path: "/e2e/fixtures/subfolder", is_dir: true },
      ],
      "/e2e/fixtures/subfolder": [
        { name: "deep.md", path: "/e2e/fixtures/subfolder/deep.md", is_dir: false },
        { name: "level2", path: "/e2e/fixtures/subfolder/level2", is_dir: true },
      ],
      "/e2e/fixtures/subfolder/level2": [
        { name: "level3", path: "/e2e/fixtures/subfolder/level2/level3", is_dir: true },
      ],
      "/e2e/fixtures/subfolder/level2/level3": [
        { name: "file4.md", path: "/e2e/fixtures/subfolder/level2/level3/file4.md", is_dir: false },
      ],
    };

    window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "get_launch_args") return { files: [], folders: [] };
      if (cmd === "read_dir") return (dirData as Record<string, unknown[]>)[(args as {path: string}).path] ?? [];
      if (cmd === "read_text_file") return "# Test\n\nContent";
      if (cmd === "load_review_comments") return null;
      if (cmd === "check_path_exists") return "file";
      return null;
    };
  });
}

test.describe("Folder Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await mockTauriInvoke(page);
  });

  test("21.1 - folder opens, .md file opens in tab, .ts routes to source viewer", async ({ page }) => {
    // Override mock to set folder as launch arg
    await page.addInitScript(() => {
      const origMock = window.__TAURI_IPC_MOCK__!;
      window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "get_launch_args") return { files: [], folders: ["/e2e/fixtures"] };
        return origMock(cmd, args);
      };
    });
    await page.goto("/");

    // Folder tree should be visible
    await expect(page.locator(".folder-tree")).toBeVisible();

    // Click on .md file → should open in markdown viewer
    await page.locator(".folder-tree").getByText("sample.md").click();
    await expect(page.locator(".markdown-viewer")).toBeVisible();

    // Click on .ts file → should open in source viewer
    await page.locator(".folder-tree").getByText("sample.ts").click();
    await expect(page.locator(".source-view")).toBeVisible();
  });

  test("21.2 - keyboard navigation in tree", async ({ page }) => {
    await page.addInitScript(() => {
      const origMock = window.__TAURI_IPC_MOCK__!;
      window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "get_launch_args") return { files: [], folders: ["/e2e/fixtures"] };
        return origMock(cmd, args);
      };
    });
    await page.goto("/");
    await expect(page.locator(".folder-tree")).toBeVisible();

    // Focus on the first tree item
    const firstItem = page.locator(".folder-tree [data-path]").first();
    await firstItem.click();

    // Press ArrowDown to move to next item
    await page.keyboard.press("ArrowDown");

    // Press Enter to open the focused item
    await page.keyboard.press("Enter");

    // Verify that a tab was opened (tab bar should have at least one tab)
    // OR that a folder was expanded (has aria-expanded=true)
    const tabOpened = page.locator(".tab-bar .tab");
    const expandedFolder = page.locator('.folder-tree [aria-expanded="true"]');
    const result = await Promise.race([
      tabOpened.first().waitFor({ timeout: 2000 }).then(() => "tab"),
      expandedFolder.first().waitFor({ timeout: 2000 }).then(() => "expanded"),
    ]).catch(() => "neither");

    expect(["tab", "expanded"]).toContain(result);
  });

  test("21.3 - filter hides non-matching files", async ({ page }) => {
    await page.addInitScript(() => {
      const origMock = window.__TAURI_IPC_MOCK__!;
      window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "get_launch_args") return { files: [], folders: ["/e2e/fixtures"] };
        return origMock(cmd, args);
      };
    });
    await page.goto("/");
    await expect(page.locator(".folder-tree")).toBeVisible();

    // Both files should be visible initially
    await expect(page.locator(".folder-tree").getByText("sample.md")).toBeVisible();
    await expect(page.locator(".folder-tree").getByText("sample.ts")).toBeVisible();

    // Use the correct filter input selector
    const filterInput = page.locator(".folder-tree-filter");
    await expect(filterInput).toBeVisible();
    await filterInput.fill("sample.md");

    // .ts file should be hidden
    await expect(page.locator(".folder-tree").getByText("sample.ts")).not.toBeVisible();
    // .md file should still be visible
    await expect(page.locator(".folder-tree").getByText("sample.md")).toBeVisible();
  });

  test("21.4 - folder tree shows close button and auto-reveal toggle", async ({ page }) => {
    await page.addInitScript(() => {
      const origMock = window.__TAURI_IPC_MOCK__!;
      window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "get_launch_args") return { files: [], folders: ["/e2e/fixtures"] };
        return origMock(cmd, args);
      };
    });
    await page.goto("/");
    await expect(page.locator(".folder-tree")).toBeVisible();

    // Close button should be visible in the folder tree header
    const closeBtn = page.locator('button[title="Close folder"]');
    await expect(closeBtn).toBeVisible();

    // Auto-reveal toggle (📍) should be visible
    const revealToggle = page.locator('button[title*="Auto-reveal"]');
    await expect(revealToggle).toBeVisible();
  });
});
