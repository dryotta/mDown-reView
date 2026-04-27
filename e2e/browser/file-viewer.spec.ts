import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

function fileEntry(name: string, isDir = false) {
  return { name, path: `${FIXTURES_DIR}/${name}`, is_dir: isDir };
}

async function setupViewerMocks(page: Page, files: ReturnType<typeof fileEntry>[], fileContents: Record<string, string>) {
  await page.addInitScript(({ dir, files, contents }: { dir: string; files: unknown[]; contents: Record<string, string> }) => {
    window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "get_launch_args") return { files: [], folders: [dir] };
      if (cmd === "read_dir") return files;
      if (cmd === "read_text_file") {
        const path = (args as { path: string }).path;
        if (contents[path] !== undefined) return contents[path];
        return "# Default content";
      }
      if (cmd === "load_review_comments") return null;
      if (cmd === "save_review_comments") return null;
      if (cmd === "get_log_path") return "/mock/log.log";
      if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
      return null;
    };
  }, {
    dir: FIXTURES_DIR,
    files,
    contents: fileContents,
  });
}

test.describe("Enhanced File Viewer", () => {
  test("JSON file opens with tree view and source toggle works", async ({ page }) => {
    const jsonContent = JSON.stringify({ name: "test", items: [1, 2] }, null, 2);
    await setupViewerMocks(page, [
      fileEntry("data.json"),
    ], {
      [`${FIXTURES_DIR}/data.json`]: jsonContent,
    });

    await page.goto("/");

    // Click on the JSON file in the tree
    await page.locator(".folder-tree").getByText("data.json").click();

    // Should show the viewer toolbar with Source/Visual toggle
    await expect(page.locator("[role=toolbar]")).toBeVisible();

    // JSON defaults to visual view - should show the JSON tree
    await expect(page.locator(".json-tree")).toBeVisible();

    // Toggle to source view
    await page.getByRole("button", { name: /source/i }).click();

    // JSON tree should be hidden, source view should be visible
    await expect(page.locator(".json-tree")).not.toBeVisible();
  });

  test("CSV file opens with sortable table", async ({ page }) => {
    const csvContent = "Name,Age,City\nAlice,30,New York\nBob,25,San Francisco";
    await setupViewerMocks(page, [
      fileEntry("data.csv"),
    ], {
      [`${FIXTURES_DIR}/data.csv`]: csvContent,
    });

    await page.goto("/");
    await page.locator(".folder-tree").getByText("data.csv").click();

    // Should show toolbar
    await expect(page.locator("[role=toolbar]")).toBeVisible();

    // CSV defaults to visual view - should show table
    await expect(page.locator(".csv-table")).toBeVisible();

    // Table should show headers
    await expect(page.getByText("Name")).toBeVisible();
    await expect(page.getByText("Age")).toBeVisible();
  });

  test("HTML file opens in source mode with visual toggle to preview", async ({ page }) => {
    const htmlContent = "<!DOCTYPE html><html><body><h1>Hello</h1></body></html>";
    await setupViewerMocks(page, [
      fileEntry("page.html"),
    ], {
      [`${FIXTURES_DIR}/page.html`]: htmlContent,
    });

    await page.goto("/");
    await page.locator(".folder-tree").getByText("page.html").click();

    // Should show toolbar
    await expect(page.locator("[role=toolbar]")).toBeVisible();

    // HTML defaults to source view
    const sourceBtn = page.getByRole("button", { name: /source/i });
    await expect(sourceBtn).toHaveAttribute("aria-pressed", "true");

    // Toggle to visual
    await page.getByRole("button", { name: /visual/i }).click();

    // Should show HTML preview with iframe
    await expect(page.locator("iframe[title='HTML preview']")).toBeVisible();
  });

  test("Markdown file has source/visual toggle", async ({ page }) => {
    const mdContent = "# Hello World\n\nThis is **markdown**.";
    await setupViewerMocks(page, [
      fileEntry("readme.md"),
    ], {
      [`${FIXTURES_DIR}/readme.md`]: mdContent,
    });

    await page.goto("/");
    await page.locator(".folder-tree").getByText("readme.md").click();

    // Should show toolbar (markdown has visualization)
    await expect(page.locator("[role=toolbar]")).toBeVisible();

    // Markdown defaults to visual view
    await expect(page.locator(".markdown-viewer")).toBeVisible();

    // Toggle to source
    await page.getByRole("button", { name: /source/i }).click();

    // Markdown viewer should be hidden
    await expect(page.locator(".markdown-viewer")).not.toBeVisible();
  });

  test("Plain text file shows source view with wrap button only", async ({ page }) => {
    await setupViewerMocks(page, [
      fileEntry("notes.txt"),
    ], {
      [`${FIXTURES_DIR}/notes.txt`]: "Just some plain text.",
    });

    await page.goto("/");
    await page.locator(".folder-tree").getByText("notes.txt").click();

    // Should show toolbar with wrap button but no Source/Visual toggle
    await expect(page.locator("[role=toolbar]")).toBeVisible();
    await expect(page.getByRole("button", { name: /wrap/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /source/i })).not.toBeVisible();
  });

  test("View mode persists per tab when switching", async ({ page }) => {
    const jsonContent = '{"a": 1}';
    const csvContent = "X,Y\n1,2";
    await setupViewerMocks(page, [
      fileEntry("data.json"),
      fileEntry("data.csv"),
    ], {
      [`${FIXTURES_DIR}/data.json`]: jsonContent,
      [`${FIXTURES_DIR}/data.csv`]: csvContent,
    });

    await page.goto("/");

    // Open JSON, switch to source
    await page.locator(".folder-tree").getByText("data.json").click();
    await page.getByRole("button", { name: /source/i }).click();

    // Open CSV (stays in visual default)
    await page.locator(".folder-tree").getByText("data.csv").click();
    await expect(page.locator(".csv-table")).toBeVisible();

    // Switch back to JSON tab - should still be in source mode
    await page.locator(".tab-bar").getByText("data.json").click();
    const sourceBtn = page.getByRole("button", { name: /source/i });
    await expect(sourceBtn).toHaveAttribute("aria-pressed", "true");
  });
});
