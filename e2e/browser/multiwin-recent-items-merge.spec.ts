/**
 * Browser E2E — `recentItems` writes from concurrent windows must merge,
 * not overwrite.
 *
 * Tests rule `multiwin-state-isolation` (the row classifying
 * `recentItems` as cross-window-synced) and `multiwin-cross-window-state-whitelist`
 * in docs/best-practices-common/tauri/v2-patterns.md.
 *
 * Today's behaviour: cross-window persistence uses last-writer-wins on
 * the `mdownreview-ui` localStorage key, so when window A and window B
 * each push a new entry and flush within the same debounce window, one
 * loses. Section H3 of issue #315 introduces a merge-on-rehydrate /
 * merge-on-storage-event policy keyed on path. This spec is a
 * documentation skeleton until that fix lands.
 */

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const STORE_KEY = "mdownreview-ui";

test.describe("multiwin-recent-items-merge (E3)", () => {
  test.skip(
    true,
    "FIXME: pending #315 Section H3 — recentItems merge policy not yet implemented; current behaviour is last-writer-wins on the persisted key"
  );

  test("simultaneous adds from two windows merge by path with newest mtime winning duplicates", async ({
    page,
  }: {
    page: Page;
  }) => {
    // Future-state contract once Section H3 lands:
    //
    //  1. Pre-seed localStorage with recentItems = [A].
    //  2. Simulate window A writing recentItems = [A, B].
    //  3. Simulate window B writing recentItems = [A, C] via a storage
    //     event arriving AFTER A's write.
    //  4. The merged store must contain {A, B, C} (set union by path),
    //     not {A, C} (overwrite). Duplicate paths resolve by newest
    //     timestamp, not insertion order.

    await page.addInitScript((key: string) => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") return { files: [], folders: [] };
        if (cmd === "get_log_path") return "/mock/log.log";
        if (cmd === "check_path_exists") return null;
        return null;
      };

      const seed = {
        state: {
          recentItems: [{ kind: "folder", path: "/A", lastOpened: 1 }],
        },
        version: 0,
      };
      localStorage.setItem(key, JSON.stringify(seed));
    }, STORE_KEY);

    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();

    // Simulate window A's write, then window B's storage event.
    await page.evaluate((key: string) => {
      const writeA = {
        state: {
          recentItems: [
            { kind: "folder", path: "/A", lastOpened: 1 },
            { kind: "folder", path: "/B", lastOpened: 2 },
          ],
        },
        version: 0,
      };
      localStorage.setItem(key, JSON.stringify(writeA));

      const writeB = {
        state: {
          recentItems: [
            { kind: "folder", path: "/A", lastOpened: 1 },
            { kind: "folder", path: "/C", lastOpened: 3 },
          ],
        },
        version: 0,
      };
      window.dispatchEvent(
        new StorageEvent("storage", {
          key,
          newValue: JSON.stringify(writeB),
          storageArea: localStorage,
        })
      );
    }, STORE_KEY);

    // After H3, the merged set must contain all three paths.
    const paths = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      const items = (parsed?.state?.recentItems ?? []) as { path: string }[];
      return items.map((i) => i.path).sort();
    }, STORE_KEY);

    expect(paths).toEqual(["/A", "/B", "/C"]);
  });
});
