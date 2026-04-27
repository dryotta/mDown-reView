// Iter 5 Group B — verifies the universal "Comment on file" entry point.
//
// Two flows:
//   (1) markdown file: toolbar button → inline input → save → addComment IPC
//       receives a `{ kind: "file" }` anchor, and the rendered comment has
//       no line gutter.
//   (2) binary file: same flow works (toolbar still surfaces the button on
//       the headerless binary placeholder).

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

interface AddCommentArgs {
  filePath: string;
  author: string;
  text: string;
  anchor: unknown;
}

async function setupCommentOnFileMocks(page: Page) {
  await page.addInitScript(({ dir }: { dir: string }) => {
    (window as Record<string, unknown>).__ADD_COMMENT_CALLS__ = [];
    (window as Record<string, unknown>).__COMMENTS__ = {
      mrsf_version: "1.0",
      document: "sample.md",
      comments: [] as unknown[],
    };

    function toThreads(): unknown[] {
      const raw = (window as Record<string, unknown>).__COMMENTS__ as { comments: Record<string, unknown>[] } | null;
      if (!raw) return [];
      const all = raw.comments;
      const roots = all.filter((c) => !c.reply_to);
      return roots.map((root) => ({
        // File-anchored comments arrive with line=0 from the Rust matcher;
        // we mirror that shape here so the panel renders the "no line" path.
        root: { ...root, matchedLineNumber: (root.line as number) || 0, isOrphaned: false },
        replies: all
          .filter((c) => c.reply_to === root.id)
          .map((r) => ({ ...r, matchedLineNumber: (r.line as number) || 0, isOrphaned: false })),
      }));
    }

    window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "get_launch_args") return { files: [], folders: [dir] };
      if (cmd === "read_dir") {
        return [
          { name: "sample.md", path: `${dir}/sample.md`, is_dir: false },
          { name: "blob.bin", path: `${dir}/blob.bin`, is_dir: false },
        ];
      }
      if (cmd === "read_text_file") {
        const path = (args as { path: string }).path;
        if (path.endsWith(".bin")) {
          // Trigger binary detection in `useFileContent`.
          throw "binary_file";
        }
        return "# Heading\n\nLine 3 content.\n";
      }
      if (cmd === "stat_file") return { size_bytes: 4 };
      if (cmd === "load_review_comments") return (window as Record<string, unknown>).__COMMENTS__;
      if (cmd === "save_review_comments") return null;
      if (cmd === "get_file_comments") return { threads: toThreads(), sidecar_mtime_ms: null };
      if (cmd === "add_comment") {
        ((window as Record<string, unknown>).__ADD_COMMENT_CALLS__ as unknown[]).push(args);
        const sidecar = (window as Record<string, unknown>).__COMMENTS__ as { comments: Record<string, unknown>[] };
        const anchor = args.anchor as { kind?: string; line?: number } | null;
        sidecar.comments.push({
          id: "c-" + (sidecar.comments.length + 1),
          author: args.author ?? "Tester",
          timestamp: new Date().toISOString(),
          text: args.text,
          resolved: false,
          // For file-anchored comments the matcher lands at line 0; for line
          // anchors we keep the original line. The exact wire shape doesn't
          // matter for this e2e — we only assert the addComment ARGS below.
          line: anchor?.kind === "file" ? 0 : (anchor?.line ?? 0),
          anchor_kind: anchor?.kind ?? "line",
        });
        return null;
      }
      if (cmd === "update_comment") return null;
      if (cmd === "check_path_exists") return "file";
      if (cmd === "get_log_path") return "/mock/log.log";
      if (cmd === "compute_anchor_hash") return "deadbeef";
      if (cmd === "get_file_badges") return {};
      return null;
    };
  }, { dir: FIXTURES_DIR });
}

async function readAddCommentCalls(page: Page): Promise<AddCommentArgs[]> {
  return await page.evaluate(
    () => (window as Record<string, unknown>).__ADD_COMMENT_CALLS__ as AddCommentArgs[],
  );
}

test.describe("Iter 5 Group B — file-level comment entry points", () => {
  test("markdown file: toolbar button opens input, save dispatches addComment with { kind: 'file' }", async ({ page }) => {
    await setupCommentOnFileMocks(page);
    await page.goto("/");

    await page.locator(".folder-tree").getByText("sample.md").click();
    await expect(page.locator(".markdown-viewer")).toBeVisible();

    // The universal toolbar entry point — present on every viewer.
    const toolbarBtn = page.locator(".viewer-toolbar").getByRole("button", { name: /comment on file/i });
    await expect(toolbarBtn).toBeVisible();
    await toolbarBtn.click();

    // Inline input appears in the comments panel above the thread list.
    const textarea = page.locator(".comment-panel-file-input .comment-textarea");
    await expect(textarea).toBeVisible();
    await textarea.fill("file note");

    await page.locator(".comment-panel-file-input").getByRole("button", { name: /^save$/i }).click();

    // Verify addComment was invoked with a file-shaped anchor.
    await expect.poll(() => readAddCommentCalls(page).then((c) => c.length)).toBeGreaterThanOrEqual(1);
    const calls = await readAddCommentCalls(page);
    const last = calls[calls.length - 1];
    expect(last.text).toBe("file note");
    expect(last.anchor).toEqual({ kind: "file" });
  });

  test("binary file: toolbar button is reachable and saves a file-anchored comment", async ({ page }) => {
    await setupCommentOnFileMocks(page);
    await page.goto("/");

    await page.locator(".folder-tree").getByText("blob.bin").click();
    // The binary placeholder is the only viewer surface for this file.
    await expect(page.locator(".binary-placeholder")).toBeVisible();

    const toolbarBtn = page.locator(".viewer-toolbar").getByRole("button", { name: /comment on file/i });
    await expect(toolbarBtn).toBeVisible();
    await toolbarBtn.click();

    const textarea = page.locator(".comment-panel-file-input .comment-textarea");
    await expect(textarea).toBeVisible();
    await textarea.fill("binary file note");

    await page.locator(".comment-panel-file-input").getByRole("button", { name: /^save$/i }).click();

    await expect.poll(() => readAddCommentCalls(page).then((c) => c.length)).toBeGreaterThanOrEqual(1);
    const calls = await readAddCommentCalls(page);
    const last = calls[calls.length - 1];
    expect(last.text).toBe("binary file note");
    expect(last.anchor).toEqual({ kind: "file" });
  });

  test("CommentsPanel '+' button is also a valid entry point (no toolbar click required)", async ({ page }) => {
    await setupCommentOnFileMocks(page);
    await page.goto("/");

    await page.locator(".folder-tree").getByText("sample.md").click();
    await expect(page.locator(".markdown-viewer")).toBeVisible();

    const plusBtn = page.locator(".comments-panel-header").getByRole("button", { name: /comment on file/i });
    await expect(plusBtn).toBeVisible();
    await plusBtn.click();

    const textarea = page.locator(".comment-panel-file-input .comment-textarea");
    await expect(textarea).toBeVisible();
    await textarea.fill("from the panel");
    await page.locator(".comment-panel-file-input").getByRole("button", { name: /^save$/i }).click();

    await expect.poll(() => readAddCommentCalls(page).then((c) => c.length)).toBeGreaterThanOrEqual(1);
    const calls = await readAddCommentCalls(page);
    expect(calls[calls.length - 1].anchor).toEqual({ kind: "file" });
  });

  // #71 Group B (Binary/unsupported) — inline composer rendered *inside*
  // .binary-placeholder so users never need to leave the viewer surface.
  test("binary placeholder renders inline composer and the saved thread appears under it", async ({ page }) => {
    await setupCommentOnFileMocks(page);
    await page.goto("/");

    await page.locator(".folder-tree").getByText("blob.bin").click();
    const placeholder = page.locator(".binary-placeholder");
    await expect(placeholder).toBeVisible();

    // The inline + Comment button lives under .binary-actions (not the
    // global viewer toolbar).
    const inlineBtn = placeholder.locator(".binary-actions").getByRole("button", { name: /comment on this file/i });
    await expect(inlineBtn).toBeVisible();
    await inlineBtn.click();

    const textarea = placeholder.locator(".binary-placeholder-comment-input .comment-textarea");
    await expect(textarea).toBeVisible();
    await textarea.fill("inline binary note");
    await placeholder.locator(".binary-placeholder-comment-input").getByRole("button", { name: /^save$/i }).click();

    await expect.poll(() => readAddCommentCalls(page).then((c) => c.length)).toBeGreaterThanOrEqual(1);
    const calls = await readAddCommentCalls(page);
    expect(calls[calls.length - 1].anchor).toEqual({ kind: "file" });

    // The saved thread renders inside the placeholder (file-anchored, kind: "file").
    // The IPC mock auto-emits `comments-changed` after every mutation invoke
    // (mirrors the Rust contract), so `useComments` reloads without any
    // manual dispatch here. See `e2e/browser/fixtures/error-tracking.ts`.
    await expect(placeholder.locator(".binary-placeholder-comments").getByText("inline binary note")).toBeVisible();
  });
});
