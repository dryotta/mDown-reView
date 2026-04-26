import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

function setupCommentMock(page: Page, comments: unknown) {
  return page.addInitScript(
    ({ dir, comments }: { dir: string; comments: unknown }) => {
      (window as Record<string, unknown>).__SAVE_CALLS__ = [];
      (window as Record<string, unknown>).__RESOLVE_CALLS__ = [];

      function toThreads(raw: Record<string, unknown> | null): unknown[] {
        if (!raw || !Array.isArray((raw as Record<string, unknown>).comments)) return [];
        const allComments = (raw as Record<string, unknown>).comments as Record<string, unknown>[];
        if (allComments.length === 0) return [];
        const roots = allComments.filter(c => !c.reply_to);
        return roots.map(root => ({
          root: { ...root, matchedLineNumber: (root.line as number) || 0, isOrphaned: false },
          replies: allComments
            .filter(c => c.reply_to === root.id)
            .map(r => ({ ...r, matchedLineNumber: (r.line as number) || 0, isOrphaned: false })),
        }));
      }

      window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "get_launch_args")
          return { files: [], folders: [dir] };
        if (cmd === "read_dir")
          return [{ name: "sample.md", path: `${dir}/sample.md`, is_dir: false }];
        if (cmd === "read_text_file")
          return "# Test Heading\n\nContent paragraph on line 3.\n\nMore content on line 5.";
        if (cmd === "load_review_comments") return comments;
        if (cmd === "save_review_comments") {
          ((window as Record<string, unknown>).__SAVE_CALLS__ as unknown[]).push(args);
          return null;
        }
        if (cmd === "get_file_comments") return toThreads(comments as Record<string, unknown> | null);
        if (cmd === "update_comment") {
          ((window as Record<string, unknown>).__RESOLVE_CALLS__ as unknown[]).push(args);
          return null;
        }
        if (cmd === "check_path_exists") return "file";
        if (cmd === "get_log_path") return "/mock/log.log";
        return null;
      };
    },
    { dir: FIXTURES_DIR, comments }
  );
}

test.describe("Comments Lifecycle", () => {
  test("23.1 - app loads without errors for comments", async ({ page }) => {
    await setupCommentMock(page, null);
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();
  });

  test("23.2 - MRSF v1.0 comments display in comments panel", async ({ page }) => {
    await setupCommentMock(page, {
      mrsf_version: "1.0",
      document: "sample.md",
      comments: [
        {
          id: "test-comment-1",
          author: "Reviewer (rev)",
          timestamp: "2026-01-01T00:00:00Z",
          text: "This needs review",
          resolved: false,
          line: 3,
        },
      ],
    });
    await page.goto("/");

    // Open file — comments panel is enabled by default
    await page.locator(".folder-tree").getByText("sample.md").click();

    // Verify comment text is visible in the comments panel (already open by default)
    await expect(page.getByText("This needs review")).toBeVisible();
  });

  test("23.3 - comments with replies load and display", async ({ page }) => {
    await setupCommentMock(page, {
      mrsf_version: "1.0",
      document: "sample.md",
      comments: [
        {
          id: "parent-1",
          author: "Reviewer (rev)",
          timestamp: "2026-01-01T00:00:00Z",
          text: "Parent comment",
          resolved: false,
          line: 3,
        },
        {
          id: "reply-1",
          author: "Agent (agent)",
          timestamp: "2026-01-02T00:00:00Z",
          text: "Reply from agent",
          resolved: false,
          reply_to: "parent-1",
          line: 3,
        },
      ],
    });
    await page.goto("/");

    await page.locator(".folder-tree").getByText("sample.md").click();

    // Comments panel is enabled by default
    await expect(page.getByText("Parent comment")).toBeVisible();
    await expect(page.getByText("Reply from agent")).toBeVisible();
  });

  test("23.4 - legacy sidecar (no version) loads without error", async ({ page }) => {
    await setupCommentMock(page, {
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
    });
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();

    // Open the file — app should not crash on legacy format
    await page.locator(".folder-tree").getByText("sample.md").click();
    await expect(page.locator(".markdown-viewer")).toBeVisible();

    // The comments panel should be visible (on by default) without error
    await expect(page.locator(".comments-panel")).toBeVisible();
  });

  test("23.5 - null comments load without error", async ({ page }) => {
    await setupCommentMock(page, null);
    await page.goto("/");

    await page.locator(".folder-tree").getByText("sample.md").click();

    // Comments panel is enabled by default — should show empty state
    await expect(page.getByText("No comments yet")).toBeVisible();
  });

  test("23.6 - resolved comments are hidden by default", async ({ page }) => {
    await setupCommentMock(page, {
      mrsf_version: "1.0",
      document: "sample.md",
      comments: [
        {
          id: "resolved-1",
          author: "Reviewer (rev)",
          timestamp: "2026-01-01T00:00:00Z",
          text: "Already addressed",
          resolved: true,
          line: 1,
        },
      ],
    });
    await page.goto("/");

    await page.locator(".folder-tree").getByText("sample.md").click();

    // Comments panel is on by default — resolved comments should be hidden
    await expect(page.getByText("Already addressed")).not.toBeVisible();

    // "Show resolved" button should be visible with count
    const showResolvedBtn = page.getByRole("button", { name: /Show resolved/i });
    await expect(showResolvedBtn).toBeVisible();

    // Click to reveal resolved comments
    await showResolvedBtn.click();
    await expect(page.getByText("Already addressed")).toBeVisible();
  });

  test("23.7 - update_comment is called when comment is resolved", async ({ page }) => {
    await setupCommentMock(page, {
      mrsf_version: "1.0",
      document: "sample.md",
      comments: [
        {
          id: "save-test-1",
          author: "Reviewer (rev)",
          timestamp: "2026-01-01T00:00:00Z",
          text: "Please fix this",
          resolved: false,
          line: 3,
        },
      ],
    });
    await page.goto("/");

    // Open file — comment should appear in panel
    await page.locator(".folder-tree").getByText("sample.md").click();
    await expect(page.getByText("Please fix this")).toBeVisible();

    // Click "Resolve" button (exact match to avoid "Show resolved" button)
    const resolveBtn = page.getByRole("button", { name: "Resolve", exact: true });
    await expect(resolveBtn).toBeVisible();
    await resolveBtn.click();

    // Wait for IPC call to complete
    await page.waitForTimeout(1500);

    // Verify update_comment was called
    const resolveCalls = await page.evaluate(
      () => (window as Record<string, unknown>).__RESOLVE_CALLS__
    );
    expect(Array.isArray(resolveCalls)).toBe(true);
    expect((resolveCalls as unknown[]).length).toBeGreaterThanOrEqual(1);
    const first = (resolveCalls as Array<Record<string, unknown>>)[0];
    const patch = first.patch as { kind: string; data: { resolved: boolean } };
    expect(patch.kind).toBe("set_resolved");
    expect(patch.data.resolved).toBe(true);
  });

  // Iter 6 F2 — Export review summary button copies markdown to clipboard.
  test("23.8 - Export button calls export_review_summary IPC", async ({ page }) => {
    await page.addInitScript(({ dir }: { dir: string }) => {
      (window as Record<string, unknown>).__EXPORT_CALLS__ = [];
      window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "get_launch_args") return { files: [], folders: [dir] };
        if (cmd === "read_dir")
          return [{ name: "sample.md", path: `${dir}/sample.md`, is_dir: false }];
        if (cmd === "read_text_file") return "# x\n";
        if (cmd === "get_file_comments") return [];
        if (cmd === "load_review_comments") return null;
        if (cmd === "check_path_exists") return "file";
        if (cmd === "get_log_path") return "/mock/log.log";
        if (cmd === "export_review_summary") {
          ((window as Record<string, unknown>).__EXPORT_CALLS__ as unknown[]).push(args);
          return "# Review Summary\n\n(no threads)";
        }
        return null;
      };
    }, { dir: FIXTURES_DIR });

    await page.goto("/");
    await page.locator(".folder-tree").getByText("sample.md").click();

    const exportBtn = page.getByRole("button", { name: /export review summary/i });
    await expect(exportBtn).toBeVisible();
    await exportBtn.click();

    // Either success or failure status surfaces (clipboard may be denied in
    // headless contexts) — both prove the export branch ran end-to-end.
    await expect(page.locator(".comments-panel-status")).toBeVisible();
    const calls = await page.evaluate(
      () => (window as Record<string, unknown>).__EXPORT_CALLS__,
    );
    expect((calls as unknown[]).length).toBe(1);
    expect((calls as Array<Record<string, unknown>>)[0]).toHaveProperty("workspace");
  });
});

