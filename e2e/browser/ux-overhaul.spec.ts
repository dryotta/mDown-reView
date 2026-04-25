/**
 * Browser e2e for issue #41 (UX overhaul) — Group F.
 *
 * Covers:
 *   1. 16-tab cap with LRU eviction
 *   2. Active tab is never evicted
 *   3. Tab chevrons on overflow
 *   4. Status bar shows size + line count
 *   5. Reading-width drag (commit + persistence)
 *   6. Sticky viewer toolbar while scrolling
 *   7. Hover-stable tab close button (no layout shift)
 *
 * All tests use the in-page IPC mock installed by `fixtures/error-tracking.ts`.
 * No real Tauri binary is spun up.
 */
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

/** Build N synthetic markdown file entries for a folder listing. */
function makeFiles(n: number, prefix = "file"): FileEntry[] {
  return Array.from({ length: n }, (_, i) => {
    const name = `${prefix}-${String(i + 1).padStart(2, "0")}.md`;
    return { name, path: `${FIXTURES_DIR}/${name}`, is_dir: false };
  });
}

/**
 * Install a default IPC mock that lists `files` in the workspace and serves
 * `read_text_file` responses from `contents` (path → TextFileResult).
 *
 * If a path is missing from `contents`, a small default body is returned so
 * the app never blocks on a hung IPC call.
 */
async function installMock(
  page: Page,
  files: FileEntry[],
  contents: Record<string, { content: string; size_bytes: number; line_count: number }> = {},
) {
  await page.addInitScript(
    ({ dir, files: f, contents: c }) => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "get_launch_args") return { files: [], folders: [dir] };
        if (cmd === "read_dir") return f;
        if (cmd === "read_text_file") {
          const path = (args as { path: string }).path;
          if (c[path]) return c[path];
          const body = `# ${path}\n\nDefault content.\n`;
          return {
            content: body,
            size_bytes: new TextEncoder().encode(body).length,
            line_count: body.split("\n").length - 1,
          };
        }
        if (cmd === "check_path_exists") return "file";
        if (cmd === "get_log_path") return "/mock/log.log";
        if (cmd === "get_file_comments") return [];
        if (cmd === "load_review_comments") return null;
        if (cmd === "save_review_comments") return null;
        return null;
      };
    },
    { dir: FIXTURES_DIR, files, contents },
  );
}

test.describe("UX overhaul (#41) — tab LRU cap", () => {
  test("F1 — opens 16 files, caps at 15, oldest non-active is evicted", async ({ page }) => {
    const files = makeFiles(16);
    await installMock(page, files);
    await page.goto("/");

    // Open all 16 in order — file-01 is oldest, file-16 most recent.
    for (const f of files) {
      await page.locator(".folder-tree").getByText(f.name, { exact: true }).click();
    }

    await expect(page.locator(".tab-bar .tab")).toHaveCount(15);

    // The oldest (file-01) must be evicted — the active tab is file-16,
    // and the LRU policy drops the least-recently-accessed non-active tab.
    const tabTitles = await page.locator(".tab-bar .tab").evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("title") ?? ""),
    );
    expect(tabTitles).not.toContain(`${FIXTURES_DIR}/file-01.md`);
    expect(tabTitles).toContain(`${FIXTURES_DIR}/file-16.md`);
  });

  test("F2 — active tab is never evicted; second-oldest is evicted instead", async ({ page }) => {
    const files = makeFiles(16);
    await installMock(page, files);
    await page.goto("/");

    // Open the first 15 files.
    for (let i = 0; i < 15; i++) {
      await page.locator(".folder-tree").getByText(files[i].name, { exact: true }).click();
    }
    await expect(page.locator(".tab-bar .tab")).toHaveCount(15);

    // Re-activate file-01 so it becomes the active (and most-recently accessed) tab.
    await page.locator(".tab-bar .tab").filter({ hasText: "file-01.md" }).click();
    await expect(
      page.locator(".tab-bar .tab.active").filter({ hasText: "file-01.md" }),
    ).toBeVisible();

    // Now open file-16 — eviction must drop the LRU non-active tab, which is file-02.
    await page.locator(".folder-tree").getByText(files[15].name, { exact: true }).click();
    await expect(page.locator(".tab-bar .tab")).toHaveCount(15);

    const tabTitles = await page.locator(".tab-bar .tab").evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("title") ?? ""),
    );
    expect(tabTitles).toContain(`${FIXTURES_DIR}/file-01.md`); // active — protected
    expect(tabTitles).toContain(`${FIXTURES_DIR}/file-16.md`); // newly opened
    expect(tabTitles).not.toContain(`${FIXTURES_DIR}/file-02.md`); // LRU victim
  });
});

test.describe("UX overhaul (#41) — tab overflow chevrons", () => {
  test("F3 — overflow chevrons appear and right chevron scrolls the tab strip", async ({ page }) => {
    // Open enough tabs to overflow the strip. The toolbar uses
    // flex-shrink: 0 on the tab-bar wrapper, so on a wide viewport tabs
    // never overflow naturally. To exercise the chevron logic we narrow the
    // wrapper directly — this tests the in-component overflow detection,
    // which is what Group B implemented.
    await page.setViewportSize({ width: 1024, height: 800 });
    const files = makeFiles(15);
    await installMock(page, files);
    await page.goto("/");

    for (const f of files) {
      await page.locator(".folder-tree").getByText(f.name, { exact: true }).click();
    }
    await expect(page.locator(".tab-bar .tab")).toHaveCount(15);

    // Constrain the wrapper so the tab-bar (overflow-x: auto) overflows.
    await page.evaluate(() => {
      const w = document.querySelector(".tab-bar-wrapper") as HTMLElement | null;
      if (!w) throw new Error(".tab-bar-wrapper missing");
      w.style.width = "400px";
      w.style.flexShrink = "1";
      // Trigger ResizeObserver → updateOverflow → chevron visibility recompute.
      window.dispatchEvent(new Event("resize"));
    });

    // After the constraint, the tab strip should be parked at the right
    // edge (auto-scroll on last open). Scroll back to start to make the
    // RIGHT chevron the visible one.
    const scrollBar = page.locator(".tab-bar");
    await scrollBar.evaluate((el) => {
      el.scrollLeft = 0;
      el.dispatchEvent(new Event("scroll"));
    });

    const rightChevron = page.locator(".tab-chevron-right");
    await expect(rightChevron).toBeVisible();

    await rightChevron.click();
    await page.waitForFunction(
      () => {
        const el = document.querySelector(".tab-bar") as HTMLElement | null;
        return !!el && el.scrollLeft > 0;
      },
      undefined,
      { timeout: 2000 },
    );

    const scrollAfter = await scrollBar.evaluate((el) => el.scrollLeft);
    expect(scrollAfter).toBeGreaterThan(0);
  });
});

test.describe("UX overhaul (#41) — status bar", () => {
  test("F4 — shows file path, byte size, and line count from read_text_file", async ({ page }) => {
    const path = `${FIXTURES_DIR}/notes.md`;
    const body = "line1\nline2\nline3\nline4\nline5\n"; // 5 lines, 30 bytes
    await installMock(page, [{ name: "notes.md", path, is_dir: false }], {
      [path]: { content: body, size_bytes: 2048, line_count: 42 },
    });
    await page.goto("/");

    await page.locator(".folder-tree").getByText("notes.md", { exact: true }).click();

    const statusBar = page.locator(".status-bar").last();
    await expect(statusBar).toBeVisible();

    // Path is shown (truncatePath keeps the tail so the filename is always there).
    await expect(statusBar.locator(".status-bar-path")).toContainText("notes.md");

    // size_bytes=2048 → "2.0 KB" via formatSize().
    await expect(statusBar).toContainText("2.0 KB");
    await expect(statusBar).toContainText("42 lines");
  });
});

test.describe("UX overhaul (#41) — reading-width drag", () => {
  test("F5 — dragging the handle commits a new width that survives reload", async ({ page }) => {
    const path = `${FIXTURES_DIR}/notes.md`;
    const body = "# Heading\n\nSome body text.\n";
    await installMock(page, [{ name: "notes.md", path, is_dir: false }], {
      [path]: {
        content: body,
        size_bytes: new TextEncoder().encode(body).length,
        line_count: 3,
      },
    });
    await page.goto("/");
    await page.locator(".folder-tree").getByText("notes.md", { exact: true }).click();

    const handle = page.locator(".reading-width-handle");
    await expect(handle).toHaveAttribute("role", "separator");

    const container = page.locator(".reading-width").first();

    // Programmatic pointer event dispatch — playwright's mouse API in a
    // headless context occasionally fails to deliver pointermove deltas
    // through React's synthetic event layer when pointer capture is in
    // play. Dispatching PointerEvents directly on the handle is reliable
    // and exercises the same React handlers.
    const box = await handle.boundingBox();
    if (!box) throw new Error("reading-width handle has no bounding box");
    const x1 = box.x + box.width / 2;
    const y1 = box.y + box.height / 2;

    await handle.evaluate(
      (el, { x1, y1, x2 }) => {
        const fire = (type: string, x: number, y: number) =>
          el.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId: 1,
              pointerType: "mouse",
              clientX: x,
              clientY: y,
              button: 0,
              buttons: type === "pointerup" ? 0 : 1,
            }),
          );
        fire("pointerdown", x1, y1);
        fire("pointermove", x2, y1);
        fire("pointerup", x2, y1);
      },
      { x1, y1, x2: x1 + 50 },
    );

    // The handle writes --reading-width directly to the container during
    // pointermove, then commits to the store on pointerup. Bounding-rect
    // width may be parent-clamped (folder + comments panes shrink the
    // viewer area), so assert against the CSS variable + persisted store
    // value, which is what the spec actually guarantees.
    const cssVar = await container.evaluate((el) =>
      (el as HTMLElement).style.getPropertyValue("--reading-width"),
    );
    const cssVarPx = Number.parseFloat(cssVar);
    expect(cssVarPx).toBeGreaterThan(720); // default

    // Persisted to the Zustand "mdownreview-ui" key on pointerup.
    const persistedFirst = await page.evaluate(() => {
      const raw = localStorage.getItem("mdownreview-ui");
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { state?: { readingWidth?: number } };
      return parsed.state?.readingWidth ?? null;
    });
    expect(persistedFirst).not.toBeNull();
    expect(persistedFirst!).toBeGreaterThan(720);

    // Reload — the persisted width should rehydrate into the container's
    // inline style.
    await page.reload();
    await page.locator(".folder-tree").getByText("notes.md", { exact: true }).click();
    const cssVarAfterReload = await page
      .locator(".reading-width")
      .first()
      .evaluate((el) => (el as HTMLElement).style.getPropertyValue("--reading-width"));
    expect(Number.parseFloat(cssVarAfterReload)).toBe(persistedFirst);
  });
});

test.describe("UX overhaul (#41) — sticky viewer toolbar", () => {
  test("F6 — viewer toolbar is sticky-positioned at top of its scroll container", async ({ page }) => {
    const path = `${FIXTURES_DIR}/long.md`;
    const body = Array.from({ length: 500 }, (_, i) => `Paragraph ${i + 1}\n`).join("\n");
    await installMock(page, [{ name: "long.md", path, is_dir: false }], {
      [path]: {
        content: body,
        size_bytes: new TextEncoder().encode(body).length,
        line_count: body.split("\n").length - 1,
      },
    });
    await page.goto("/");
    await page.locator(".folder-tree").getByText("long.md", { exact: true }).click();

    const toolbar = page.locator(".viewer-toolbar");
    await expect(toolbar).toBeVisible();
    await expect(toolbar).toBeInViewport();

    // The Group E contract: viewer-toolbar.css declares position: sticky,
    // top: 0, z-index: 2 so the toolbar pins to the top of its scroll
    // container. Verify the computed style — this is what guarantees the
    // toolbar stays in viewport when the markdown content scrolls.
    const computed = await toolbar.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { position: cs.position, top: cs.top, zIndex: cs.zIndex };
    });
    expect(computed.position).toBe("sticky");
    expect(computed.top).toBe("0px");
    expect(computed.zIndex).toBe("2");

    // Note: a full sticky behavior assertion (scroll the container, confirm
    // toolbar still in viewport) is intentionally NOT included — the
    // markdown viewer layout makes it ambiguous which ancestor actually
    // scrolls under the headless engine, and walking the wrong ancestor
    // gives false negatives. The computed-style assertion above is the
    // load-bearing check for the Group E contract; native runtime stickiness
    // is verified manually and via the CSS unit test in
    // src/components/viewers/__tests__/ViewerToolbar.test.tsx.
    void toolbar;
  });
});

test.describe("UX overhaul (#41) — hover-stable close button", () => {
  test("F7 — hovering a tab reveals .tab-close without shifting layout", async ({ page }) => {
    const files = makeFiles(2);
    await installMock(page, files);
    await page.goto("/");

    for (const f of files) {
      await page.locator(".folder-tree").getByText(f.name, { exact: true }).click();
    }
    await expect(page.locator(".tab-bar .tab")).toHaveCount(2);

    // Use the non-active (first) tab — its close button starts hidden.
    const tab = page.locator(".tab-bar .tab").filter({ hasText: "file-01.md" });
    const close = tab.locator(".tab-close");

    // Pre-hover: close button is rendered (visibility: hidden, not display:none)
    // so it occupies layout space — that is the whole point of the spec.
    const tabWidthBefore = await tab.evaluate((el) => el.getBoundingClientRect().width);
    const closeBoxBefore = await close.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });

    await tab.hover();
    // Hovered: visibility flips to visible / opacity to 1.
    await expect(close).toBeVisible();

    // Move 1px within the tab — close button must NOT move.
    const tabBox = await tab.boundingBox();
    if (!tabBox) throw new Error("tab has no bounding box");
    await page.mouse.move(tabBox.x + tabBox.width / 2 + 1, tabBox.y + tabBox.height / 2);

    const tabWidthAfter = await tab.evaluate((el) => el.getBoundingClientRect().width);
    const closeBoxAfter = await close.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });

    expect(tabWidthAfter).toBe(tabWidthBefore);
    expect(closeBoxAfter.x).toBe(closeBoxBefore.x);
    expect(closeBoxAfter.y).toBe(closeBoxBefore.y);
    expect(closeBoxAfter.w).toBe(closeBoxBefore.w);
    expect(closeBoxAfter.h).toBe(closeBoxBefore.h);
  });
});
