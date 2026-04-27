import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

/**
 * Wave 2 — Move-anchor UI end-to-end.
 *
 * Verifies that the "Move" button on a root comment thread enters a
 * transient re-anchor mode, that clicking a source line dispatches the
 * `update_comment` IPC with a `move_anchor` patch carrying the new
 * Anchor::Line, and that Esc / Cancel exit the mode.
 */

interface MockComment {
  id: string;
  author: string;
  timestamp: string;
  text: string;
  resolved: boolean;
  line?: number;
}

function setupMoveAnchorMock(page: Page, comments: MockComment[]) {
  return page.addInitScript(
    ({ dir, comments }: { dir: string; comments: MockComment[] }) => {
      (window as Record<string, unknown>).__UPDATE_COMMENT_CALLS__ = [];

      const threads = comments
        .filter((c) => !(c as Record<string, unknown>).reply_to)
        .map((root) => ({
          root: { ...root, matchedLineNumber: root.line ?? 0, isOrphaned: false },
          replies: [],
        }));

      window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "get_launch_args") return { files: [], folders: [dir] };
        if (cmd === "read_dir")
          return [{ name: "sample.md", path: `${dir}/sample.md`, is_dir: false }];
        if (cmd === "read_text_file")
          return "# Heading\n\nLine 3 content.\n\nLine 5 content.\n";
        if (cmd === "load_review_comments") return { mrsf_version: "1.0", comments };
        if (cmd === "get_file_comments") return { threads: threads, sidecar_mtime_ms: null };
        if (cmd === "update_comment") {
          ((window as Record<string, unknown>).__UPDATE_COMMENT_CALLS__ as unknown[]).push(args);
          return undefined;
        }
        if (cmd === "save_review_comments") return null;
        if (cmd === "check_path_exists") return "file";
        if (cmd === "get_log_path") return "/mock/log.log";
        return null;
      };
    },
    { dir: FIXTURES_DIR, comments },
  );
}

const SAMPLE_COMMENT: MockComment = {
  id: "comment-1",
  author: "Reviewer",
  timestamp: "2026-01-01T00:00:00Z",
  text: "Anchor me elsewhere",
  resolved: false,
  line: 3,
};

test.describe("Move-anchor UI", () => {
  test("Move button appears on root comment thread", async ({ page }) => {
    await setupMoveAnchorMock(page, [SAMPLE_COMMENT]);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("sample.md").click();
    await expect(page.getByText("Anchor me elsewhere")).toBeVisible();
    await expect(page.getByRole("button", { name: "Move", exact: true })).toBeVisible();
  });

  test("Clicking Move enters move mode (banner + body class)", async ({ page }) => {
    await setupMoveAnchorMock(page, [SAMPLE_COMMENT]);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("sample.md").click();
    await expect(page.getByText("Anchor me elsewhere")).toBeVisible();

    await page.getByRole("button", { name: "Move", exact: true }).click();

    await expect(page.getByTestId("move-anchor-banner")).toBeVisible();
    await expect(page.locator("body.mode-move-anchor")).toHaveCount(1);
  });

  test("Clicking a line commits the move via update_comment IPC", async ({ page }) => {
    await setupMoveAnchorMock(page, [SAMPLE_COMMENT]);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("sample.md").click();
    await expect(page.getByText("Anchor me elsewhere")).toBeVisible();

    await page.getByRole("button", { name: "Move", exact: true }).click();
    await expect(page.getByTestId("move-anchor-banner")).toBeVisible();

    // Click a rendered markdown line bearing data-source-line. Line 5 in the
    // fixture content is "Line 5 content." (1-indexed source line).
    const targetLine = page.locator("[data-source-line='5']").first();
    await targetLine.click();

    // Wait for the IPC mock to record the call (replaces a flaky fixed sleep).
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            ((window as Record<string, unknown>).__UPDATE_COMMENT_CALLS__ as unknown[]).length,
        ),
      )
      .toBeGreaterThan(0);

    const calls = await page.evaluate(
      () => (window as Record<string, unknown>).__UPDATE_COMMENT_CALLS__,
    );
    expect(Array.isArray(calls)).toBe(true);
    const moveCalls = (calls as Array<Record<string, unknown>>).filter(
      (c) => (c.patch as { kind: string }).kind === "move_anchor",
    );
    expect(moveCalls.length).toBeGreaterThanOrEqual(1);
    const first = moveCalls[0];
    expect(first.commentId).toBe("comment-1");
    const patch = first.patch as { kind: string; data: { new_anchor: { kind: string; line: number } } };
    expect(patch.data.new_anchor.kind).toBe("line");
    expect(patch.data.new_anchor.line).toBe(5);

    // Mode should have exited.
    await expect(page.getByTestId("move-anchor-banner")).not.toBeVisible();
    await expect(page.locator("body.mode-move-anchor")).toHaveCount(0);
  });

  test("Esc cancels move mode", async ({ page }) => {
    await setupMoveAnchorMock(page, [SAMPLE_COMMENT]);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("sample.md").click();
    await expect(page.getByText("Anchor me elsewhere")).toBeVisible();

    await page.getByRole("button", { name: "Move", exact: true }).click();
    await expect(page.getByTestId("move-anchor-banner")).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByTestId("move-anchor-banner")).not.toBeVisible();
    await expect(page.locator("body.mode-move-anchor")).toHaveCount(0);
  });

  test("Cancel move button exits the mode", async ({ page }) => {
    await setupMoveAnchorMock(page, [SAMPLE_COMMENT]);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("sample.md").click();
    await expect(page.getByText("Anchor me elsewhere")).toBeVisible();

    await page.getByRole("button", { name: "Move", exact: true }).click();
    // Now the action-row button label flips.
    const cancelBtn = page.getByRole("button", { name: "Cancel move", exact: true });
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    await expect(page.getByTestId("move-anchor-banner")).not.toBeVisible();
    await expect(page.locator("body.mode-move-anchor")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Move", exact: true })).toBeVisible();
  });

  test("Missed click does not exit move mode", async ({ page }) => {
    // Iter-4 P3: a click outside any [data-source-line] must NOT cancel
    // move mode. Only Esc, Cancel, or a real line-click exit the mode.
    await setupMoveAnchorMock(page, [SAMPLE_COMMENT]);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("sample.md").click();
    await expect(page.getByText("Anchor me elsewhere")).toBeVisible();

    await page.getByRole("button", { name: "Move", exact: true }).click();
    await expect(page.getByTestId("move-anchor-banner")).toBeVisible();

    // Click somewhere known to have no [data-source-line] / [data-line-idx]
    // ancestor — the toolbar background (away from any button) is safe.
    await page.locator(".toolbar").click({ position: { x: 2, y: 2 }, force: true });

    // No update_comment IPC must have fired.
    const calls = await page.evaluate(
      () => (window as Record<string, unknown>).__UPDATE_COMMENT_CALLS__,
    );
    expect((calls as unknown[]).length).toBe(0);

    // Mode still active: banner present, body class present, action button
    // still labelled "Cancel move".
    await expect(page.getByTestId("move-anchor-banner")).toBeVisible();
    await expect(page.locator("body.mode-move-anchor")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Cancel move", exact: true })).toBeVisible();
  });
});
