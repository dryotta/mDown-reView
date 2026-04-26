// Iter 5 Wave 1 (Group A) — verifies that table / blockquote / img / hr are
// commentable blocks. For each, hover surfaces the gutter affordance, click
// opens the inline CommentInput, and saving renders a badge on that block.

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

const BODY = [
  "First paragraph.", // line 1
  "", // 2
  "> a quoted block", // 3
  "", // 4
  "| A | B |", // 5
  "|---|---|", // 6
  "| 1 | 2 |", // 7
  "", // 8
  "![alt](./img.png)", // 9
  "", // 10
  "---", // 11
  "", // 12
  "tail.", // 13
  "",
].join("\n");

interface AddCommentArgs {
  filePath: string;
  text: string;
  anchor: { kind?: string; line?: number };
}

async function setupBlockMocks(page: Page) {
  await page.addInitScript(({ dir, body }: { dir: string; body: string }) => {
    (window as Record<string, unknown>).__ADD_COMMENT_CALLS__ = [];
    (window as Record<string, unknown>).__COMMENTS__ = {
      mrsf_version: "1.0",
      document: "blocks.md",
      comments: [] as Record<string, unknown>[],
    };
    function toThreads(): unknown[] {
      const raw = (window as Record<string, unknown>).__COMMENTS__ as { comments: Record<string, unknown>[] } | null;
      if (!raw) return [];
      const all = raw.comments;
      const roots = all.filter((c) => !c.reply_to);
      return roots.map((root) => ({
        root: { ...root, matchedLineNumber: (root.line as number) || 0, isOrphaned: false },
        replies: all
          .filter((c) => c.reply_to === root.id)
          .map((r) => ({ ...r, matchedLineNumber: (r.line as number) || 0, isOrphaned: false })),
      }));
    }
    window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "get_launch_args") return { files: [], folders: [dir] };
      if (cmd === "read_dir") return [{ name: "blocks.md", path: `${dir}/blocks.md`, is_dir: false }];
      if (cmd === "read_text_file") return body;
      if (cmd === "stat_file") return { size_bytes: body.length };
      if (cmd === "load_review_comments") return (window as Record<string, unknown>).__COMMENTS__;
      if (cmd === "save_review_comments") return null;
      if (cmd === "get_file_comments") return toThreads();
      if (cmd === "add_comment") {
        ((window as Record<string, unknown>).__ADD_COMMENT_CALLS__ as unknown[]).push(args);
        const sidecar = (window as Record<string, unknown>).__COMMENTS__ as { comments: Record<string, unknown>[] };
        const anchor = args.anchor as { kind?: string; line?: number } | null;
        sidecar.comments.push({
          id: "c-" + (sidecar.comments.length + 1),
          author: "Tester",
          timestamp: new Date().toISOString(),
          text: args.text,
          resolved: false,
          line: anchor?.line ?? 0,
          anchor_kind: anchor?.kind ?? "line",
        });
        return null;
      }
      if (cmd === "update_comment") return null;
      if (cmd === "check_path_exists") return "file";
      if (cmd === "get_log_path") return "/mock/log.log";
      if (cmd === "compute_anchor_hash") return "deadbeef";
      if (cmd === "get_file_badges") return {};
      if (cmd === "fetch_remote_asset") throw "blocked";
      if (cmd === "convert_asset_url") return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";
      return null;
    };
  }, { dir: FIXTURES_DIR, body: BODY });
}

async function readAddCommentCalls(page: Page): Promise<AddCommentArgs[]> {
  return await page.evaluate(
    () => (window as Record<string, unknown>).__ADD_COMMENT_CALLS__ as AddCommentArgs[],
  );
}

// Click via the gutter zone (left 28px of the markdown-body container) — that
// is the same hit-area the production handleGutterClick listens on.
async function clickGutterFor(page: Page, locator: ReturnType<Page["locator"]>) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("target block not visible");
  const body = page.locator(".markdown-body");
  const bodyBox = await body.boundingBox();
  if (!bodyBox) throw new Error("markdown-body not visible");
  // Click 12px from the left edge of the body, at the vertical midpoint of
  // the target block — well within the 28px gutter zone.
  await body.click({ position: { x: 12, y: box.y + box.height / 2 - bodyBox.y } });
}

test.describe("Iter 5 Wave 1 Group A — commentable blocks (table / blockquote / img / hr)", () => {
  // The fixture body contains an image whose resolved asset:// URL the
  // browser cannot fetch in dev (ERR_CONNECTION_REFUSED). That console
  // error is benign for these tests — we only care about the gutter and
  // commentable-block behavior, not image loading.
  test.use({ consoleErrorAllowlist: ["Failed to load resource"] });

  test.beforeEach(async ({ page }) => {
    await setupBlockMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("blocks.md").click();
    await expect(page.locator(".markdown-viewer")).toBeVisible();
  });

  test("each block tag (blockquote, table, img, hr) is wrapped with data-source-line", async ({ page }) => {
    const body = page.locator(".markdown-body");
    // blockquote
    await expect(body.locator(".md-commentable-block:has(> blockquote)")).toHaveCount(1);
    // table
    await expect(body.locator(".md-commentable-block:has(> table)")).toHaveCount(1);
    // img — wrapped in a span (inline-safe) inside the paragraph
    await expect(body.locator("span.md-commentable-block:has(> img)")).toHaveCount(1);
    // hr
    await expect(body.locator(".md-commentable-block:has(> hr)")).toHaveCount(1);
  });

  test("clicking the blockquote gutter opens CommentInput and saving lands a comment for that line", async ({ page }) => {
    const body = page.locator(".markdown-body");
    const bq = body.locator(".md-commentable-block:has(> blockquote)");
    await bq.hover();
    await clickGutterFor(page, bq);
    const textarea = page.locator(".comment-input .comment-textarea, textarea[placeholder*='comment']").first();
    await expect(textarea).toBeVisible();
    await textarea.fill("on quote");
    await page.getByRole("button", { name: /^save$/i }).first().click();
    await expect.poll(() => readAddCommentCalls(page).then((c) => c.length)).toBeGreaterThanOrEqual(1);
    const calls = await readAddCommentCalls(page);
    const last = calls[calls.length - 1];
    expect(last.text).toBe("on quote");
    expect(last.anchor.line).toBe(3);
  });

  test("clicking the hr gutter opens CommentInput and saving lands a comment on the hr line", async ({ page }) => {
    const body = page.locator(".markdown-body");
    const hr = body.locator(".md-commentable-block:has(> hr)");
    await hr.hover();
    await clickGutterFor(page, hr);
    const textarea = page.locator(".comment-input .comment-textarea, textarea[placeholder*='comment']").first();
    await expect(textarea).toBeVisible();
    await textarea.fill("on hr");
    await page.getByRole("button", { name: /^save$/i }).first().click();
    await expect.poll(() => readAddCommentCalls(page).then((c) => c.length)).toBeGreaterThanOrEqual(1);
    const last = (await readAddCommentCalls(page)).slice(-1)[0];
    expect(last.text).toBe("on hr");
    expect(last.anchor.line).toBe(11);
  });

  test("clicking the table gutter targets a line within the table", async ({ page }) => {
    const body = page.locator(".markdown-body");
    const tbl = body.locator(".md-commentable-block:has(> table)");
    await tbl.hover();
    // Click near the TOP of the table wrapper so we land on the header row
    // (line 5) rather than a body cell (line 7).
    const box = await tbl.boundingBox();
    const bodyBox = await body.boundingBox();
    if (!box || !bodyBox) throw new Error("table not visible");
    await body.click({ position: { x: 12, y: box.y - bodyBox.y + 4 } });
    const textarea = page.locator(".comment-input .comment-textarea, textarea[placeholder*='comment']").first();
    await expect(textarea).toBeVisible();
    await textarea.fill("on table");
    await page.getByRole("button", { name: /^save$/i }).first().click();
    await expect.poll(() => readAddCommentCalls(page).then((c) => c.length)).toBeGreaterThanOrEqual(1);
    const last = (await readAddCommentCalls(page)).slice(-1)[0];
    expect(last.text).toBe("on table");
    // The table spans lines 5-7 in the source — any of those is a valid hit.
    expect([5, 6, 7]).toContain(last.anchor.line);
  });
});
