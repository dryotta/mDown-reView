import { readFileSync } from "node:fs";
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { getRenderCounts, assertWithinBaseline } from "./helpers/render-counts";

const baselines = JSON.parse(
  readFileSync("e2e/browser/fixtures/render-baselines.json", "utf8"),
);

/**
 * Bootstraps the renderer with a 50-entry folder via the launch-args path:
 * `useLaunchArgsBootstrap` calls `get_launch_args` on mount, sees a folder,
 * sets root through the store, which mounts FolderTree and triggers the
 * read_dir we mock to return 50 markdown entries. End state is measured
 * after the tree settles. Captures cold-startup + open-folder as one
 * combined budget — the baseline numbers reflect that.
 */
async function installFolderMock(page: Page) {
  await page.addInitScript(() => {
    const entries = Array.from({ length: 50 }, (_, i) => ({
      name: `file-${String(i).padStart(3, "0")}.md`,
      path: `/test-workspace/file-${String(i).padStart(3, "0")}.md`,
      is_dir: false,
    }));
    window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "get_launch_args") return { files: [], folders: ["/test-workspace"] };
      if (cmd === "read_dir") {
        const p = (args as { path: string }).path;
        if (p === "/test-workspace") return { entries, total: entries.length, has_more: false };
        return { entries: [], total: 0, has_more: false };
      }
      if (cmd === "check_path_exists") return "directory";
      return null;
    };
  });
}

test.describe("render counts — open folder 50 files (AC2 / #298)", () => {
  test("open-folder render counts ≤ baseline", async ({ page }) => {
    await installFolderMock(page);
    await page.goto("/");

    // Settled signal: 50 entries rendered in the FolderTree.
    await expect(page.locator(".folder-tree [data-path]")).toHaveCount(50, {
      timeout: 5000,
    });
    await page.waitForTimeout(150);

    const counts = await getRenderCounts(page);
    // eslint-disable-next-line no-console
    console.log("[open-folder counts]", JSON.stringify(counts));
    assertWithinBaseline(counts, baselines.openFolder50, "openFolder50");
  });
});
