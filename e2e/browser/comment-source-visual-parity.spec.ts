// Issue #280 AC1 (same-window): a comment authored at file-line N in source
// view must surface as a gutter badge at the body block whose
// `data-source-line="N"` after switching to the visual viewer — even when the
// document begins with a YAML frontmatter block.
//
// Iter 1 (Rust core) introduced `original_line` and the orphan flag. Iter 2
// makes the visual pipeline file-coord end-to-end by adding `remark-frontmatter`
// (so GFM doesn't eat `---`) and by feeding the raw `content` into
// ReactMarkdown / extractHeadings / lines / find-in-page so mdast
// `position.start.line` matches the file coordinate.
//
// Pre-iter-2 behaviour (RED): with 5 frontmatter lines + body, a comment
// authored at file-line 9 lands on a block stamped `data-source-line="4"`
// (5-line offset) and the gutter badge doesn't appear at line 9 in visual.
// Post-iter-2 (GREEN): the gutter badge appears at `data-source-line="9"`.

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

// 5-line frontmatter + body; file-line 9 is the heading "Body Heading 4".
const DOC = [
  "---", // line 1
  "title: Frontmatter Doc", // 2
  "author: Tester", // 3
  "tags: [a, b]", // 4
  "---", // 5
  "", // 6
  "First paragraph after frontmatter.", // 7
  "", // 8
  "## Body Heading 4", // 9  ← comment lives here
  "", // 10
  "Second paragraph.", // 11
  "", // 12
  "Third paragraph.", // 13
  "",
].join("\n");

async function setupMocks(page: Page) {
  await page.addInitScript(({ dir, body }: { dir: string; body: string }) => {
    // One pre-existing line-9 comment, surfacing the iter-2 mapping.
    (window as Record<string, unknown>).__COMMENTS__ = {
      mrsf_version: "1.0",
      document: "fm.md",
      comments: [
        {
          id: "c-line-9",
          author: "Tester",
          timestamp: new Date().toISOString(),
          text: "comment on file-line 9",
          resolved: false,
          line: 9,
          anchor_kind: "line",
        },
      ] as Record<string, unknown>[],
    };
    function toThreads(): unknown[] {
      const raw = (window as Record<string, unknown>).__COMMENTS__ as
        | { comments: Record<string, unknown>[] }
        | null;
      if (!raw) return [];
      const all = raw.comments;
      const roots = all.filter((c) => !c.reply_to);
      return roots.map((root) => ({
        // Iter 1 wire shape: matchedLineNumber + isOrphaned + originalLine.
        // For a clean line-9 comment, matched = original = 9, orphaned = false.
        root: {
          ...root,
          matchedLineNumber: (root.line as number) || 0,
          originalLine: (root.line as number) || null,
          isOrphaned: false,
        },
        replies: all
          .filter((c) => c.reply_to === root.id)
          .map((r) => ({
            ...r,
            matchedLineNumber: (r.line as number) || 0,
            originalLine: (r.line as number) || null,
            isOrphaned: false,
          })),
      }));
    }
    window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "get_launch_args") return { files: [], folders: [dir] };
      if (cmd === "read_dir") return [{ name: "fm.md", path: `${dir}/fm.md`, is_dir: false }];
      if (cmd === "read_text_file") return body;
      if (cmd === "stat_file") return { size_bytes: body.length };
      if (cmd === "load_review_comments")
        return (window as Record<string, unknown>).__COMMENTS__;
      if (cmd === "save_review_comments") return null;
      if (cmd === "get_file_comments")
        return { threads: toThreads(), sidecar_mtime_ms: null };
      if (cmd === "add_comment") return null;
      if (cmd === "update_comment") return null;
      if (cmd === "check_path_exists") return "file";
      if (cmd === "get_log_path") return "/mock/log.log";
      if (cmd === "compute_anchor_hash") return "deadbeef";
      if (cmd === "get_file_badges") return {};
      void args;
      return null;
    };
  }, { dir: FIXTURES_DIR, body: DOC });
}

test.describe("issue #280 — comment source/visual parity for frontmatter docs (AC1, AC2, AC7)", () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("fm.md").click();
    await expect(page.locator(".markdown-viewer")).toBeVisible();
  });

  test("AC1: a line-9 comment surfaces on the block with data-source-line=9 in the visual viewer", async ({ page }) => {
    const body = page.locator(".markdown-body");
    // The block at file-line 9 (the `## Body Heading 4`) must be stamped
    // with data-source-line="9" — the file-coord invariant from iter 2.
    const block9 = body.locator('[data-source-line="9"]').first();
    await expect(block9).toBeVisible();
    // The CSS-only badge bubble is driven by the `has-comments` modifier
    // class + `data-comment-count` attribute (see CommentableBlocks.tsx).
    // Assert BOTH are stamped on the line-9 wrapper — the count is "1".
    await expect.poll(async () => block9.getAttribute("data-comment-count")).toBe("1");
    await expect(block9).toHaveClass(/has-comments/);
  });

  test("AC2: no badge accumulates at line 1 from the frontmatter block", async ({ page }) => {
    const body = page.locator(".markdown-body");
    // The frontmatter block (line 1) must NOT carry the has-comments
    // modifier — line 1 was the old broken stack-up site for body-coord
    // bleed-through. With remark-frontmatter + content (file-coord) the
    // frontmatter is recognised but not rendered, so no [data-source-line="1"]
    // commentable wrapper exists at all (and certainly none with a count).
    const line1WithComments = body.locator('[data-source-line="1"].has-comments, [data-source-line="1"] .has-comments');
    expect(await line1WithComments.count()).toBe(0);
  });
});
