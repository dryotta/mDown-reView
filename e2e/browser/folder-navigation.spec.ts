import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function mockTauriInvoke(page: Page) {
  await page.addInitScript(() => {
    const dirData: Record<string, Array<{ name: string; path: string; is_dir: boolean }>> = {
      "/e2e/fixtures": [
        { name: "sample.md", path: "/e2e/fixtures/sample.md", is_dir: false },
        { name: "sample.ts", path: "/e2e/fixtures/sample.ts", is_dir: false },
        { name: "subfolder", path: "/e2e/fixtures/subfolder", is_dir: true },
        { name: "other", path: "/e2e/fixtures/other", is_dir: true },
        { name: "a", path: "/e2e/fixtures/a", is_dir: true },
      ],
      "/e2e/fixtures/subfolder": [
        { name: "deep.md", path: "/e2e/fixtures/subfolder/deep.md", is_dir: false },
        { name: "level2", path: "/e2e/fixtures/subfolder/level2", is_dir: true },
      ],
      "/e2e/fixtures/subfolder/level2": [
        { name: "level3", path: "/e2e/fixtures/subfolder/level2/level3", is_dir: true },
      ],
      "/e2e/fixtures/subfolder/level2/level3": [
        { name: "file4.md", path: "/e2e/fixtures/subfolder/level2/level3/file4.md", is_dir: false },
      ],
      "/e2e/fixtures/other": [
        { name: "untouched.md", path: "/e2e/fixtures/other/untouched.md", is_dir: false },
      ],
      "/e2e/fixtures/a": [
        { name: "b", path: "/e2e/fixtures/a/b", is_dir: true },
      ],
      "/e2e/fixtures/a/b": [
        { name: "c", path: "/e2e/fixtures/a/b/c", is_dir: true },
      ],
      "/e2e/fixtures/a/b/c": [
        { name: "deep.md", path: "/e2e/fixtures/a/b/c/deep.md", is_dir: false },
      ],
    };
    // Expose to tests for per-test extension (e.g. injecting new entries)
    (window as Record<string, unknown>).__DIR_DATA__ = dirData;
    // Spy: every read_dir invocation is tracked here, keyed by path.
    (window as Record<string, unknown>).__READ_DIR_CALLS__ = {} as Record<string, number>;

    window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "get_launch_args") return { files: [], folders: [] };
      if (cmd === "read_dir") {
        const p = (args as { path: string }).path;
        const counts = (window as Record<string, unknown>).__READ_DIR_CALLS__ as Record<
          string,
          number
        >;
        counts[p] = (counts[p] ?? 0) + 1;
        return dirData[p] ?? [];
      }
      if (cmd === "read_text_file") return "# Test\n\nContent";
      if (cmd === "load_review_comments") return null;
      if (cmd === "check_path_exists") return "file";
      if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
      return null;
    };
  });
}

test.describe("Folder Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await mockTauriInvoke(page);
  });

  test("21.1 - folder opens, .md file opens in tab, .ts routes to source viewer", async ({ page }) => {
    // Override mock to set folder as launch arg
    await page.addInitScript(() => {
      const origMock = window.__TAURI_IPC_MOCK__!;
      window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "get_launch_args") return { files: [], folders: ["/e2e/fixtures"] };
        return origMock(cmd, args);
      };
    });
    await page.goto("/");

    // Folder tree should be visible
    await expect(page.locator(".folder-tree")).toBeVisible();

    // Click on .md file → should open in markdown viewer
    await page.locator(".folder-tree").getByText("sample.md").click();
    await expect(page.locator(".markdown-viewer")).toBeVisible();

    // Click on .ts file → should open in source viewer
    await page.locator(".folder-tree").getByText("sample.ts").click();
    await expect(page.locator(".source-view")).toBeVisible();
  });

  test("21.2 - keyboard navigation in tree", async ({ page }) => {
    await page.addInitScript(() => {
      const origMock = window.__TAURI_IPC_MOCK__!;
      window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "get_launch_args") return { files: [], folders: ["/e2e/fixtures"] };
        return origMock(cmd, args);
      };
    });
    await page.goto("/");
    await expect(page.locator(".folder-tree")).toBeVisible();

    // Focus on the first tree item
    const firstItem = page.locator(".folder-tree [data-path]").first();
    await firstItem.click();

    // Press ArrowDown to move to next item
    await page.keyboard.press("ArrowDown");

    // Press Enter to open the focused item
    await page.keyboard.press("Enter");

    // Verify that a tab was opened (tab bar should have at least one tab)
    // OR that a folder was expanded (has aria-expanded=true)
    const tabOpened = page.locator(".tab-bar .tab");
    const expandedFolder = page.locator('.folder-tree [aria-expanded="true"]');
    const result = await Promise.race([
      tabOpened.first().waitFor({ timeout: 2000 }).then(() => "tab"),
      expandedFolder.first().waitFor({ timeout: 2000 }).then(() => "expanded"),
    ]).catch(() => "neither");

    expect(["tab", "expanded"]).toContain(result);
  });

  test("21.3 - filter hides non-matching files", async ({ page }) => {
    await page.addInitScript(() => {
      const origMock = window.__TAURI_IPC_MOCK__!;
      window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "get_launch_args") return { files: [], folders: ["/e2e/fixtures"] };
        return origMock(cmd, args);
      };
    });
    await page.goto("/");
    await expect(page.locator(".folder-tree")).toBeVisible();

    // Both files should be visible initially
    await expect(page.locator(".folder-tree").getByText("sample.md")).toBeVisible();
    await expect(page.locator(".folder-tree").getByText("sample.ts")).toBeVisible();

    // Use the correct filter input selector
    const filterInput = page.locator(".folder-tree-filter");
    await expect(filterInput).toBeVisible();
    await filterInput.fill("sample.md");

    // .ts file should be hidden
    await expect(page.locator(".folder-tree").getByText("sample.ts")).not.toBeVisible();
    // .md file should still be visible
    await expect(page.locator(".folder-tree").getByText("sample.md")).toBeVisible();
  });

  test("21.4 - folder tree shows close button (autoReveal toggle removed)", async ({ page }) => {
    await page.addInitScript(() => {
      const origMock = window.__TAURI_IPC_MOCK__!;
      window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "get_launch_args") return { files: [], folders: ["/e2e/fixtures"] };
        return origMock(cmd, args);
      };
    });
    await page.goto("/");
    await expect(page.locator(".folder-tree")).toBeVisible();

    // Close button should be visible in the folder tree header
    const closeBtn = page.locator('button[title="Close folder"]');
    await expect(closeBtn).toBeVisible();

    // autoReveal was removed in iter 1 of #40 — reveal is now unconditional.
    // The toggle button MUST NOT exist in the toolbar.
    await expect(page.locator('button[title*="Auto-reveal" i]')).toHaveCount(0);
  });

  // ── Issue #40 / Wave 2: auto-reveal is unconditional (no setting) ──────────
  test("21.5 - opening a deeply nested file auto-expands ancestors and scrolls into view", async ({
    page,
  }) => {
    // Launch with both a folder and a file inside a deeply nested collapsed
    // dir. useLaunchArgsBootstrap will set the root and open the file as the
    // active tab, which must trigger the unconditional reveal effect.
    await page.addInitScript(() => {
      const origMock = window.__TAURI_IPC_MOCK__!;
      window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "get_launch_args")
          return {
            files: ["/e2e/fixtures/a/b/c/deep.md"],
            folders: ["/e2e/fixtures"],
          };
        return origMock(cmd, args);
      };
    });
    await page.goto("/");
    await expect(page.locator(".folder-tree")).toBeVisible();

    // Ancestors a, a/b, a/b/c should all auto-expand.
    const a = page.locator('.folder-tree [data-path="/e2e/fixtures/a"]');
    const ab = page.locator('.folder-tree [data-path="/e2e/fixtures/a/b"]');
    const abc = page.locator('.folder-tree [data-path="/e2e/fixtures/a/b/c"]');
    await expect(a).toHaveAttribute("aria-expanded", "true");
    await expect(ab).toHaveAttribute("aria-expanded", "true");
    await expect(abc).toHaveAttribute("aria-expanded", "true");

    // The deep.md row must be rendered AND scrolled into view.
    const deepRow = page.locator('.folder-tree [data-path="/e2e/fixtures/a/b/c/deep.md"]');
    await expect(deepRow).toBeVisible();
    await expect(deepRow).toBeInViewport();
  });

  // ── Issue #40 / Wave 2: "Other files" section ─────────────────────────────
  // Implementation note: the "Other files" header is driven by OPEN TABS that
  // live outside `root`, not by filter results. We test the actual observable
  // behavior here. (The header is not gated on the filter input.)
  test("21.6 - 'Other files' header appears when an open tab lives outside root", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const origMock = window.__TAURI_IPC_MOCK__!;
      window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "get_launch_args")
          return {
            files: ["/elsewhere/outside.md"],
            folders: ["/e2e/fixtures"],
          };
        if (cmd === "check_path_exists") {
          const p = (args as { path: string }).path;
          return p === "/elsewhere/outside.md" ? "file" : "file";
        }
        return origMock(cmd, args);
      };
    });
    await page.goto("/");
    await expect(page.locator(".folder-tree")).toBeVisible();

    // Header is present and exposes the count.
    const header = page.locator(".folder-tree-other-files-header");
    await expect(header).toBeVisible();
    await expect(header).toContainText("Other files");
    await expect(header).toContainText("(1)");

    // The out-of-root file is rendered under the header.
    const outsideRow = page.locator('.folder-tree [data-path="/elsewhere/outside.md"]');
    await expect(outsideRow).toBeVisible();

    // In-root files still render in the main tree below.
    await expect(page.locator(".folder-tree").getByText("sample.md")).toBeVisible();
  });

  test("21.7 - 'Other files' header is NOT shown when all tabs live inside root", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const origMock = window.__TAURI_IPC_MOCK__!;
      window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "get_launch_args")
          return {
            files: ["/e2e/fixtures/sample.md"],
            folders: ["/e2e/fixtures"],
          };
        return origMock(cmd, args);
      };
    });
    await page.goto("/");
    await expect(page.locator(".folder-tree")).toBeVisible();
    await expect(page.locator(".markdown-viewer")).toBeVisible();

    // No tab outside root → header must not render at all.
    await expect(page.locator(".folder-tree-other-files-header")).toHaveCount(0);
  });

  // ── Issue #40 / Wave 2: live folder updates via folder-changed events ─────
  test("21.8 - folder-changed event refreshes a cached (expanded) directory", async ({ page }) => {
    await page.addInitScript(() => {
      const origMock = window.__TAURI_IPC_MOCK__!;
      window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "get_launch_args") return { files: [], folders: ["/e2e/fixtures"] };
        return origMock(cmd, args);
      };
    });
    await page.goto("/");
    await expect(page.locator(".folder-tree")).toBeVisible();

    // Expand subfolder so it is cached. Wait for its child to render.
    await page.locator('.folder-tree [data-path="/e2e/fixtures/subfolder"]').click();
    await expect(
      page.locator('.folder-tree [data-path="/e2e/fixtures/subfolder/deep.md"]')
    ).toBeVisible();

    // New file does not exist in the tree yet.
    const newRow = page.locator(
      '.folder-tree [data-path="/e2e/fixtures/subfolder/created.md"]'
    );
    await expect(newRow).toHaveCount(0);

    // Mutate the dir-data so the next read_dir for subfolder returns a new
    // entry, then dispatch the folder-changed event for the cached path.
    await page.evaluate(() => {
      const data = (window as Record<string, unknown>).__DIR_DATA__ as Record<
        string,
        Array<{ name: string; path: string; is_dir: boolean }>
      >;
      data["/e2e/fixtures/subfolder"] = [
        ...data["/e2e/fixtures/subfolder"],
        {
          name: "created.md",
          path: "/e2e/fixtures/subfolder/created.md",
          is_dir: false,
        },
      ];
      const dispatch = (window as Record<string, unknown>).__DISPATCH_TAURI_EVENT__ as (
        event: string,
        payload: unknown
      ) => void;
      dispatch("folder-changed", { path: "/e2e/fixtures/subfolder" });
    });

    // The new file appears in the tree without any user action / F5.
    await expect(newRow).toBeVisible();
  });

  test("21.9 - folder-changed event is ignored for an uncached directory", async ({ page }) => {
    await page.addInitScript(() => {
      const origMock = window.__TAURI_IPC_MOCK__!;
      window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "get_launch_args") return { files: [], folders: ["/e2e/fixtures"] };
        return origMock(cmd, args);
      };
    });
    await page.goto("/");
    await expect(page.locator(".folder-tree")).toBeVisible();

    // Confirm root has been read (expected) and that "other" was NEVER read.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const c = (window as Record<string, unknown>).__READ_DIR_CALLS__ as Record<
            string,
            number
          >;
          return c["/e2e/fixtures"] ?? 0;
        })
      )
      .toBeGreaterThanOrEqual(1);
    expect(
      await page.evaluate(() => {
        const c = (window as Record<string, unknown>).__READ_DIR_CALLS__ as Record<
          string,
          number
        >;
        return c["/e2e/fixtures/other"] ?? 0;
      })
    ).toBe(0);

    // Dispatch folder-changed for the uncached "other" dir.
    await page.evaluate(() => {
      const dispatch = (window as Record<string, unknown>).__DISPATCH_TAURI_EVENT__ as (
        event: string,
        payload: unknown
      ) => void;
      dispatch("folder-changed", { path: "/e2e/fixtures/other" });
    });

    // Give the event loop a tick to drain any (incorrectly) scheduled work,
    // then assert the call counter for "other" is still zero. Use polling
    // with a short window so we don't rely on waitForTimeout.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const c = (window as Record<string, unknown>).__READ_DIR_CALLS__ as Record<
              string,
              number
            >;
            return c["/e2e/fixtures/other"] ?? 0;
          }),
        { timeout: 1000, intervals: [50, 100, 200] }
      )
      .toBe(0);
  });
});
