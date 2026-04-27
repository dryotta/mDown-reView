import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

/**
 * F1 — keyboard shortcuts e2e.
 *
 * Verifies the J/K/N/R/Ctrl+Shift+M/Esc keystrokes drive the comment
 * navigation slice and the resolveFocusedThread VM action end-to-end.
 *
 * Mock setup mirrors `comments.spec.ts` so the same fixture pattern is
 * shared. The mock returns 3 unresolved + 1 resolved threads on
 * sample.md so we can assert J advances through them and that R
 * triggers an `update_comment` IPC call routing through the chokepoint.
 */
function setupKeyboardShortcutsMock(page: Page) {
  return page.addInitScript((dir: string) => {
    (window as Record<string, unknown>).__RESOLVE_CALLS__ = [];
    (window as Record<string, unknown>).__SCROLL_CALLS__ = [];

    // Wire the scroll-to-line CustomEvent to a JS-side recorder so the
    // test can assert the slice dispatched it (the real source-line
    // listener may not be active in the mock viewer).
    window.addEventListener("scroll-to-line", (e) => {
      const detail = (e as CustomEvent<{ line: number }>).detail;
      ((window as Record<string, unknown>).__SCROLL_CALLS__ as unknown[]).push(detail.line);
    });

    const threads = [
      { id: "t1", line: 1, resolved: false, text: "First unresolved" },
      { id: "t2", line: 3, resolved: false, text: "Second unresolved" },
      { id: "t3", line: 5, resolved: false, text: "Third unresolved" },
      { id: "t4", line: 7, resolved: true, text: "Resolved one" },
    ];

    const toThreads = () =>
      threads.map((c) => ({
        root: {
          id: c.id,
          author: "Reviewer (rev)",
          timestamp: "2026-01-01T00:00:00Z",
          text: c.text,
          resolved: c.resolved,
          line: c.line,
          matchedLineNumber: c.line,
          isOrphaned: false,
        },
        replies: [],
      }));

    window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "get_launch_args") return { files: [], folders: [dir] };
      if (cmd === "read_dir")
        return [{ name: "sample.md", path: `${dir}/sample.md`, is_dir: false }];
      if (cmd === "read_text_file")
        return "line 1 word\nline 2\nline 3 selectable text\nline 4\nline 5\nline 6\nline 7";
      if (cmd === "get_file_comments") return { threads: toThreads(), sidecar_mtime_ms: null };
      if (cmd === "get_file_badges") return {};
      if (cmd === "update_comment") {
        ((window as Record<string, unknown>).__RESOLVE_CALLS__ as unknown[]).push(args);
        // Mark the thread resolved in the in-page mock.
        const id = args.commentId as string;
        const t = threads.find((x) => x.id === id);
        if (t) t.resolved = true;
        return null;
      }
      if (cmd === "check_path_exists") return "file";
      if (cmd === "get_log_path") return "/mock/log.log";
      return null;
    };
  }, FIXTURES_DIR);
}

test.describe("F1 keyboard shortcuts", () => {
  test("J advances focusedThreadId through unresolved threads", async ({ page }) => {
    await setupKeyboardShortcutsMock(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("sample.md").click();
    await expect(page.getByText("First unresolved")).toBeVisible();

    // First J → focuses t1 (no prior focus).
    await page.locator("body").focus();
    await page.keyboard.press("j");
    await page.waitForFunction(() => {
      const w = window as unknown as { __SCROLL_CALLS__?: number[] };
      return (w.__SCROLL_CALLS__ ?? []).length >= 1;
    });
    let scrolls = await page.evaluate(
      () => (window as Record<string, unknown>).__SCROLL_CALLS__,
    );
    expect(scrolls).toEqual([1]);

    // Second J → advances to t2.
    await page.keyboard.press("j");
    await page.waitForFunction(() => {
      const w = window as unknown as { __SCROLL_CALLS__?: number[] };
      return (w.__SCROLL_CALLS__ ?? []).length >= 2;
    });
    scrolls = await page.evaluate(
      () => (window as Record<string, unknown>).__SCROLL_CALLS__,
    );
    expect(scrolls).toEqual([1, 3]);
  });

  test("R routes through update_comment for the focused thread", async ({ page }) => {
    await setupKeyboardShortcutsMock(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("sample.md").click();
    await expect(page.getByText("First unresolved")).toBeVisible();

    // J focuses t1 first.
    await page.locator("body").focus();
    await page.keyboard.press("j");
    await page.waitForFunction(() => {
      const w = window as unknown as { __SCROLL_CALLS__?: number[] };
      return (w.__SCROLL_CALLS__ ?? []).length >= 1;
    });

    // R → resolveFocusedThread → updateComment(t1, set_resolved=true).
    await page.keyboard.press("r");
    await page.waitForFunction(() => {
      const w = window as unknown as { __RESOLVE_CALLS__?: unknown[] };
      return (w.__RESOLVE_CALLS__ ?? []).length >= 1;
    });
    const calls = (await page.evaluate(
      () => (window as Record<string, unknown>).__RESOLVE_CALLS__,
    )) as Array<Record<string, unknown>>;
    expect(calls.length).toBe(1);
    expect(calls[0].commentId).toBe("t1");
    const patch = calls[0].patch as { kind: string; data: { resolved: boolean } };
    expect(patch.kind).toBe("set_resolved");
    expect(patch.data.resolved).toBe(true);
  });

  test("Esc closes an open inline comment composer", async ({ page }) => {
    await setupKeyboardShortcutsMock(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("sample.md").click();
    await expect(page.getByText("First unresolved")).toBeVisible();

    // Open the file-level composer via the panel "+" so we have a
    // textarea to dismiss. The composer mounts under .comment-input.
    // (The viewer toolbar exposes a button with the same accessible
    // name; scope to the comments panel to disambiguate.)
    await page.locator(".comments-panel").getByRole("button", { name: /Comment on file/i }).click();
    const textarea = page.locator(".comment-input textarea");
    await expect(textarea).toBeVisible();

    // Esc fires the textarea's onKeyDown handler, which clears the
    // draft and unmounts the composer. There is no global Esc shortcut
    // — that branch was removed in iter-5 (C2 forward fix).
    await textarea.focus();
    await page.keyboard.press("Escape");
    await expect(textarea).toBeHidden();
  });

  test("Ctrl+Shift+M after selecting text triggers selection-toolbar add path", async ({ page }) => {
    await setupKeyboardShortcutsMock(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("sample.md").click();
    await expect(page.locator(".markdown-viewer, .source-view")).toBeVisible();

    // Instrument: spy on document-level mouseup dispatch so we can verify
    // App.tsx's startCommentOnSelection callback actually runs (it
    // dispatches a synthetic mouseup at the selection's end element to
    // re-use the existing selection-toolbar pipeline).
    await page.evaluate(() => {
      const w = window as Record<string, unknown>;
      w.__SYNTHETIC_MOUSEUPS__ = 0;
      const orig = EventTarget.prototype.dispatchEvent;
      EventTarget.prototype.dispatchEvent = function (ev: Event) {
        if (ev.type === "mouseup" && (ev as MouseEvent).bubbles) {
          w.__SYNTHETIC_MOUSEUPS__ = (w.__SYNTHETIC_MOUSEUPS__ as number) + 1;
        }
        return orig.call(this, ev);
      };
    });

    // Place a selection inside the viewer body so the App callback has
    // something to act on. The exact DOM target varies by viewer mode;
    // selecting any contained text is enough to make `getSelection()`
    // return a non-collapsed range.
    await page.evaluate(() => {
      const root =
        document.querySelector(".markdown-body") ||
        document.querySelector(".source-lines") ||
        document.querySelector(".markdown-viewer") ||
        document.body;
      const target = root.querySelector("p, [data-source-line], [data-line-idx], code, span") || root;
      const range = document.createRange();
      if (target.firstChild) {
        range.selectNodeContents(target);
      } else {
        range.selectNode(target);
      }
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });

    await page.locator("body").focus();
    await page.keyboard.press("Control+Shift+M");
    // T1 (iter-5): replace the brittle 150ms sleep with a deterministic
    // wait — the assertion below is on the synthetic-mouseup counter, so
    // poll it instead of guessing.
    await page.waitForFunction(() => {
      const w = window as Record<string, unknown>;
      return ((w.__SYNTHETIC_MOUSEUPS__ as number) ?? 0) >= 1;
    });

    // The contract: App.tsx's callback ran (verified by the synthetic
    // mouseup it dispatches). Whether the SelectionToolbar/CommentInput
    // actually mounts depends on viewer-specific data attributes which
    // are exercised by Group B/D2 e2e specs.
    const synthetic = (await page.evaluate(
      () => (window as Record<string, unknown>).__SYNTHETIC_MOUSEUPS__,
    )) as number;
    expect(synthetic).toBeGreaterThanOrEqual(1);
  });
});
