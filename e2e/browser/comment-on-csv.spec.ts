// Iter 7 Group C — verifies that CSV cells are commentable surfaces.
// Alt+click a cell → inline composer opens → save dispatches addComment with
// a `csv_cell` anchor. The badge then renders inside the cell, and a reload
// preserves the persisted comment.

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

const CSV = "id,name,age\n1,Alice,30\n2,Bob,25\n3,Carol,40\n";

interface AddCommentArgs {
  filePath: string;
  text: string;
  anchor: { kind?: string; row_idx?: number; col_idx?: number; col_header?: string; primary_key_col?: string; primary_key_value?: string } | null;
}

async function setupCsvMocks(page: Page) {
  await page.addInitScript(({ dir, csv }: { dir: string; csv: string }) => {
    (window as Record<string, unknown>).__ADD_COMMENT_CALLS__ = [];
    const STORAGE_KEY = "__e2e_csv_comments__";
    const restored = (() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw) as Record<string, unknown>;
      } catch { /* ignore */ }
      return null;
    })();
    (window as Record<string, unknown>).__COMMENTS__ = restored ?? {
      mrsf_version: "1.1",
      document: "data.csv",
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
      if (cmd === "read_dir") return [{ name: "data.csv", path: `${dir}/data.csv`, is_dir: false }];
      if (cmd === "read_text_file") return csv;
      if (cmd === "stat_file") return { size_bytes: csv.length };
      if (cmd === "load_review_comments") return (window as Record<string, unknown>).__COMMENTS__;
      if (cmd === "save_review_comments") return null;
      if (cmd === "get_file_comments") return { threads: toThreads(), sidecar_mtime_ms: null };
      if (cmd === "add_comment") {
        ((window as Record<string, unknown>).__ADD_COMMENT_CALLS__ as unknown[]).push(args);
        const sidecar = (window as Record<string, unknown>).__COMMENTS__ as { comments: Record<string, unknown>[] };
        const anchor = args.anchor as { kind?: string; row_idx?: number; col_idx?: number; col_header?: string; primary_key_col?: string; primary_key_value?: string } | null;
        sidecar.comments.push({
          id: "c-" + (sidecar.comments.length + 1),
          author: "Tester",
          timestamp: new Date().toISOString(),
          text: args.text,
          resolved: false,
          line: 0,
          anchor_kind: anchor?.kind ?? "line",
          ...(anchor?.kind === "csv_cell" ? {
            csv_cell: {
              row_idx: anchor.row_idx,
              col_idx: anchor.col_idx,
              col_header: anchor.col_header,
              ...(anchor.primary_key_col ? { primary_key_col: anchor.primary_key_col } : {}),
              ...(anchor.primary_key_value ? { primary_key_value: anchor.primary_key_value } : {}),
            },
          } : {}),
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
  }, { dir: FIXTURES_DIR, csv: CSV });
}

async function readAddCommentCalls(page: Page): Promise<AddCommentArgs[]> {
  return await page.evaluate(
    () => (window as Record<string, unknown>).__ADD_COMMENT_CALLS__ as AddCommentArgs[],
  );
}

test.describe("Iter 7 Group C — comment-on-csv-cell", () => {
  test("Alt+click on a CSV cell opens composer; save dispatches csv_cell anchor; badge persists across reload", async ({ page }) => {
    await setupCsvMocks(page);
    await page.goto("/");

    await page.locator(".folder-tree").getByText("data.csv").click();
    await expect(page.locator(".csv-table")).toBeVisible();

    // Alt+click the "Bob" cell — that's row_idx=2, col_idx=1, header="name"
    // and pk → id column.
    const bobCell = page.locator(".csv-table td").filter({ hasText: "Bob" });
    await expect(bobCell).toBeVisible();
    await bobCell.click({ modifiers: ["Alt"] });

    // Inline composer appears.
    const textarea = page.locator(".csv-cell-composer textarea");
    await expect(textarea).toBeVisible();
    await textarea.fill("looks off");
    await page.locator(".csv-cell-composer").getByRole("button", { name: /^save$/i }).click();

    // addComment dispatched with the expected csv_cell anchor.
    await expect.poll(() => readAddCommentCalls(page).then((c) => c.length)).toBeGreaterThanOrEqual(1);
    const calls = await readAddCommentCalls(page);
    const last = calls[calls.length - 1];
    expect(last.text).toBe("looks off");
    expect(last.anchor).toEqual({
      kind: "csv_cell",
      row_idx: 2,
      col_idx: 1,
      col_header: "name",
      primary_key_col: "id",
      primary_key_value: "2",
    });

    // Badge appears in the cell.
    await expect(bobCell.locator(".tree-comment-badge")).toBeVisible();
    await expect(bobCell.locator(".tree-comment-badge")).toHaveText("1");

    // Reload — persisted comment still drives a badge in the same cell.
    await page.reload();
    await page.locator(".folder-tree").getByText("data.csv").click();
    await expect(page.locator(".csv-table")).toBeVisible();
    const bobCellReloaded = page.locator(".csv-table td").filter({ hasText: "Bob" });
    await expect(bobCellReloaded.locator(".tree-comment-badge")).toBeVisible();
  });

  test("plain (non-Alt) click on a CSV cell does not open the composer", async ({ page }) => {
    await setupCsvMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("data.csv").click();
    await expect(page.locator(".csv-table")).toBeVisible();
    const bobCell = page.locator(".csv-table td").filter({ hasText: "Bob" });
    await bobCell.click();
    await expect(page.locator(".csv-cell-composer")).toHaveCount(0);
  });
});
