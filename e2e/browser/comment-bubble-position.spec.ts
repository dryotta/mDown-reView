// Regression test for the speech-bubble positioning bug fixed alongside
// the mermaid-button overlap fix (issue surfaced by the bug-expert audit).
//
// Bug summary: `.md-commentable-block.has-comments::before` (and the
// `::after` back-bubble for ≥2 comments) declared `position: absolute;
// left: 4px; top: 4px`, but the wrappers `.md-commentable-block` and
// `.md-commentable-li` had no `position: relative`. The pseudos escaped
// to the next positioned ancestor — `.markdown-body { position:
// relative }` — and stacked at the top-left of the body regardless of
// which block carried the comment. Only `.md-commentable-cell` had
// `position: relative` (with an explicit comment in the CSS noting why
// cells need it), so cells worked correctly. Block / li variants did
// not.
//
// Fix: add `position: relative` to `.md-commentable-block` and
// `.md-commentable-li`, then re-tune the `left` offsets to land the
// bubble in the gutter to the LEFT of the wrapper rather than 4px
// inside the wrapper's text content area.
//
// This test loads a markdown file with several commented blocks at
// different vertical positions and verifies:
//   1. Each bubble's effective viewport-Y aligns with its OWN block,
//      not all stacked at the body top.
//   2. Each bubble's effective viewport-X is LEFT of the wrapper's
//      content edge (i.e., in the gutter, not painted over the text).

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";
const FILE = `${FIXTURES_DIR}/multi-block-comments.md`;

// Body lines (1-indexed):
//   1: # Heading
//   2: <blank>
//   3: First paragraph.
//   4: <blank>
//   5: Second paragraph.
//   6: <blank>
//   7: - First list item.
//   8: - Second list item.
const BODY = [
  "# Heading",
  "",
  "First paragraph.",
  "",
  "Second paragraph.",
  "",
  "- First list item.",
  "- Second list item.",
  "",
].join("\n");

async function setupMocks(page: Page): Promise<void> {
  await page.addInitScript(
    ({ dir, file, body }: { dir: string; file: string; body: string }) => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") return { files: [], folders: [dir] };
        if (cmd === "read_dir") {
          return [{ name: "multi-block-comments.md", path: file, is_dir: false }];
        }
        if (cmd === "read_text_file") return body;
        if (cmd === "stat_file") return { size_bytes: body.length };
        if (cmd === "load_review_comments") return null;
        if (cmd === "save_review_comments") return null;
        if (cmd === "check_path_exists") return "file";
        if (cmd === "get_log_path") return "/mock/log.log";
        if (cmd === "get_file_badges") return {};
        if (cmd === "get_file_comments") {
          // Anchor a comment on heading (1), each paragraph (3, 5), and the
          // first list item (7). Each thread root carries the matched line
          // so `useThreadsByLine` buckets them per source line.
          const make = (line: number, id: string) => ({
            root: {
              id,
              line,
              matchedLineNumber: line,
              isOrphaned: false,
              author: "Tester",
              text: `comment on line ${line}`,
              timestamp: new Date().toISOString(),
              resolved: false,
              anchor_kind: "line",
            },
            replies: [],
          });
          return {
            threads: [
              make(1, "c1"),
              make(3, "c2"),
              make(5, "c3"),
              make(7, "c4"),
            ],
            sidecar_mtime_ms: null,
          };
        }
        return null;
      };
    },
    { dir: FIXTURES_DIR, file: FILE, body: BODY },
  );
}

interface BubbleSnapshot {
  /** data-source-line of the wrapper */
  line: number;
  /** Wrapper's bounding rect (viewport-relative) */
  wrapperTop: number;
  wrapperBottom: number;
  /** Effective viewport-Y of the bubble's center */
  bubbleCenterY: number;
}

test.describe("comment bubble positioning (regression for the .markdown-body escape bug)", () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("multi-block-comments.md").click();
    await expect(page.locator(".markdown-body")).toBeVisible();
    // Wait for the threads payload to render — at least one bubble visible.
    await expect(page.locator(".md-commentable-block.has-comments, .md-commentable-li.has-comments"))
      .toHaveCount(4, { timeout: 5_000 });
  });

  test("bubbles do NOT all stack at the top of .markdown-body — each bubble sits with its own block", async ({
    page,
  }) => {
    // Snapshot every commented wrapper's viewport position + its ::before
    // bubble's resolved offsets. Pseudo-elements have no `getBoundingClientRect`,
    // so we compute their effective viewport position from the wrapper's
    // bounding rect plus the resolved `top`/`left`/`width`/`height` pulled
    // from `getComputedStyle(el, '::before')`.
    const snapshots: BubbleSnapshot[] = await page.evaluate(() => {
      const wrappers = Array.from(
        document.querySelectorAll(
          ".md-commentable-block.has-comments, .md-commentable-li.has-comments",
        ),
      );
      return wrappers.map((el) => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        const cs = window.getComputedStyle(el as HTMLElement, "::before");
        const top = parseFloat(cs.top);
        const h = parseFloat(cs.height);
        const line = parseInt(
          (el as HTMLElement).getAttribute("data-source-line") ?? "0",
          10,
        );
        return {
          line,
          wrapperTop: rect.top,
          wrapperBottom: rect.bottom,
          bubbleCenterY: rect.top + top + h / 2,
        };
      });
    });

    expect(snapshots.length).toBe(4);

    // Bubbles must have DIFFERENT viewport-Y values (no stacking).
    const ys = snapshots.map((s) => s.bubbleCenterY);
    const uniqueYs = new Set(ys.map((y) => Math.round(y)));
    expect(uniqueYs.size).toBe(snapshots.length);

    // Sort by source line and verify Y is monotonically increasing —
    // earlier blocks have bubbles HIGHER in the viewport.
    const sorted = [...snapshots].sort((a, b) => a.line - b.line);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].bubbleCenterY).toBeGreaterThan(sorted[i - 1].bubbleCenterY);
    }

    // Each bubble's center-Y must sit WITHIN its own wrapper's vertical
    // bounds (with a small tolerance for the bubble extending slightly
    // above the line-box top).
    for (const s of snapshots) {
      expect(s.bubbleCenterY).toBeGreaterThanOrEqual(s.wrapperTop - 4);
      expect(s.bubbleCenterY).toBeLessThanOrEqual(s.wrapperBottom + 4);
    }
  });

  test("each bubble sits in the gutter (LEFT of the wrapper's content edge), not painted over the text", async ({
    page,
  }) => {
    const data = await page.evaluate(() => {
      const wrappers = Array.from(
        document.querySelectorAll(
          ".md-commentable-block.has-comments, .md-commentable-li.has-comments",
        ),
      );
      return wrappers.map((el) => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        const cs = window.getComputedStyle(el as HTMLElement, "::before");
        const left = parseFloat(cs.left);
        const w = parseFloat(cs.width);
        return {
          line: parseInt((el as HTMLElement).getAttribute("data-source-line") ?? "0", 10),
          wrapperLeft: rect.left,
          // Effective right edge of the bubble in the viewport.
          bubbleRight: rect.left + left + w,
        };
      });
    });

    expect(data.length).toBe(4);

    // The bubble's right edge must be ≤ the wrapper's left edge (modulo a
    // 1px sub-pixel cushion), i.e. the bubble sits entirely OUTSIDE the
    // wrapper to its left — in the gutter, not on the text.
    for (const d of data) {
      expect(
        d.bubbleRight,
        `bubble for line ${d.line} bleeds into wrapper text (bubbleRight=${d.bubbleRight}, wrapperLeft=${d.wrapperLeft})`,
      ).toBeLessThanOrEqual(d.wrapperLeft + 1);
    }
  });
});
