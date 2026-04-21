import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

function fileEntry(name: string, isDir = false) {
  return { name, path: `${FIXTURES_DIR}/${name}`, is_dir: isDir };
}

/**
 * Sets up Tauri IPC mocks with a file-change event simulation capability.
 * Returns a helper to dispatch file-changed events from test code.
 */
async function setupFileReloadMocks(
  page: Page,
  initialContent: string,
  initialComments: unknown = null
) {
  await page.addInitScript(
    ({ dir, content, comments }: { dir: string; content: string; comments: unknown }) => {
      // Mutable state the mock reads from — tests update these via page.evaluate()
      (window as Record<string, unknown>).__MOCK_FILE_CONTENT__ = content;
      (window as Record<string, unknown>).__MOCK_COMMENTS__ = comments;
      (window as Record<string, unknown>).__SAVE_CALLS__ = [];

      window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "get_launch_args")
          return { files: [], folders: [dir] };
        if (cmd === "read_dir")
          return [{ name: "test.md", path: `${dir}/test.md`, is_dir: false }];
        if (cmd === "read_text_file")
          return (window as Record<string, unknown>).__MOCK_FILE_CONTENT__;
        if (cmd === "load_review_comments")
          return (window as Record<string, unknown>).__MOCK_COMMENTS__;
        if (cmd === "save_review_comments") {
          ((window as Record<string, unknown>).__SAVE_CALLS__ as unknown[]).push(args);
          return null;
        }
        if (cmd === "check_path_exists") return "file";
        if (cmd === "get_log_path") return "/mock/log.log";
        return null;
      };
    },
    { dir: FIXTURES_DIR, content: initialContent, comments: initialComments }
  );
}

test.describe("File Change Reload", () => {
  test("content reloads when file-changed event fires with kind=content", async ({ page }) => {
    await setupFileReloadMocks(page, "# Original Content\n\nFirst version.");
    await page.goto("/");

    // Open the file
    await page.locator(".folder-tree").getByText("test.md").click();
    await expect(page.locator(".markdown-viewer")).toBeVisible();
    await expect(page.getByText("Original Content")).toBeVisible();

    // Update mock content and dispatch file-changed event
    await page.evaluate(() => {
      (window as Record<string, unknown>).__MOCK_FILE_CONTENT__ =
        "# Updated Content\n\nSecond version.";
      window.dispatchEvent(
        new CustomEvent("mdownreview:file-changed", {
          detail: { path: "/e2e/fixtures/test.md", kind: "content" },
        })
      );
    });

    // Verify content updated
    await expect(page.getByText("Updated Content")).toBeVisible();
  });

  test("comments reload when file-changed event fires with kind=review", async ({ page }) => {
    await setupFileReloadMocks(page, "# Test\n\nLine 3 content.");
    await page.goto("/");

    // Open the file
    await page.locator(".folder-tree").getByText("test.md").click();
    await expect(page.locator(".markdown-viewer")).toBeVisible();

    // Comments panel is enabled by default — should show "No comments yet"
    await expect(page.getByText("No comments yet")).toBeVisible();

    // Simulate external sidecar change: update mock comments and dispatch event
    await page.evaluate(() => {
      (window as Record<string, unknown>).__MOCK_COMMENTS__ = {
        mrsf_version: "1.0",
        document: "test.md",
        comments: [
          {
            id: "ext-1",
            author: "External (ext)",
            timestamp: "2026-01-01T00:00:00Z",
            text: "Comment from external tool",
            resolved: false,
            line: 3,
          },
        ],
      };
      window.dispatchEvent(
        new CustomEvent("mdownreview:file-changed", {
          detail: { path: "/e2e/fixtures/test.md.review.yaml", kind: "review" },
        })
      );
    });

    // Verify comment appears
    await expect(page.getByText("Comment from external tool")).toBeVisible();
  });

  test("file-changed event for different file does not affect current viewer", async ({ page }) => {
    await setupFileReloadMocks(page, "# Stay Put\n\nOriginal.");
    await page.goto("/");

    await page.locator(".folder-tree").getByText("test.md").click();
    await expect(page.getByText("Stay Put")).toBeVisible();

    // Dispatch event for a DIFFERENT file
    await page.evaluate(() => {
      (window as Record<string, unknown>).__MOCK_FILE_CONTENT__ = "# Should Not Appear";
      window.dispatchEvent(
        new CustomEvent("mdownreview:file-changed", {
          detail: { path: "/e2e/fixtures/other.md", kind: "content" },
        })
      );
    });

    // Original content should still be visible, updated content should NOT appear
    await expect(page.getByText("Stay Put")).toBeVisible();
    await expect(page.getByText("Should Not Appear")).not.toBeVisible();
  });
});
