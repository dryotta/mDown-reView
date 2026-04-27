// Iter 7 Group F — verifies that Mermaid flowchart nodes are commentable
// surfaces. Click a node → inline composer opens → save dispatches addComment
// with a `kind:"line"` anchor whose line points back into the .mmd source.
// Badge persists across reload.

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

// Three-line flowchart that puts A and B on different source lines so the
// id-based heuristic produces distinct line anchors per node:
//   line 1: graph TD
//   line 2: A[Start]
//   line 3: B[End]
//   line 4: A --> B
const MMD = "graph TD\n  A[Start]\n  B[End]\n  A --> B\n";

interface AddCommentArgs {
  filePath: string;
  text: string;
  anchor: { kind?: string; line?: number; selected_text?: string; selected_text_hash?: string } | null;
}

async function setupMermaidMocks(page: Page) {
  await page.addInitScript(({ dir, mmd }: { dir: string; mmd: string }) => {
    (window as Record<string, unknown>).__ADD_COMMENT_CALLS__ = [];
    const STORAGE_KEY = "__e2e_mermaid_comments__";
    const restored = (() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw) as Record<string, unknown>;
      } catch { /* ignore */ }
      return null;
    })();
    (window as Record<string, unknown>).__COMMENTS__ = restored ?? {
      mrsf_version: "1.1",
      document: "diagram.mmd",
      comments: [] as Record<string, unknown>[],
    };
    function persist() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify((window as Record<string, unknown>).__COMMENTS__)); } catch { /* ignore */ }
    }

    function toThreads(): unknown[] {
      const raw = (window as Record<string, unknown>).__COMMENTS__ as { comments: Record<string, unknown>[] } | null;
      if (!raw) return [];
      const all = raw.comments;
      const roots = all.filter((c) => !c.reply_to);
      return roots.map((root) => ({
        root: { ...root, matchedLineNumber: root.line ?? 0, isOrphaned: false },
        replies: all
          .filter((c) => c.reply_to === root.id)
          .map((r) => ({ ...r, matchedLineNumber: r.line ?? 0, isOrphaned: false })),
      }));
    }

    window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "get_launch_args") return { files: [], folders: [dir] };
      if (cmd === "read_dir") return [{ name: "diagram.mmd", path: `${dir}/diagram.mmd`, is_dir: false }];
      if (cmd === "read_text_file") return mmd;
      if (cmd === "stat_file") return { size_bytes: mmd.length };
      if (cmd === "load_review_comments") return (window as Record<string, unknown>).__COMMENTS__;
      if (cmd === "save_review_comments") return null;
      if (cmd === "get_file_comments") return { threads: toThreads(), sidecar_mtime_ms: null };
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
          // Flat-line wire layout for kind:"line".
          line: anchor?.kind === "line" ? anchor.line : 0,
          ...(anchor?.kind && anchor.kind !== "line" ? { anchor_kind: anchor.kind } : {}),
        });
        persist();
        // IPC mock auto-emits 'comments-changed' centrally; see fixtures/error-tracking.ts.
        return null;
      }
      if (cmd === "update_comment") return null;
      if (cmd === "check_path_exists") return "file";
      if (cmd === "get_log_path") return "/mock/log.log";
      if (cmd === "compute_anchor_hash") return "deadbeef";
      if (cmd === "get_file_badges") return {};
      return null;
    };
  }, { dir: FIXTURES_DIR, mmd: MMD });
}

async function readAddCommentCalls(page: Page): Promise<AddCommentArgs[]> {
  return await page.evaluate(
    () => (window as Record<string, unknown>).__ADD_COMMENT_CALLS__ as AddCommentArgs[],
  );
}

test.describe("Iter 7 Group F — comment-on-mermaid-node", () => {
  test("clicking a flowchart node opens composer; save dispatches kind:line; badge persists across reload", async ({ page }) => {
    await setupMermaidMocks(page);
    await page.goto("/");

    await page.locator(".folder-tree").getByText("diagram.mmd").click();
    // Mermaid lazy-loads; tolerate the chunk fetch.
    await expect(page.locator(".mermaid-overlay-parent svg")).toBeVisible({ timeout: 15_000 });

    // The walk effect stamps data-source-line on each node. Pick node A,
    // which the heuristic maps to line 2 (`A[Start]`).
    const node = page.locator('.mermaid-overlay-parent svg g.node[data-source-line="2"]').first();
    await expect(node).toBeVisible({ timeout: 15_000 });
    await node.click();

    const composer = page.locator(".mermaid-node-composer");
    const textarea = composer.locator("textarea");
    await expect(textarea).toBeVisible();
    await textarea.fill("explain start node");
    await composer.getByRole("button", { name: /^save$/i }).click();

    await expect.poll(() => readAddCommentCalls(page).then((c) => c.length)).toBeGreaterThanOrEqual(1);
    const calls = await readAddCommentCalls(page);
    const last = calls[calls.length - 1];
    expect(last.text).toBe("explain start node");
    expect(last.anchor).toEqual({
      kind: "line",
      line: 2,
      selected_text: "  A[Start]",
      // selected_text_hash is computed in use-comment-actions for line-shaped
      // anchors. Mock returns a fixed value (see compute_anchor_hash).
      selected_text_hash: "deadbeef",
    });

    // Badge appears on the same node.
    await expect(page.locator(".mermaid-overlay-parent .tree-comment-badge")).toBeVisible();
    await expect(page.locator(".mermaid-overlay-parent .tree-comment-badge")).toHaveText("1");

    // Reload — persisted comment still drives a badge over the same node.
    await page.reload();
    await page.locator(".folder-tree").getByText("diagram.mmd").click();
    await expect(page.locator(".mermaid-overlay-parent svg")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".mermaid-overlay-parent .tree-comment-badge")).toBeVisible({ timeout: 15_000 });
  });
});
