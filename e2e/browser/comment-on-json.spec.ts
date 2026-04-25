// Iter 7 Group C — verifies that JSON paths are commentable surfaces.
// Click the hover-revealed "+" affordance on a JSON node → composer opens →
// save dispatches addComment with a `json_path` anchor. Badge renders inline
// with the key, and reload preserves the persisted comment.

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

const JSON_DOC = JSON.stringify({ users: [{ id: 42, name: "alice" }] });

interface AddCommentArgs {
  filePath: string;
  text: string;
  anchor: { kind?: string; json_path?: string; scalar_text?: string } | null;
}

async function setupJsonMocks(page: Page) {
  await page.addInitScript(({ dir, doc }: { dir: string; doc: string }) => {
    (window as Record<string, unknown>).__ADD_COMMENT_CALLS__ = [];
    const STORAGE_KEY = "__e2e_json_comments__";
    const restored = (() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw) as Record<string, unknown>;
      } catch { /* ignore */ }
      return null;
    })();
    (window as Record<string, unknown>).__COMMENTS__ = restored ?? {
      mrsf_version: "1.1",
      document: "data.json",
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
        root: { ...root, matchedLineNumber: 0, isOrphaned: false },
        replies: all
          .filter((c) => c.reply_to === root.id)
          .map((r) => ({ ...r, matchedLineNumber: 0, isOrphaned: false })),
      }));
    }

    window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "get_launch_args") return { files: [], folders: [dir] };
      if (cmd === "read_dir") return [{ name: "data.json", path: `${dir}/data.json`, is_dir: false }];
      if (cmd === "read_text_file") return doc;
      if (cmd === "stat_file") return { size_bytes: doc.length };
      if (cmd === "strip_json_comments") return (args as { text?: string })?.text ?? doc;
      if (cmd === "load_review_comments") return (window as Record<string, unknown>).__COMMENTS__;
      if (cmd === "save_review_comments") return null;
      if (cmd === "get_file_comments") return toThreads();
      if (cmd === "add_comment") {
        ((window as Record<string, unknown>).__ADD_COMMENT_CALLS__ as unknown[]).push(args);
        const sidecar = (window as Record<string, unknown>).__COMMENTS__ as { comments: Record<string, unknown>[] };
        const anchor = args.anchor as { kind?: string; json_path?: string; scalar_text?: string } | null;
        sidecar.comments.push({
          id: "c-" + (sidecar.comments.length + 1),
          author: "Tester",
          timestamp: new Date().toISOString(),
          text: args.text,
          resolved: false,
          line: 0,
          anchor_kind: anchor?.kind ?? "line",
          ...(anchor?.kind === "json_path" ? {
            json_path: {
              json_path: anchor.json_path,
              ...(anchor.scalar_text !== undefined ? { scalar_text: anchor.scalar_text } : {}),
            },
          } : {}),
        });
        persist();
        const dispatcher = (window as Record<string, unknown>).__DISPATCH_TAURI_EVENT__ as
          | ((e: string, p: unknown) => void)
          | undefined;
        if (dispatcher) dispatcher("comments-changed", { file_path: args.filePath });
        return null;
      }
      if (cmd === "update_comment") return null;
      if (cmd === "check_path_exists") return "file";
      if (cmd === "get_log_path") return "/mock/log.log";
      if (cmd === "compute_anchor_hash") return "deadbeef";
      if (cmd === "get_file_badges") return {};
      return null;
    };
  }, { dir: FIXTURES_DIR, doc: JSON_DOC });
}

async function readAddCommentCalls(page: Page): Promise<AddCommentArgs[]> {
  return await page.evaluate(
    () => (window as Record<string, unknown>).__ADD_COMMENT_CALLS__ as AddCommentArgs[],
  );
}

test.describe("Iter 7 Group C — comment-on-json-path", () => {
  test("clicking '+' on a JSON path opens composer; save dispatches json_path anchor; badge persists across reload", async ({ page }) => {
    await setupJsonMocks(page);
    await page.goto("/");

    await page.locator(".folder-tree").getByText("data.json").click();
    await expect(page.locator(".json-tree")).toBeVisible();

    // Expand `users[id=42]` so its `name` child renders.
    const objToggle = page.locator("[data-json-path='users[id=42]'] > .json-node-row > button.json-toggle");
    await objToggle.click();

    // Hover the row to reveal the "+" button.
    const nameRow = page.locator("[data-json-path='users[id=42].name']");
    await nameRow.hover();
    const addBtn = nameRow.locator("> .json-node-row > button.json-path-add");
    // CSS hover-reveal can be flaky in Playwright; force-click bypasses
    // the visibility check and exercises the same handler.
    await addBtn.click({ force: true });

    const textarea = page.locator(".json-path-composer textarea");
    await expect(textarea).toBeVisible();
    await textarea.fill("typo?");
    await page.locator(".json-path-composer").getByRole("button", { name: /^save$/i }).click();

    await expect.poll(() => readAddCommentCalls(page).then((c) => c.length)).toBeGreaterThanOrEqual(1);
    const calls = await readAddCommentCalls(page);
    const last = calls[calls.length - 1];
    expect(last.text).toBe("typo?");
    expect(last.anchor).toEqual({
      kind: "json_path",
      json_path: "users[id=42].name",
      scalar_text: "alice",
    });

    // Badge appears on the same row.
    await expect(nameRow.locator("> .json-node-row .tree-comment-badge")).toBeVisible();

    // Reload — persisted comment still drives a badge.
    await page.reload();
    await page.locator(".folder-tree").getByText("data.json").click();
    await expect(page.locator(".json-tree")).toBeVisible();
    const objToggle2 = page.locator("[data-json-path='users[id=42]'] > .json-node-row > button.json-toggle");
    await objToggle2.click();
    const nameRowReloaded = page.locator("[data-json-path='users[id=42].name']");
    await expect(nameRowReloaded.locator("> .json-node-row .tree-comment-badge")).toBeVisible();
  });
});
