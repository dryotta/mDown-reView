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
  });

  test("Save button is hidden in Visual mode and visible in Editor mode", async ({ page }) => {
    await setupSaveFlowMocks(page);
    await page.goto("/");

    await page.locator(".folder-tree").getByText("diagram.excalidraw").click();

    // Default mode is Visual — Save button must NOT be visible.
    await expect(page.getByTestId("excalidraw-save")).toHaveCount(0);

    // Switch to Editor → Save button appears with the literal text "Save".
    await page.locator(".viewer-toolbar").getByRole("button", { name: /^editor$/i }).click();
    const saveBtn = page.getByTestId("excalidraw-save");
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toHaveText("Save");
    await expect(saveBtn).toHaveAttribute("title", "Save (Ctrl+S)");
  });

  test("Save button click dispatches mdownreview:excalidraw-save-request", async ({ page }) => {
    await setupSaveFlowMocks(page);
    await page.goto("/");

    await page.locator(".folder-tree").getByText("diagram.excalidraw").click();
    await page.locator(".viewer-toolbar").getByRole("button", { name: /^editor$/i }).click();
    await expect(page.getByTestId("excalidraw-save")).toBeVisible();

    await page.getByTestId("excalidraw-save").click();

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
    await expect(page.getByTestId("excalidraw-save")).toBeVisible();

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

