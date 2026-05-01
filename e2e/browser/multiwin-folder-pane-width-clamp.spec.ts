/**
 * Browser E2E — `folderPaneWidth` must be clamped against the current
 * viewport on rehydrate.
 *
 * Tests rule `multiwin-rehydrate-clamp` in
 * docs/best-practices-common/tauri/v2-patterns.md.
 *
 * Today's behaviour: a `folderPaneWidth` of 1200 px persisted on a 4K
 * screen rehydrates verbatim on a 1366×768 laptop, hiding the drag
 * handle offscreen and making the app appear broken until the user
 * clears localStorage. The fix is an `onRehydrateStorage` clamp:
 *
 *   state.folderPaneWidth = Math.max(160, Math.min(state.folderPaneWidth, window.innerWidth * 0.4));
 *
 * This spec is a documentation skeleton until the clamp lands.
 */

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const STORE_KEY = "mdownreview-ui";

test.describe("multiwin-folder-pane-width-clamp (E4)", () => {
  test.skip(
    true,
    "FIXME: pending #315 — onRehydrateStorage clamp for folderPaneWidth (and future per-window pane sizes) not yet implemented"
  );

  test("oversized persisted folderPaneWidth is clamped to 40% of viewport on rehydrate", async ({
    page,
  }: {
    page: Page;
  }) => {
    // Future-state contract:
    //
    //  1. Seed localStorage with folderPaneWidth = 1200 (legitimate on
    //     a 4K monitor).
    //  2. Set the viewport to 1366×768 (laptop).
    //  3. After rehydrate, the effective folderPaneWidth must be ≤
    //     0.4 * viewport.innerWidth (≈ 546 px) and ≥ the minimum (160 px).
    //  4. The clamp lives in the writer-side `onRehydrateStorage`, not
    //     in the renderer — frontend-only clamps fix the symptom, not
    //     the persisted-state bug across sessions.

    await page.setViewportSize({ width: 1366, height: 768 });

    await page.addInitScript((key: string) => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") return { files: [], folders: [] };
        if (cmd === "get_log_path") return "/mock/log.log";
        return null;
      };

      const seed = {
        state: { folderPaneWidth: 1200 },
        version: 0,
      };
      localStorage.setItem(key, JSON.stringify(seed));
    }, STORE_KEY);

    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();

    const effectiveWidth = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.state?.folderPaneWidth ?? null;
    }, STORE_KEY);

    expect(effectiveWidth).not.toBeNull();
    // Min 160 px, max 40% of 1366 px ≈ 546 px.
    expect(effectiveWidth).toBeGreaterThanOrEqual(160);
    expect(effectiveWidth).toBeLessThanOrEqual(546);
  });
});
