// Issue #352 iter 2 Group B — verifies the Excalidraw viewer's tri-state
// Source ↔ Visual ↔ Editor mode switching at the browser layer, plus the
// CSP / no-network smoke gates required by the security & react-tauri
// pre-consults.

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

const SAMPLE_EXCALIDRAW = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "test",
  elements: [],
  appState: {},
  files: {},
});

async function setupExcalidrawMocks(page: Page) {
  await page.addInitScript(
    ({ dir, content }: { dir: string; content: string }) => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
        void args;
        if (cmd === "get_launch_args") return { files: [], folders: [dir] };
        if (cmd === "read_dir") {
          return [{ name: "diagram.excalidraw", path: `${dir}/diagram.excalidraw`, is_dir: false }];
        }
        if (cmd === "read_text_file") {
          return { content, size_bytes: content.length, line_count: 1 };
        }
        if (cmd === "stat_file") return { size_bytes: content.length };
        if (cmd === "load_review_comments") {
          return { mrsf_version: "1.0", document: "diagram.excalidraw", comments: [] };
        }
        if (cmd === "save_review_comments") return null;
        if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
        if (cmd === "check_path_exists") return "file";
        if (cmd === "get_log_path") return "/mock/log.log";
        if (cmd === "compute_anchor_hash") return "deadbeef";
        if (cmd === "get_file_badges") return {};
        // Canonical bootstrap-IPC commands (per docs/test-strategy.md
        // rule 9 — eleven-command init contract). Any spec missing
        // these stalls if the renderer awaits them during folder open
        // (review finding test-expert T1).
        if (cmd === "scan_review_files") return [];
        if (cmd === "update_watched_files") return null;
        return null;
      };
    },
    { dir: FIXTURES_DIR, content: SAMPLE_EXCALIDRAW },
  );
}

test.describe("Excalidraw viewer — tri-state mode switching", () => {
  test.beforeEach(async ({ page }) => {
    // CSP-violation gate (security pre-consult): any console error matching
    // the CSP refusal pattern fails the test fast. pageerror catches
    // uncaught JS failures (e.g. a hard module-load error).
    page.on("pageerror", (err) => {
      throw new Error(`Browser error during Excalidraw test: ${err.message}`);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error" && /Refused to|Content Security Policy|CSP/i.test(msg.text())) {
        throw new Error(`CSP violation during Excalidraw test: ${msg.text()}`);
      }
    });

    // Network smoke (react-tauri pre-consult): block + record any request
    // to a third-party CDN that would indicate Excalidraw is loading
    // assets at runtime instead of from the vendored bundle.
    const externalRequests: string[] = [];
    (page as Page & { __externalRequests?: string[] }).__externalRequests = externalRequests;
    await page.route(/(esm\.run|cdn\.jsdelivr\.net|unpkg\.com)/, (route) => {
      externalRequests.push(route.request().url());
      void route.abort();
    });
  });

  test("switches Source → Visual → Editor → Source and the shell tracks data-mode", async ({ page }) => {
    await setupExcalidrawMocks(page);
    await page.goto("/");

    await page.locator(".folder-tree").getByText("diagram.excalidraw").click();

    // Default for excalidraw is Visual (per file-types.ts DEFAULT_VIEW_MAP).
    const shell = page.getByTestId("excalidraw-shell");
    await expect(shell).toBeVisible();
    await expect(shell).toHaveAttribute("data-mode", "visual");

    // → Editor
    await page.locator(".viewer-toolbar").getByRole("button", { name: /^editor$/i }).click();
    await expect(shell).toHaveAttribute("data-mode", "editor");

    // → Source: ExcalidrawView unmounts; SourceView takes over.
    // (Iter-13: the persistent host keeps the slot mounted to preserve
    // the canvas state, but hides it via display:none when the active
    // tab is in Source mode. Assert visibility, not count.)
    await page.locator(".viewer-toolbar").getByRole("button", { name: /^source$/i }).click();
    await expect(shell).not.toBeVisible();

    // → Visual again
    await page.locator(".viewer-toolbar").getByRole("button", { name: /^visual$/i }).click();
    await expect(page.getByTestId("excalidraw-shell")).toHaveAttribute("data-mode", "visual");

    // No third-party CDN requests fired during the entire flow.
    const externalRequests = (page as Page & { __externalRequests?: string[] }).__externalRequests ?? [];
    expect(externalRequests).toEqual([]);
  });

  // Iter-18 (user-reported regression): toolbar zoom buttons used to
  // no-op for Excalidraw because the React `zoomByFiletype` value was
  // never plumbed into the canvas. After iter-18, +/- toolbar clicks
  // call `excalidrawAPI.updateScene({ appState: { zoom: { value }}})`
  // and the canvas's appState.zoom.value reflects the change.
  test("toolbar +/- zoom buttons drive Excalidraw canvas zoom", async ({ page }) => {
    await setupExcalidrawMocks(page);
    await page.goto("/");

    await page.locator(".folder-tree").getByText("diagram.excalidraw").click();
    // Default = Visual; canvas mounts and exposes the imperative API
    // via the DEV-only `__EXCALIDRAW_API__` global (set in
    // ExcalidrawView.tsx).
    await expect(page.getByTestId("excalidraw-shell")).toBeVisible();

    // Wait for Excalidraw to surface its imperative API on window.
    await expect
      .poll(
        async () =>
          await page.evaluate(() => {
            const w = window as unknown as {
              __EXCALIDRAW_API__?: {
                getAppState?: () => { zoom?: { value: number } };
              };
            };
            return typeof w.__EXCALIDRAW_API__?.getAppState === "function";
          }),
        { timeout: 10_000, intervals: [100, 250, 500] },
      )
      .toBe(true);

    // Read initial zoom (default 1.0).
    const initialZoom = await page.evaluate(() => {
      const w = window as unknown as {
        __EXCALIDRAW_API__?: { getAppState: () => { zoom: { value: number } } };
      };
      return w.__EXCALIDRAW_API__!.getAppState().zoom.value;
    });
    expect(initialZoom).toBeCloseTo(1.0, 2);

    // Click the toolbar's "+" button. The button's accessible name in
    // the existing `ZoomControl` component is "Zoom in".
    await page.locator(".viewer-toolbar").getByRole("button", { name: /zoom in/i }).click();

    // Canvas zoom should now be > 1.0 (the bumpZoom step is 0.1).
    await expect
      .poll(async () =>
        await page.evaluate(() => {
          const w = window as unknown as {
            __EXCALIDRAW_API__?: { getAppState: () => { zoom: { value: number } } };
          };
          return w.__EXCALIDRAW_API__!.getAppState().zoom.value;
        }),
      { timeout: 5_000 },
      )
      .toBeGreaterThan(1.0);

    // Click "-" to decrease.
    const beforeOut = await page.evaluate(() => {
      const w = window as unknown as {
        __EXCALIDRAW_API__?: { getAppState: () => { zoom: { value: number } } };
      };
      return w.__EXCALIDRAW_API__!.getAppState().zoom.value;
    });
    await page.locator(".viewer-toolbar").getByRole("button", { name: /zoom out/i }).click();
    await expect
      .poll(async () =>
        await page.evaluate(() => {
          const w = window as unknown as {
            __EXCALIDRAW_API__?: { getAppState: () => { zoom: { value: number } } };
          };
          return w.__EXCALIDRAW_API__!.getAppState().zoom.value;
        }),
      { timeout: 5_000 },
      )
      .toBeLessThan(beforeOut);
  });

  // Iter-18 — Excalidraw's built-in zoom widget (the bottom-left +/-/%
  // chrome) is hidden by CSS so the user has exactly one set of zoom
  // controls (the viewer-toolbar). Locate by the `.zoom-button` class
  // that Excalidraw stamps on its own buttons; expect 0 visible.
  test("Excalidraw built-in zoom widget is hidden", async ({ page }) => {
    await setupExcalidrawMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("diagram.excalidraw").click();
    await expect(page.getByTestId("excalidraw-shell")).toBeVisible();
    // The built-in zoom buttons are inside the host slot. CSS in
    // `excalidraw-host.css` sets `display: none !important` on
    // `.zoom-button` etc. — Playwright's locator excludes
    // display:none from matches.
    const builtInZoom = page.locator(".excalidraw-host__slot .zoom-button");
    await expect(builtInZoom).toHaveCount(0);
  });
});
