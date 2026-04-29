import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Regression for the open-workspace TOCTOU race that left badges blank
 * until the user expanded a folder.
 *
 * Pre-fix root cause (verified in
 * `src-tauri/src/commands/comments/badges.rs`
 * `badges_surface_without_tree_watched_dirs_allowlist`):
 *   1. `setRoot` cleared `expandedFolders` and triggered
 *      `useTreeWatcher`, which scheduled `update_tree_watched_dirs`
 *      AFTER a 100 ms debounce.
 *   2. `useFileBadges` fired `get_file_badges` immediately after
 *      `read_dir` resolved.
 *   3. The Rust handler rejected every path through
 *      `is_path_or_parent_allowed` because `tree_watched_dirs` was
 *      still empty, returning `{}`.
 *   4. No frontend event re-triggered `useFileBadges`, so badges stayed
 *      missing until the user mutated `pathsKey` by expanding a folder.
 *
 * The fix dropped the gate from `get_file_badges` (the heavier
 * `get_file_comments` IPC was already unguarded for the same reason).
 * This spec asserts the user-visible outcome without simulating the
 * gate at all — the badge must appear on first paint, no expansion or
 * other user interaction required.
 */

const FIXTURES_DIR = "/e2e/fixtures";

interface BadgePayload {
  count: number;
  max_severity: "none" | "low" | "medium" | "high";
}

interface MockState {
  /** All `(cmd, ts)` pairs in invocation order — used for assertions. */
  log: Array<{ cmd: string; ts: number }>;
  /** Counters: how many `get_file_badges` calls returned a non-empty map. */
  acceptedCalls: number;
}

declare global {
  interface Window {
    __MOCK_STATE__: MockState;
  }
}

function setupBadgeMock(
  page: Page,
  badges: Record<string, BadgePayload>,
): Promise<void> {
  return page.addInitScript(
    ({ dir, badgeMap }: { dir: string; badgeMap: Record<string, BadgePayload> }) => {
      const state: MockState = { log: [], acceptedCalls: 0 };
      window.__MOCK_STATE__ = state;

      window.__TAURI_IPC_MOCK__ = async (cmd: string, args: unknown) => {
        state.log.push({ cmd, ts: performance.now() });

        if (cmd === "get_launch_args") return { files: [], folders: [dir] };
        if (cmd === "read_dir") {
          return [
            { name: "alpha.md", path: `${dir}/alpha.md`, is_dir: false },
            { name: "beta.md", path: `${dir}/beta.md`, is_dir: false },
          ];
        }
        if (cmd === "read_text_file") return "# alpha\n\nbody\n";
        if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
        if (cmd === "load_review_comments") return null;
        if (cmd === "check_path_exists") return "file";
        if (cmd === "get_log_path") return "/mock/log.log";

        if (cmd === "get_file_badges") {
          const a = (args ?? {}) as { filePaths?: string[] };
          const paths = a.filePaths ?? [];
          if (paths.length === 0) return {};
          const out: Record<string, BadgePayload> = {};
          for (const p of paths) if (badgeMap[p]) out[p] = badgeMap[p];
          if (Object.keys(out).length > 0) state.acceptedCalls += 1;
          return out;
        }
        return null;
      };
    },
    { dir: FIXTURES_DIR, badgeMap: badges },
  );
}

test.describe("Comment badges — open-workspace regression", () => {
  test("badge appears on first paint, no folder expansion required", async ({
    page,
  }) => {
    const alphaPath = `${FIXTURES_DIR}/alpha.md`;
    await setupBadgeMock(page, {
      [alphaPath]: { count: 3, max_severity: "high" },
    });

    await page.goto("/");

    // Critical assertion: the badge resolves on first paint. Pre-fix,
    // this would time out at 5 s because the gate rejected every
    // path and no event re-triggered the IPC.
    const alphaRow = page.locator(".folder-tree .tree-entry", { hasText: "alpha.md" });
    await expect(alphaRow.locator(".tree-comment-badge")).toHaveText("3");
    await expect(alphaRow.locator(".tree-comment-badge")).toHaveAttribute(
      "data-severity",
      "high",
    );

    // The fileless beta.md row must NOT carry a badge — sanity check
    // that the mock isn't returning the same payload for everything.
    const betaRow = page.locator(".folder-tree .tree-entry", { hasText: "beta.md" });
    await expect(betaRow.locator(".tree-comment-badge")).toHaveCount(0);

    // Mechanism: the gate-free IPC accepted at least one call. With
    // the fix #5 debounce (50 ms) we tolerate exactly one IPC for the
    // initial path set, but more is fine if a re-fire happened.
    const state = await page.evaluate(() => ({
      acceptedCalls: window.__MOCK_STATE__.acceptedCalls,
      badgeCalls: window.__MOCK_STATE__.log.filter(
        (e) => e.cmd === "get_file_badges",
      ).length,
    }));
    expect(state.badgeCalls).toBeGreaterThan(0);
    expect(state.acceptedCalls).toBeGreaterThan(0);
  });

  test("badge IPC is debounced — a burst of pathsKey changes coalesces", async ({
    page,
  }) => {
    // Validates fix #5 end-to-end: `useFileBadges` debounces pathsKey
    // changes by 50 ms so a burst of folder expansions doesn't produce
    // one full-tree-sized IPC per click.
    const alphaPath = `${FIXTURES_DIR}/alpha.md`;
    await setupBadgeMock(page, {
      [alphaPath]: { count: 1, max_severity: "low" },
    });

    await page.goto("/");
    const alphaRow = page.locator(".folder-tree .tree-entry", { hasText: "alpha.md" });
    await expect(alphaRow.locator(".tree-comment-badge")).toHaveText("1");

    const initialBadgeCalls = await page.evaluate(
      () =>
        window.__MOCK_STATE__.log.filter((e) => e.cmd === "get_file_badges")
          .length,
    );

    // Dispatch comments-changed 5 times in quick succession to mimic
    // the rapid-mutation case (e.g. resolve-all). Pre-fix every event
    // produced a fresh full-tree IPC; post-fix the debounce coalesces
    // them.
    await page.evaluate(() => {
      const dispatch = (window as Record<string, unknown>).__DISPATCH_TAURI_EVENT__ as (
        e: string,
        p: unknown,
      ) => void;
      for (let i = 0; i < 5; i++) {
        dispatch("comments-changed", { file_path: "/whatever" });
      }
    });

    // Wait long enough for the 50 ms debounce to fire and the IPC to
    // resolve — but short enough that a second debounce window can't
    // open behind us.
    await page.waitForTimeout(200);

    const after = await page.evaluate(() =>
      window.__MOCK_STATE__.log.filter((e) => e.cmd === "get_file_badges").length,
    );
    const delta = after - initialBadgeCalls;
    // 5 dispatches inside the debounce window must coalesce — we
    // accept up to 2 IPCs (one in flight when the burst started + one
    // for the coalesced burst itself).
    expect(delta).toBeLessThanOrEqual(2);
    expect(delta).toBeGreaterThan(0);
  });
});

