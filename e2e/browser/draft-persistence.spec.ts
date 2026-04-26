import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

// Mock IPC so the workspace contains a single markdown file that we can
// open repeatedly across page reloads. Comments are mutable so a Save
// action survives reload too.
async function setupDraftPersistenceMocks(page: Page) {
  await page.addInitScript(({ dir }: { dir: string }) => {
    (window as Record<string, unknown>).__COMMENTS__ = { mrsf_version: "1.0", document: "sample.md", comments: [] };

    function toThreads(): unknown[] {
      const raw = (window as Record<string, unknown>).__COMMENTS__ as Record<string, unknown> | null;
      if (!raw || !Array.isArray((raw as Record<string, unknown>).comments)) return [];
      const all = (raw as Record<string, unknown>).comments as Record<string, unknown>[];
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
      if (cmd === "read_dir") return [{ name: "sample.md", path: `${dir}/sample.md`, is_dir: false }];
      if (cmd === "read_text_file")
        return "# Test Heading\n\nContent paragraph on line 3.\n\nMore content on line 5.";
      if (cmd === "load_review_comments") return (window as Record<string, unknown>).__COMMENTS__;
      if (cmd === "save_review_comments") return null;
      if (cmd === "get_file_comments") return toThreads();
      if (cmd === "add_comment") {
        const comments = ((window as Record<string, unknown>).__COMMENTS__ as { comments: unknown[] }).comments;
        comments.push({
          id: "c-" + (comments.length + 1),
          author: args.author ?? "Tester",
          timestamp: new Date().toISOString(),
          text: args.text,
          resolved: false,
          line: (args.anchor as { line: number } | undefined)?.line ?? 0,
        });
        return null;
      }
      if (cmd === "update_comment") return null;
      if (cmd === "check_path_exists") return "file";
      if (cmd === "get_log_path") return "/mock/log.log";
      if (cmd === "compute_anchor_hash") return "deadbeef";
      return null;
    };
  }, { dir: FIXTURES_DIR });
}

test.describe("Draft persistence (Group E)", () => {
  test("draft survives reload, then is cleared on save", async ({ page }) => {
    await setupDraftPersistenceMocks(page);
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();

    // Open the markdown file.
    await page.locator(".folder-tree").getByText("sample.md").click();
    await expect(page.locator(".markdown-viewer")).toBeVisible();

    // The gutter click handler only fires for clicks in the leftmost 28px,
    // so click at the start of the paragraph rendered from source line 3.
    await page.locator('[data-source-line="3"]').first().click({ position: { x: 0, y: 4 } });

    // Composer textarea appears - type a draft.
    const textarea = page.locator(".comment-textarea").first();
    await expect(textarea).toBeVisible();
    await textarea.fill("draft1");

    // Reload - draft must survive in localStorage.
    await page.reload();
    await expect(page.locator(".app-layout")).toBeVisible();

    // Reopen the file and re-trigger the composer for the same line.
    await page.locator(".folder-tree").getByText("sample.md").click();
    await expect(page.locator(".markdown-viewer")).toBeVisible();
    await page.locator('[data-source-line="3"]').first().click({ position: { x: 0, y: 4 } });

    const restored = page.locator(".comment-textarea").first();
    await expect(restored).toBeVisible();
    await expect(restored).toHaveValue("draft1");

    // Save - the slot must be cleared.
    await page.getByRole("button", { name: /^save$/i }).first().click();

    // Reload again and reopen the line composer - this time it must NOT pre-fill.
    await page.reload();
    await expect(page.locator(".app-layout")).toBeVisible();
    await page.locator(".folder-tree").getByText("sample.md").click();
    await expect(page.locator(".markdown-viewer")).toBeVisible();

    // After save the line now has a thread, so clicking expands it instead of
    // opening the composer. (Note: the IPC mock resets __COMMENTS__ on each
    // page load, so after reload the line has no thread and the composer
    // opens directly. Either way, the textarea must be empty — the saved
    // draft was cleared from localStorage.)
    await page.locator('[data-source-line="3"]').first().click({ position: { x: 0, y: 4 } });
    const addBtn = page.getByRole("button", { name: /^add comment$/i }).first();
    if (await addBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await addBtn.click();
    }
    const fresh = page.locator(".comment-textarea").first();
    await expect(fresh).toBeVisible();
    await expect(fresh).toHaveValue("");
  });
});

