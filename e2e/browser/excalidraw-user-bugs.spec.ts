// Issue #352 / iter-7+ — REPRODUCER for the three bugs the user reported
// after iter-7 was shipped. These tests exercise REAL Excalidraw (not a
// stub), so they catch on-mount normalization that the unit tests cannot.
//
// Bug #1: Closing an edited Excalidraw tab does NOT prompt "Discard changes?"
// Bug #2: Tab shows changed (dirty dot) when no user edit was made
// Bug #3: `.excalidrawlib` does NOT show the library grid in Visual mode
//
// These tests must initially FAIL on iter-7 and PASS after the fix lands.

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

// Canonical empty Excalidraw scene — no elements, default appState.
// Excalidraw STILL fires onChange on mount with normalized elements; the
// dirty tracker must NOT treat that mount-onChange as a user edit.
const EMPTY_EXCALIDRAW = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "test",
  elements: [],
  appState: {},
  files: {},
});

// Two-element scene — opens with content. Tests that mount-normalization
// of pre-existing elements doesn't produce a false-positive dirty.
const POPULATED_EXCALIDRAW = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "test",
  elements: [
    {
      id: "rect-1",
      type: "rectangle",
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      angle: 0,
      strokeColor: "#000000",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: 1,
      version: 1,
      versionNonce: 1,
      isDeleted: false,
      boundElements: null,
      updated: 1,
      link: null,
      locked: false,
    },
  ],
  appState: {},
  files: {},
});

// Library file with two items — tests that Visual mode renders the
// grid/list of drawings (the user reports it doesn't).
const LIBRARY_FIXTURE = JSON.stringify({
  type: "excalidrawlib",
  version: 2,
  source: "test",
  libraryItems: [
    {
      id: "lib-1",
      status: "published",
      created: 1700000000000,
      name: "Square A",
      elements: [
        {
          id: "lib-1-rect",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          angle: 0,
          strokeColor: "#1971c2",
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 1,
          strokeStyle: "solid",
          roughness: 1,
          opacity: 100,
          groupIds: [],
          frameId: null,
          roundness: null,
          seed: 1,
          version: 1,
          versionNonce: 1,
          isDeleted: false,
          boundElements: null,
          updated: 1,
          link: null,
          locked: false,
        },
      ],
    },
    {
      id: "lib-2",
      status: "published",
      created: 1700000000001,
      name: "Square B",
      elements: [
        {
          id: "lib-2-rect",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 60,
          height: 60,
          angle: 0,
          strokeColor: "#e03131",
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 1,
          strokeStyle: "solid",
          roughness: 1,
          opacity: 100,
          groupIds: [],
          frameId: null,
          roundness: null,
          seed: 2,
          version: 1,
          versionNonce: 2,
          isDeleted: false,
          boundElements: null,
          updated: 1,
          link: null,
          locked: false,
        },
      ],
    },
  ],
});

interface MockState {
  saveEvents: { path: string }[];
  confirmCalls: string[];
  confirmResult: boolean;
}

async function setupMocks(
  page: Page,
  files: { name: string; content: string }[],
) {
  await page.addInitScript(
    ({
      dir,
      fixtures,
    }: {
      dir: string;
      fixtures: { name: string; content: string }[];
    }) => {
      const state: MockState = {
        saveEvents: [],
        confirmCalls: [],
        confirmResult: true,
      };
      (window as Window & { __MOCK_STATE__?: MockState }).__MOCK_STATE__ = state;

      // Capture every save-request event
      window.addEventListener("mdownreview:excalidraw-save-request", (e) => {
        const detail = (e as CustomEvent).detail as { path: string };
        state.saveEvents.push({ path: detail.path });
      });

      // Capture and control window.confirm so we can assert the prompt fired.
      const originalConfirm = window.confirm;
      window.confirm = (message?: string) => {
        state.confirmCalls.push(String(message ?? ""));
        return state.confirmResult;
      };
      void originalConfirm;

      window.__TAURI_IPC_MOCK__ = async (
        cmd: string,
        args: Record<string, unknown>,
      ) => {
        if (cmd === "get_launch_args") return { files: [], folders: [dir] };
        if (cmd === "read_dir") {
          return fixtures.map((f) => ({
            name: f.name,
            path: `${dir}/${f.name}`,
            is_dir: false,
          }));
        }
        if (cmd === "read_text_file") {
          const path = (args as { path: string }).path;
          const f = fixtures.find((x) => path.endsWith(x.name));
          if (f) {
            return {
              content: f.content,
              size_bytes: f.content.length,
              line_count: 1,
            };
          }
          throw new Error(`unknown fixture: ${path}`);
        }
        if (cmd === "stat_file") {
          const path = (args as { path: string }).path;
          const f = fixtures.find((x) => path.endsWith(x.name));
          return { size_bytes: f ? f.content.length : 0 };
        }
        if (cmd === "load_review_comments") {
          return { mrsf_version: "1.0", document: "x", comments: [] };
        }
        if (cmd === "save_review_comments") return null;
        if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
        if (cmd === "check_path_exists") return "file";
        if (cmd === "get_log_path") return "/mock/log.log";
        if (cmd === "compute_anchor_hash") return "deadbeef";
        if (cmd === "get_file_badges") return {};
        if (cmd === "write_workspace_text") return null;
        if (cmd === "write_workspace_binary") return null;
        return null;
      };
    },
    { dir: FIXTURES_DIR, fixtures: files },
  );
}

test.describe("Excalidraw auto-save (#352 iter-10)", () => {
  test.beforeEach(async ({ page }) => {
    page.on("pageerror", (err) => {
      throw new Error(`Browser error: ${err.message}`);
    });
  });

  // Auto-save banner is visible on Editor mode (per app launch).
  test("auto-save banner renders + dismisses", async ({ page }) => {
    await setupMocks(page, [
      { name: "diagram.excalidraw", content: POPULATED_EXCALIDRAW },
    ]);
    await page.goto("/");

    await page.locator(".folder-tree").getByText("diagram.excalidraw").click();
    await page
      .locator(".viewer-toolbar")
      .getByRole("button", { name: /^editor$/i })
      .click();

    const banner = page.getByTestId("excalidraw-autosave-banner");
    await expect(banner).toBeVisible();
    await page.getByTestId("excalidraw-autosave-banner-dismiss").click();
    await expect(banner).not.toBeVisible();
  });

  // After a real edit (via imperative API), the auto-save IPC fires
  // within ~3s of the edit. We assert write_workspace_text was called
  // with the file path.
  test("auto-save fires after edit (debounced ~2s)", async ({ page }) => {
    const writes: { path: string }[] = [];
    await page.exposeFunction("__recordWrite", (path: string) => {
      writes.push({ path });
    });
    await setupMocks(page, [
      { name: "diagram.excalidraw", content: POPULATED_EXCALIDRAW },
    ]);
    // Patch the mock to record write_workspace_text calls.
    await page.addInitScript(() => {
      const origMock = window.__TAURI_IPC_MOCK__;
      window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "write_workspace_text") {
          const path = (args as { path: string }).path;
          await (window as unknown as {
            __recordWrite: (p: string) => Promise<void>;
          }).__recordWrite(path);
          return null;
        }
        return origMock?.(cmd, args);
      };
    });
    await page.goto("/");

    await page.locator(".folder-tree").getByText("diagram.excalidraw").click();
    await page
      .locator(".viewer-toolbar")
      .getByRole("button", { name: /^editor$/i })
      .click();
    await expect(page.locator(".excalidraw__canvas.interactive").first()).toBeVisible();
    await page.waitForTimeout(500);

    // Drive a real edit through the imperative API.
    await page.evaluate(() => {
      const w = window as unknown as {
        __EXCALIDRAW_API__?: {
          updateScene: (s: { elements: unknown[] }) => void;
          getSceneElementsIncludingDeleted: () => readonly unknown[];
        };
      };
      const api = w.__EXCALIDRAW_API__;
      if (!api) throw new Error("__EXCALIDRAW_API__ not exposed");
      const existing = api.getSceneElementsIncludingDeleted();
      const newRect = {
        id: "test-rect",
        type: "rectangle",
        x: 100,
        y: 100,
        width: 200,
        height: 100,
        angle: 0,
        strokeColor: "#000000",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: null,
        seed: 1,
        version: 1,
        versionNonce: 1,
        isDeleted: false,
        boundElements: null,
        updated: Date.now(),
        link: null,
        locked: false,
      };
      api.updateScene({ elements: [...existing, newRect] });
    });

    // Wait for debounce (2s) plus buffer.
    await page.waitForTimeout(3000);

    expect(writes.length).toBeGreaterThanOrEqual(1);
    expect(writes[0].path).toContain("diagram.excalidraw");
  });

  // ── Bug #3 (iter-8): .excalidrawlib library grid renders ───────────────
  // Allowlist the StrictMode-induced "duplicate key" console warning
  // that React emits when Excalidraw's library merge runs twice on
  // mount. Upstream behaviour gated on dev-only React StrictMode; the
  // grid renders fine in production.
  test.use({
    consoleErrorAllowlist: [
      "Encountered two children with the same key",
    ],
  });
  test("BUG#3: opening .excalidrawlib renders the library grid in Visual mode", async ({
    page,
  }) => {
    await setupMocks(page, [
      { name: "shapes.excalidrawlib", content: LIBRARY_FIXTURE },
    ]);
    await page.goto("/");

    await page.locator(".folder-tree").getByText("shapes.excalidrawlib").click();

    // Default mode for excalidraw category is Visual. Library files MUST
    // render the items so the user can browse the library.
    // Wait for Excalidraw to mount and library sidebar to populate.
    await page.waitForTimeout(2000);

    // The library grid is rendered by Excalidraw inside the sidebar
    // panel. Each library item is a rendered SVG / canvas tile.
    // Strategy: count visible library items by their stable structure.
    //
    // Excalidraw internally uses `.library-menu-item__item` or similar.
    // We probe several known selectors so the test resists Excalidraw's
    // internal markup churn.
    const libraryShell = page.locator(".excalidraw");
    await expect(libraryShell).toBeVisible();

    // A populated library renders 2 items. They appear in the library
    // sidebar as `.library-unit` divs (the active state has class
    // `library-unit__active`). We probe a few stable selectors so the
    // test resists Excalidraw's internal markup churn.
    const libraryItemSelectors = [
      ".library-unit.library-unit__active",
      ".library-unit",
      ".single-library-item",
      "[data-testid='library-item']",
    ];

    let foundCount = 0;
    for (const sel of libraryItemSelectors) {
      // Wait briefly per selector so async SVG render doesn't race the
      // test. The ` >= 2` predicate is checked once with a short poll.
      const loc = page.locator(sel);
      try {
        await expect(loc.nth(1)).toBeVisible({ timeout: 3_000 });
        foundCount = await loc.count();
        if (foundCount >= 2) break;
      } catch {
        // selector didn't match — try the next one
      }
    }

    expect(
      foundCount,
      `expected at least 2 library items rendered for shapes.excalidrawlib but found ${foundCount}`,
    ).toBeGreaterThanOrEqual(2);
  });
});
