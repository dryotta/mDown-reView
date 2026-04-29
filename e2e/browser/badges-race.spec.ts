import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Reproduces the open-workspace TOCTOU race documented in the
 * `chore/badge-loading-diag` instrumentation:
 *
 *  1. `setRoot` clears `expandedFolders` and triggers `useTreeWatcher`,
 *     which schedules `update_tree_watched_dirs` AFTER a 100 ms debounce.
 *  2. `useFolderChildren` simultaneously fires `read_dir` for the root.
 *  3. As soon as `read_dir` resolves, `useFileBadges` fires
 *     `get_file_badges` with the just-discovered file paths.
 *  4. On the Rust side, `get_file_badges` rejects every path through
 *     `is_path_or_parent_allowed` because `tree_watched_dirs` has not
 *     been populated yet — see the unit test in
 *     `src-tauri/src/commands/comments/badges.rs`
 *     (`race_with_unset_tree_watched_dirs_returns_empty`).
 *  5. The frontend has no event to wake `useFileBadges` back up, so
 *     badges stay invisible until the user expands a folder (which
 *     mutates `pathsKey` and re-fires the hook).
 *
 * This e2e mock encodes the gate behaviour so we can prove the symptom
 * is observable end-to-end without driving the real binary.
 *
 * NOTE: dev-mode StrictMode amplifies the bug further — `useTreeWatcher`'s
 * effect re-runs immediately, the cleanup clears the 100 ms timeout, and
 * the second run skips because `lastSentRef.current === key`. So in dev
 * the IPC effectively never fires; in release builds the race is
 * timing-conditional. The bug demonstration assertion below holds for
 * both, which is why we don't depend on `treeWatchedDirs` ever being
 * populated.
 */

const FIXTURES_DIR = "/e2e/fixtures";

interface BadgePayload {
  count: number;
  max_severity: "none" | "low" | "medium" | "high";
}

interface MockState {
  /**
   * Mirrors the Rust `tree_watched_dirs` set. Empty initially; populated
   * by `update_tree_watched_dirs` exactly the way the real handler does.
   * Tests can pre-populate via the `prePopulateGate` setup parameter to
   * simulate the post-fix world.
   */
  treeWatchedDirs: string[];
  /** All `(cmd, ts)` pairs in invocation order — used for assertions. */
  log: Array<{ cmd: string; ts: number }>;
  /** Counters for the two interesting outcomes of `get_file_badges`. */
  rejectedCalls: number;
  acceptedCalls: number;
}

declare global {
  interface Window {
    __MOCK_STATE__: MockState;
  }
}

function setupGateMock(
  page: Page,
  badges: Record<string, BadgePayload>,
  prePopulateGate: boolean,
): Promise<void> {
  return page.addInitScript(
    ({
      dir,
      badgeMap,
      gateOpen,
    }: {
      dir: string;
      badgeMap: Record<string, BadgePayload>;
      gateOpen: boolean;
    }) => {
      const state: MockState = {
        treeWatchedDirs: gateOpen ? [dir] : [],
        log: [],
        rejectedCalls: 0,
        acceptedCalls: 0,
      };
      window.__MOCK_STATE__ = state;

      function gateAllows(path: string): boolean {
        // Mirrors `is_path_or_parent_allowed` — true if any watched dir
        // is a prefix of `path`. Plain string-prefix is fine here
        // because the mock paths are not real OS paths.
        return state.treeWatchedDirs.some((d) => path === d || path.startsWith(d + "/"));
      }

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

        if (cmd === "update_tree_watched_dirs") {
          const a = (args ?? {}) as { dirs?: string[] };
          state.treeWatchedDirs = a.dirs ? [...a.dirs] : [];
          return undefined;
        }

        if (cmd === "get_file_badges") {
          const a = (args ?? {}) as { filePaths?: string[] };
          const paths = a.filePaths ?? [];
          if (paths.length === 0) return {};
          const allowed = paths.filter(gateAllows);
          if (allowed.length === 0) {
            state.rejectedCalls += 1;
            return {};
          }
          state.acceptedCalls += 1;
          const out: Record<string, BadgePayload> = {};
          for (const p of allowed) if (badgeMap[p]) out[p] = badgeMap[p];
          return out;
        }
        return null;
      };
    },
    { dir: FIXTURES_DIR, badgeMap: badges, gateOpen: prePopulateGate },
  );
}

test.describe("Comment badges — open-workspace race", () => {
  test("BUG: badge is invisible after workspace open because gate rejects every path", async ({
    page,
  }) => {
    // Faithful reproduction of production: gate is empty at workspace
    // open. `useFileBadges` fires `get_file_badges` immediately after
    // `read_dir` resolves, the Rust-mirroring gate rejects every path,
    // and the empty result reaches the UI. No event re-triggers the
    // hook, so the badge stays missing.
    const alphaPath = `${FIXTURES_DIR}/alpha.md`;
    await setupGateMock(
      page,
      { [alphaPath]: { count: 3, max_severity: "high" } },
      /* prePopulateGate */ false,
    );

    await page.goto("/");

    const alphaRow = page.locator(".folder-tree .tree-entry", { hasText: "alpha.md" });
    await expect(alphaRow).toBeVisible();

    // Give the renderer enough time for everything that COULD set a
    // badge to settle (read_dir + get_file_badges roundtrips +
    // any plausible debounce window).
    await page.waitForTimeout(500);

    // ── User-visible symptom: no badge despite a valid sidecar.
    await expect(alphaRow.locator(".tree-comment-badge")).toHaveCount(0);

    // ── Mechanism: the gate rejected at least one badge call. This
    // pins the cause at the `is_path_or_parent_allowed` filter rather
    // than at any other layer (mock plumbing, render path, etc.).
    const state = await page.evaluate(() => ({
      rejectedCalls: window.__MOCK_STATE__.rejectedCalls,
      acceptedCalls: window.__MOCK_STATE__.acceptedCalls,
      badgeCalls: window.__MOCK_STATE__.log.filter((e) => e.cmd === "get_file_badges").length,
    }));
    expect(state.badgeCalls).toBeGreaterThan(0);
    expect(state.rejectedCalls).toBeGreaterThan(0);
    expect(state.acceptedCalls).toBe(0);
  });

  test("CONTROL: badge appears on first paint when gate is pre-populated (post-fix simulation)", async ({
    page,
  }) => {
    // Same setup but `tree_watched_dirs` is pre-populated. This is the
    // post-fix world (e.g. workspace root implicitly allowed, or the
    // gate dropped from the badge IPC). It proves both that the rest
    // of the pipeline works correctly AND that the gate is the sole
    // root cause of the BUG test above.
    const alphaPath = `${FIXTURES_DIR}/alpha.md`;
    await setupGateMock(
      page,
      { [alphaPath]: { count: 2, max_severity: "medium" } },
      /* prePopulateGate */ true,
    );

    await page.goto("/");

    const alphaRow = page.locator(".folder-tree .tree-entry", { hasText: "alpha.md" });
    await expect(alphaRow.locator(".tree-comment-badge")).toHaveText("2");
    await expect(alphaRow.locator(".tree-comment-badge")).toHaveAttribute(
      "data-severity",
      "medium",
    );

    const state = await page.evaluate(() => ({
      rejectedCalls: window.__MOCK_STATE__.rejectedCalls,
      acceptedCalls: window.__MOCK_STATE__.acceptedCalls,
    }));
    expect(state.acceptedCalls).toBeGreaterThan(0);
    expect(state.rejectedCalls).toBe(0);
  });
});

