/**
 * Browser E2E — folder-pane drag handle must actually resize the
 * visible folder pane.
 *
 * Regression for the bug filed on 2026-05-02: dragging the handle
 * updated `--folder-pane-width` but the wrapper had only `max-width`
 * (no `width`/`flex-basis`), so the wrapper stayed sized to its
 * content. The slider could only narrow the pane below the natural
 * content width — never widen it past that.
 *
 * The fix lives in `src/styles/folder-tree.css` (`width: var(...)` +
 * `flex-shrink: 0` on `.folder-pane-wrapper`) and
 * `src/components/FolderPaneShell.tsx` (`is-dragging` class to
 * suppress the width transition during a live drag).
 *
 * This spec asserts the user-visible geometry: the pane's bounding
 * box must grow when the user drags right and shrink when the user
 * drags left.
 */

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";
const SEEDED_WIDTH = 240;

async function setupMocks(page: Page): Promise<void> {
  await page.addInitScript(({ dir, seededWidth }: { dir: string; seededWidth: number }) => {
    window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
      if (cmd === "get_launch_args") return { files: [], folders: [dir] };
      if (cmd === "read_dir")
        return [
          { name: "a.md", path: `${dir}/a.md`, is_dir: false },
          { name: "b.md", path: `${dir}/b.md`, is_dir: false },
        ];
      if (cmd === "read_text_file") return "# Doc";
      if (cmd === "load_review_comments") return null;
      if (cmd === "check_path_exists") return "file";
      if (cmd === "get_log_path") return "/mock/log.log";
      if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
      if (cmd === "get_file_badges") return {};
      return null;
    };
    // Seed a known starting width so deltas are deterministic.
    try {
      localStorage.setItem(
        "mdownreview-ui",
        JSON.stringify({
          state: { folderPaneWidth: seededWidth, commentsPaneVisible: false },
          version: 1,
        }),
      );
    } catch {
      // best effort
    }
  }, { dir: FIXTURES_DIR, seededWidth: SEEDED_WIDTH });
}

/**
 * Wait until the wrapper's visible bounding box matches the seeded
 * `folderPaneWidth` to within 1 px. The wrapper has a 0.2 s `width`
 * transition (folder-tree.css) that runs on open/close. After the
 * workspace auto-opens on page load the wrapper animates from 0 →
 * --folder-pane-width; measuring during the transition returns
 * intermediate values and produces flaky deltas.
 */
async function waitForFolderPaneAtRest(page: Page, targetWidth: number): Promise<void> {
  await expect.poll(
    async () =>
      page.evaluate(() => {
        const el = document.querySelector<HTMLElement>(".folder-pane-wrapper");
        return el ? el.getBoundingClientRect().width : 0;
      }),
    { timeout: 2000, intervals: [50, 100, 200] },
  ).toBeCloseTo(targetWidth, 0);
}

async function readFolderPaneWidth(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".folder-pane-wrapper");
    if (!el) return NaN;
    return parseFloat(getComputedStyle(el).getPropertyValue("--folder-pane-width"));
  });
}

async function dragHandle(page: Page, deltaX: number): Promise<void> {
  const handle = page.locator(".folder-pane-wrapper .drag-handle");
  const box = await handle.boundingBox();
  if (!box) throw new Error("drag-handle has no bounding box");
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  // Use Playwright's high-level mouse API. The drag handler in
  // FolderPaneShell.tsx listens on `window` for mousemove/mouseup and
  // captures `e.clientX` at mousedown time, so all three events must
  // share a real synthesised mouse position. `page.mouse.{down,move,up}`
  // walks a real cursor through the chromium input pipeline, which is
  // what the React synthetic-event layer expects.
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Multiple intermediate moves so the handler sees several store
  // updates (mirrors a real user drag).
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(startX + (deltaX * i) / steps, startY);
  }
  await page.mouse.up();
}

test.describe("Folder pane resize (regression for 2026-05-02 bug)", () => {
  test("dragging the handle right widens the visible folder pane", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await setupMocks(page);
    await page.goto("/");
    const wrapper = page.locator(".folder-pane-wrapper");
    await expect(wrapper).toBeVisible();
    await expect(page.locator(".folder-tree").getByText("a.md")).toBeVisible();
    await waitForFolderPaneAtRest(page, SEEDED_WIDTH);

    const before = await wrapper.boundingBox();
    if (!before) throw new Error("wrapper has no bounding box");
    const widthBefore = await readFolderPaneWidth(page);

    await dragHandle(page, 120);

    const widthAfter = await readFolderPaneWidth(page);
    const after = await wrapper.boundingBox();
    if (!after) throw new Error("wrapper has no bounding box after drag");

    // The CSS variable MUST have grown by ~120 px. The pre-fix bug did
    // not fail this assertion — the variable did update; what failed
    // was the visible bounding box.
    expect(widthAfter - widthBefore).toBeGreaterThan(100);
    expect(widthAfter - widthBefore).toBeLessThan(140);

    // The visible pane width MUST track the variable. The pre-fix bug
    // returned `after.width ≈ before.width` because the wrapper was
    // pinned to its content width, not the slider value.
    const visibleDelta = after.width - before.width;
    const variableDelta = widthAfter - widthBefore;
    expect(Math.abs(visibleDelta - variableDelta)).toBeLessThan(2);
  });

  test("dragging the handle left narrows the visible folder pane", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await setupMocks(page);
    await page.goto("/");
    const wrapper = page.locator(".folder-pane-wrapper");
    await expect(wrapper).toBeVisible();
    await expect(page.locator(".folder-tree").getByText("a.md")).toBeVisible();
    await waitForFolderPaneAtRest(page, SEEDED_WIDTH);

    const before = await wrapper.boundingBox();
    if (!before) throw new Error("wrapper has no bounding box");
    const widthBefore = await readFolderPaneWidth(page);

    await dragHandle(page, -60);

    const widthAfter = await readFolderPaneWidth(page);
    const after = await wrapper.boundingBox();
    if (!after) throw new Error("wrapper has no bounding box after drag");

    // Variable went down by ~60 px. The drag handler clamps at 160 px
    // minimum; seed 240 − 60 = 180, safely above the clamp.
    expect(widthBefore - widthAfter).toBeGreaterThan(40);
    expect(widthBefore - widthAfter).toBeLessThan(80);

    // Visible pane tracks the variable.
    const visibleDelta = before.width - after.width;
    const variableDelta = widthBefore - widthAfter;
    expect(Math.abs(visibleDelta - variableDelta)).toBeLessThan(2);
  });

  test("during an active drag the wrapper carries the `is-dragging` class so the width transition is suppressed", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await setupMocks(page);
    await page.goto("/");
    const wrapper = page.locator(".folder-pane-wrapper");
    await expect(wrapper).toBeVisible();
    await waitForFolderPaneAtRest(page, SEEDED_WIDTH);

    const handle = page.locator(".folder-pane-wrapper .drag-handle");
    const box = await handle.boundingBox();
    if (!box) throw new Error("drag-handle has no bounding box");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    await page.mouse.move(x, y);
    await page.mouse.down();

    // Mid-drag: the wrapper should now carry `is-dragging`.
    await expect(wrapper).toHaveClass(/\bis-dragging\b/);

    // The CSS transition for `width` should be suppressed during drag.
    const transitionDuringDrag = await wrapper.evaluate(
      (el) => getComputedStyle(el).transitionDuration,
    );
    // `transition: none` resolves to "0s" for every property.
    expect(transitionDuringDrag).toMatch(/^0s($|,)/);

    await page.mouse.up();

    // After mouseup the class is gone and the open/close transition
    // is back in effect.
    await expect(wrapper).not.toHaveClass(/\bis-dragging\b/);
  });
});
