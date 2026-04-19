import { test, expect } from "./fixtures";

test.describe("Comments Lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") return { files: [], folders: [] };
        if (cmd === "read_text_file") return "# Test\n\nContent paragraph.";
        if (cmd === "load_review_comments") return {
          version: 3,
          comments: [
            {
              id: "test-comment-1",
              anchorType: "line",
              lineNumber: 3,
              lineHash: "abc12345",
              text: "This needs review",
              createdAt: "2026-01-01T00:00:00Z",
              resolved: false,
              responses: [],
            },
          ],
        };
        if (cmd === "save_review_comments") return null;
        return null;
      };
    });
  });

  test("23.1 - app loads without errors for comments", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();
  });

  test("23.2 - v3 comments load without errors", async ({ page }) => {
    // beforeEach already returns v3 comments; just verify app boots cleanly
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();
  });

  test("23.3 - comments with responses load without errors", async ({ page }) => {
    await page.addInitScript(() => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") return { files: [], folders: [] };
        if (cmd === "read_text_file") return "# Test\n\nContent paragraph.";
        if (cmd === "load_review_comments") return {
          version: 3,
          comments: [
            {
              id: "test-comment-1",
              anchorType: "line",
              lineNumber: 3,
              lineHash: "abc12345",
              text: "This needs review",
              createdAt: "2026-01-01T00:00:00Z",
              resolved: false,
              responses: [
                { author: "agent-1", text: "Fixed this", createdAt: "2026-01-02T00:00:00Z" },
                { author: "agent-2", text: "Confirmed fix", createdAt: "2026-01-03T00:00:00Z" },
              ],
            },
          ],
        };
        if (cmd === "save_review_comments") return null;
        return null;
      };
    });
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();
  });

  test("23.4 - legacy sidecar (no version) loads without error", async ({ page }) => {
    await page.addInitScript(() => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") return { files: [], folders: [] };
        if (cmd === "read_text_file") return "# Test\n\nContent paragraph.";
        if (cmd === "load_review_comments") return {
          comments: [
            {
              id: "legacy-1",
              blockHash: "deadbeef",
              headingContext: null,
              fallbackLine: 5,
              text: "Old comment",
              createdAt: "2025-01-01T00:00:00Z",
              resolved: false,
            },
          ],
        };
        if (cmd === "save_review_comments") return null;
        return null;
      };
    });
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();
  });

  test("23.5 - null comments load without error", async ({ page }) => {
    await page.addInitScript(() => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") return { files: [], folders: [] };
        if (cmd === "read_text_file") return "# Test\n\nContent paragraph.";
        if (cmd === "load_review_comments") return null;
        if (cmd === "save_review_comments") return null;
        return null;
      };
    });
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();
  });

  test("23.6 - resolved comments load without error", async ({ page }) => {
    await page.addInitScript(() => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") return { files: [], folders: [] };
        if (cmd === "read_text_file") return "# Test\n\nContent paragraph.";
        if (cmd === "load_review_comments") return {
          version: 3,
          comments: [
            {
              id: "resolved-1",
              anchorType: "line",
              lineNumber: 1,
              lineHash: "ff001122",
              text: "Already addressed",
              createdAt: "2026-01-01T00:00:00Z",
              resolved: true,
              responses: [],
            },
          ],
        };
        if (cmd === "save_review_comments") return null;
        return null;
      };
    });
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();
  });
});
