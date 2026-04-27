import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

interface BadgePayload {
  count: number;
  max_severity: "none" | "low" | "medium" | "high";
}

/**
 * Wires an in-page IPC mock that returns:
 *   - A folder listing with two files
 *   - Per-file badge payloads via `get_file_badges`
 *
 * The mock also installs a helper `window.__SET_BADGES__` so a test can mutate
 * badge state mid-run and trigger a `comments-changed` event to refresh.
 */
function setupBadgesMock(
  page: Page,
  initialBadges: Record<string, BadgePayload>,
): Promise<void> {
  return page.addInitScript(
    ({ dir, badges }: { dir: string; badges: Record<string, BadgePayload> }) => {
      (window as Record<string, unknown>).__BADGES__ = { ...badges };
      (window as Record<string, unknown>).__SET_BADGES__ = (
        next: Record<string, BadgePayload>,
      ) => {
        (window as Record<string, unknown>).__BADGES__ = { ...next };
      };

      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") return { files: [], folders: [dir] };
        if (cmd === "read_dir") {
          return [
            { name: "alpha.md", path: `${dir}/alpha.md`, is_dir: false },
            { name: "beta.md", path: `${dir}/beta.md`, is_dir: false },
          ];
        }
        if (cmd === "read_text_file") return "# alpha\n\nbody\n";
        if (cmd === "get_file_badges") {
          return (window as Record<string, unknown>).__BADGES__ as Record<string, BadgePayload>;
        }
        if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
        if (cmd === "load_review_comments") return null;
        if (cmd === "check_path_exists") return "file";
        if (cmd === "get_log_path") return "/mock/log.log";
        return null;
      };
    },
    { dir: FIXTURES_DIR, badges: initialBadges },
  );
}

test.describe("Comment badges", () => {
  test("FolderTree renders the badge count from get_file_badges", async ({ page }) => {
    await setupBadgesMock(page, {
      [`${FIXTURES_DIR}/alpha.md`]: { count: 3, max_severity: "high" },
      [`${FIXTURES_DIR}/beta.md`]: { count: 0, max_severity: "none" },
    });
    await page.goto("/");

    const alphaRow = page.locator(".folder-tree .tree-entry", { hasText: "alpha.md" });
    await expect(alphaRow.locator(".tree-comment-badge")).toHaveText("3");
    await expect(alphaRow.locator(".tree-comment-badge")).toHaveAttribute(
      "data-severity",
      "high",
    );

    const betaRow = page.locator(".folder-tree .tree-entry", { hasText: "beta.md" });
    await expect(betaRow.locator(".tree-comment-badge")).toHaveCount(0);
  });

  test("TabBar shows the badge after opening a file with unresolved comments", async ({
    page,
  }) => {
    await setupBadgesMock(page, {
      [`${FIXTURES_DIR}/alpha.md`]: { count: 2, max_severity: "medium" },
    });
    await page.goto("/");

    await page.locator(".folder-tree").getByText("alpha.md").click();

    const tab = page.locator(".tab", { hasText: "alpha.md" });
    await expect(tab.locator(".tab-badge")).toHaveText("2");
    await expect(tab.locator(".tab-badge")).toHaveAttribute("data-severity", "medium");
  });

  test("badge refreshes when comments-changed event fires", async ({ page }) => {
    await setupBadgesMock(page, {
      [`${FIXTURES_DIR}/alpha.md`]: { count: 1, max_severity: "low" },
    });
    await page.goto("/");

    const alphaRow = page.locator(".folder-tree .tree-entry", { hasText: "alpha.md" });
    await expect(alphaRow.locator(".tree-comment-badge")).toHaveText("1");

    // Update mock state and dispatch the refresh event.
    await page.evaluate(({ dir }) => {
      const fn = (window as Record<string, unknown>).__SET_BADGES__ as (
        v: Record<string, BadgePayload>,
      ) => void;
      fn({ [`${dir}/alpha.md`]: { count: 4, max_severity: "high" } });
      const dispatch = (window as Record<string, unknown>).__DISPATCH_TAURI_EVENT__ as (
        e: string,
        p: unknown,
      ) => void;
      dispatch("comments-changed", { file_path: `${dir}/alpha.md` });
    }, { dir: FIXTURES_DIR });

    await expect(alphaRow.locator(".tree-comment-badge")).toHaveText("4");
    await expect(alphaRow.locator(".tree-comment-badge")).toHaveAttribute(
      "data-severity",
      "high",
    );
  });
});
