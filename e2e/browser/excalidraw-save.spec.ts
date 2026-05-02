// Issue #352 iter 3 — verifies the Excalidraw Save button + Ctrl+S
// shortcut at the browser layer (UI presence + event dispatch). The
// full IPC round-trip is covered by the unit tests
// (ExcalidrawView.test.tsx, saveScene.test.ts, useGlobalShortcuts.test.ts).
// This spec is a smoke gate for the UI plumbing.

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

interface MockState {
  saveEvents: { path: string }[];
}

async function setupSaveFlowMocks(page: Page) {
  await page.addInitScript(
    ({ dir, content }: { dir: string; content: string }) => {
      const state: MockState = { saveEvents: [] };
      (window as Window & { __MOCK_STATE__?: MockState }).__MOCK_STATE__ = state;

      // Capture every save-request DOM event the UI dispatches. This is
      // the public contract between the toolbar / Ctrl+S surfaces and the
      // mounted <ExcalidrawView/>; verifying the event fires (regardless
      // of whether the lazy chunk is loaded yet) covers AC5's UI half.
      window.addEventListener("mdownreview:excalidraw-save-request", (e) => {
        const detail = (e as CustomEvent).detail as { path: string };
        state.saveEvents.push({ path: detail.path });
      });

      window.__TAURI_IPC_MOCK__ = async (cmd: string, _args: Record<string, unknown>) => {
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
        if (cmd === "write_workspace_text") return null;
        if (cmd === "write_workspace_binary") return null;
        return null;
      };
    },
    { dir: FIXTURES_DIR, content: SAMPLE_EXCALIDRAW },
  );
}

test.describe("Excalidraw save UI plumbing (#352 iter 3)", () => {
  test.beforeEach(async ({ page }) => {
    page.on("pageerror", (err) => {
      throw new Error(`Browser error: ${err.message}`);
    });
    // Issue #352 / iter-5 BLOCKER (AC9 — assessor) — the save flow
    // exercises the Excalidraw export pipeline (`exportToBlob` /
    // `exportToSvg`); install the same network guard the
    // `excalidraw-modes.spec.ts` mode-switch flow uses, so a future
    // Excalidraw upgrade that fetches fonts at export time fails the
    // test instead of silently passing. Tightened from iter-2's CDN
    // denylist to a reasonable allowlist of expected hosts.
    const externalRequests: string[] = [];
    (page as Page & { __externalRequests?: string[] }).__externalRequests = externalRequests;
    await page.route("**/*", (route, request) => {
      const url = new URL(request.url());
      // Allowlist: localhost (Vite dev), tauri.localhost (desktop build),
      // about:blank for fixture iframes, and same-origin asset paths.
      if (
        url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "tauri.localhost" ||
        url.protocol === "data:" ||
        url.protocol === "blob:" ||
        url.protocol === "about:"
      ) {
        return route.continue();
      }
      externalRequests.push(request.url());
      return route.abort();
    });
  });

  test.afterEach(async ({ page }) => {
    const externalRequests = (page as Page & { __externalRequests?: string[] }).__externalRequests ?? [];
    expect(externalRequests).toEqual([]);
  });

  test("App-toolbar Save button is hidden in Visual mode and visible in Editor mode", async ({ page }) => {
    await setupSaveFlowMocks(page);
    await page.goto("/");

    await page.locator(".folder-tree").getByText("diagram.excalidraw").click();

    // Default mode is Visual — top app toolbar Save button must NOT be visible.
    await expect(page.getByTestId("app-toolbar-save")).toHaveCount(0);

    // Switch to Editor → Save button appears in the top app toolbar
    // (right of the Comments toggle), icon-only.
    await page.locator(".viewer-toolbar").getByRole("button", { name: /^editor$/i }).click();
    const saveBtn = page.getByTestId("app-toolbar-save");
    await expect(saveBtn).toBeVisible();
    // Disabled until there's a change (the user just opened the file).
    await expect(saveBtn).toBeDisabled();
    await expect(saveBtn).toHaveAttribute("title", "No unsaved changes");
    await expect(saveBtn).toHaveAttribute("aria-label", "Save");
  });

  test("App-toolbar Save button click dispatches mdownreview:excalidraw-save-request", async ({ page }) => {
    await setupSaveFlowMocks(page);
    await page.goto("/");

    await page.locator(".folder-tree").getByText("diagram.excalidraw").click();
    await page.locator(".viewer-toolbar").getByRole("button", { name: /^editor$/i }).click();

    // Manually mark the tab dirty so the Save button enables.
    await page.evaluate(() => {
      type Win = Window & {
        __TAURI_IPC_MOCK__?: unknown;
        // Direct store import isn't accessible from page context; use
        // a custom event the renderer's handler will translate. For
        // this test, dispatch the in-flight save and rely on the
        // dirty-marking flow inside ExcalidrawView.
      };
      void (window as Win);
      // Trigger a click on the Excalidraw stub canvas (only if testid
      // exists in production build — else we use a fake state push).
      // Fallback: use the action directly via the injected hook.
    });

    const saveBtn = page.getByTestId("app-toolbar-save");
    // The button starts disabled because nothing is dirty. Force-enable
    // by setting dirty via the store action.
    await page.evaluate(() => {
      const w = window as Window & { useStoreAccess?: unknown };
      void w;
      // We don't expose the store on window in tests; instead,
      // simulate user editing via a click on the Excalidraw stub.
    });

    // Simulate a user edit by clicking inside the Excalidraw canvas
    // surface — the stub captures clicks and forwards onChange.
    // (In real Excalidraw the canvas is the receiver; the stub
    // re-creates the API.)
    const stub = page.getByTestId("excalidraw-shell");
    await stub.click({ position: { x: 100, y: 100 } });
    await stub.click({ position: { x: 110, y: 110 } });

    // Save button should now be enabled.
    await expect(saveBtn).toBeEnabled();
    await expect(saveBtn).toHaveAttribute("title", "Save (Ctrl+S)");

    await saveBtn.click();

    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            (window as Window & { __MOCK_STATE__?: MockState }).__MOCK_STATE__?.saveEvents
              .length ?? 0,
        ),
      )
      .toBeGreaterThanOrEqual(1);

    const events = await page.evaluate(
      () => (window as Window & { __MOCK_STATE__?: MockState }).__MOCK_STATE__?.saveEvents ?? [],
    );
    expect(events[0].path).toBe(`${FIXTURES_DIR}/diagram.excalidraw`);
  });

  test("Ctrl+S in Editor mode dispatches the save event", async ({ page }) => {
    await setupSaveFlowMocks(page);
    await page.goto("/");

    await page.locator(".folder-tree").getByText("diagram.excalidraw").click();
    await page.locator(".viewer-toolbar").getByRole("button", { name: /^editor$/i }).click();
    // App-toolbar Save button visible (disabled until dirty).
    await expect(page.getByTestId("app-toolbar-save")).toBeVisible();

    // Move focus off the just-clicked button so the editable-target guard
    // doesn't matter (buttons are non-editable, but blurring matches the
    // production scenario where focus is on the canvas / body).
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    await page.keyboard.press("Control+s");

    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            (window as Window & { __MOCK_STATE__?: MockState }).__MOCK_STATE__?.saveEvents
              .length ?? 0,
        ),
      )
      .toBeGreaterThanOrEqual(1);
  });
});

