// F6 — right-click context menu (#71 last checklist item).
// Verifies the menu appears on right-click in source view, and that the
// "Mark line as discussed" action calls add_comment with severity=none.

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

const SRC = ["// line 1", "// line 2", "// line 3", "// line 4"].join("\n");

async function setupCtxMenuMocks(page: Page) {
  await page.addInitScript(({ dir, src }: { dir: string; src: string }) => {
    (window as Record<string, unknown>).__ADD_COMMENT_CALLS__ = [];
    window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "get_launch_args") return { files: [], folders: [dir] };
      if (cmd === "read_dir") return [{ name: "demo.ts", path: `${dir}/demo.ts`, is_dir: false }];
      if (cmd === "read_text_file") return src;
      if (cmd === "stat_file") return { size_bytes: src.length };
      if (cmd === "load_review_comments") return null;
      if (cmd === "save_review_comments") return null;
      if (cmd === "get_file_comments") return [];
      if (cmd === "add_comment") {
        ((window as Record<string, unknown>).__ADD_COMMENT_CALLS__ as unknown[]).push(args);
        return null;
      }
      if (cmd === "compute_anchor_hash") return "deadbeef";
      if (cmd === "check_path_exists") return "file";
      if (cmd === "get_log_path") return "/mock/log.log";
      if (cmd === "get_file_badges") return {};
      return null;
    };
  }, { dir: FIXTURES_DIR, src: SRC });
}

test.describe("F6 — comment context menu", () => {
  test("right-click in source view shows menu with three actions", async ({ page }) => {
    await setupCtxMenuMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("demo.ts").click();
    await expect(page.locator(".source-view")).toBeVisible();

    const line2 = page.locator('[data-line-idx="1"]').first();
    await line2.click({ button: "right" });

    const menu = page.locator(".comment-context-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /Comment on selection/i })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /Copy link to line/i })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /Mark line as discussed/i })).toBeVisible();
  });

  test("'Mark line as discussed' calls add_comment with severity=none", async ({ page }) => {
    await setupCtxMenuMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("demo.ts").click();
    await expect(page.locator(".source-view")).toBeVisible();

    await page.locator('[data-line-idx="2"]').first().click({ button: "right" });
    await page.locator(".comment-context-menu").getByRole("menuitem", { name: /Mark line as discussed/i }).click();

    const calls = await page.evaluate(() => (window as Record<string, unknown>).__ADD_COMMENT_CALLS__);
    expect(Array.isArray(calls)).toBe(true);
    const arr = calls as Array<Record<string, unknown>>;
    expect(arr.length).toBe(1);
    expect(arr[0].text).toBe("discussed");
    expect(arr[0].severity).toBe("none");
    const anchor = arr[0].anchor as { kind: string; line: number };
    expect(anchor.kind).toBe("line");
    expect(anchor.line).toBe(3); // data-line-idx=2 → 1-indexed line 3
  });

  test("Esc closes the context menu", async ({ page }) => {
    await setupCtxMenuMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("demo.ts").click();
    await expect(page.locator(".source-view")).toBeVisible();

    await page.locator('[data-line-idx="0"]').first().click({ button: "right" });
    await expect(page.locator(".comment-context-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".comment-context-menu")).not.toBeVisible();
  });
});
