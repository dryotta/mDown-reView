// Issue #90 — viewer toolbar must remain pinned to the top of
// `.viewer-scroll-region` for the entire scroll length, not just the
// first viewport. Previously `.enhanced-viewer`/`.markdown-viewer`/
// `.source-view` were `height: 100%`, capping the sticky containing
// block at one viewport so the toolbar followed it off-screen.
//
// jsdom cannot compute `position: sticky`, so this is a browser-level
// Playwright spec. We assert
// `toolbar.getBoundingClientRect().top === scrollRegion.getBoundingClientRect().top`
// (within 1 px) at five scroll checkpoints (0, ¼, ½, ¾, end) for:
//   - Markdown visual mode      (default)
//   - Source mode               (toggled via toolbar)
//   - Markdown with mermaid     (stacking-context-heavy case)

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

// ≥ 4000 lines / ~150 KB tall markdown body. Generated rather than
// stored as a binary fixture so the e2e suite stays self-contained.
const TALL_MD = Array.from({ length: 4500 }, (_, i) =>
  `## Heading ${i}\n\nParagraph ${i} with sufficient text to give this section vertical height when rendered through react-markdown.\n`,
).join("\n");

// Source-mode equivalent: a long .ts file. The toolbar's source-mode
// branch renders `SourceView` whose root is `.source-view`.
const TALL_TS = Array.from({ length: 5000 }, (_, i) =>
  `// Line ${i}: const value_${i} = ${i}; // padding text to force a wide-enough single line so wrap is irrelevant`,
).join("\n");

// Stacking-context-heavy variant: a moderate-sized tall markdown body
// (still > 1 viewport so the scroll case is real) interleaved with a
// mermaid code block. Mermaid renders SVGs that establish their own
// stacking contexts via transforms; we want to confirm the sticky bar
// still pins despite those. Kept smaller than `TALL_MD` so the
// react-markdown parse + mermaid lazy-mount stays well under the
// per-test timeout.
const TALL_MD_MEDIUM = Array.from({ length: 800 }, (_, i) =>
  `## Heading ${i}\n\nParagraph ${i} with sufficient text to give this section vertical height when rendered through react-markdown.\n`,
).join("\n");
const MERMAID_BLOCK =
  "\n```mermaid\nflowchart TD\n  A[Start] --> B[End]\n```\n\n";
const TALL_MERMAID_MD = TALL_MD_MEDIUM + MERMAID_BLOCK + TALL_MD_MEDIUM;

interface FileSeed { name: string; content: string }

async function setupStickyMocks(page: Page, files: FileSeed[]): Promise<void> {
  await page.addInitScript(({ dir, files }: { dir: string; files: FileSeed[] }) => {
    const fileMap: Record<string, string> = {};
    const dirEntries = files.map((f) => {
      const path = `${dir}/${f.name}`;
      fileMap[path] = f.content;
      return { name: f.name, path, is_dir: false };
    });

    window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "get_launch_args") return { files: [], folders: [dir] };
      if (cmd === "read_dir") return dirEntries;
      if (cmd === "read_text_file") {
        const p = (args as { path: string }).path;
        return fileMap[p] ?? "";
      }
      if (cmd === "load_review_comments") return null;
      if (cmd === "save_review_comments") return null;
      if (cmd === "check_path_exists") return "file";
      if (cmd === "get_log_path") return "/mock/log.log";
      if (cmd === "get_file_comments") return [];
      if (cmd === "get_file_badges") return [];
      if (cmd === "scan_review_files") return [];
      if (cmd === "update_watched_files") return undefined;
      return null;
    };
  }, { dir: FIXTURES_DIR, files });
}

interface CheckpointResult {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  toolbarTop: number;
  scrollRegionTop: number;
}

/**
 * Scrolls `.viewer-scroll-region` to `targetRatio` of its scrollable
 * range and returns the relevant rects in the same evaluate call so
 * sticky-update races are avoided (the browser flushes sticky
 * positioning before returning from `scrollTo`).
 */
async function scrollAndMeasure(
  page: Page,
  targetRatio: number,
): Promise<CheckpointResult> {
  return page.evaluate((ratio) => {
    const scroll = document.querySelector(".viewer-scroll-region") as HTMLElement | null;
    const toolbar = document.querySelector(".viewer-toolbar") as HTMLElement | null;
    if (!scroll || !toolbar) {
      throw new Error("scroll region or toolbar not in DOM");
    }
    const max = scroll.scrollHeight - scroll.clientHeight;
    const target = Math.round(max * ratio);
    scroll.scrollTo(0, target);
    return {
      scrollTop: scroll.scrollTop,
      scrollHeight: scroll.scrollHeight,
      clientHeight: scroll.clientHeight,
      toolbarTop: toolbar.getBoundingClientRect().top,
      scrollRegionTop: scroll.getBoundingClientRect().top,
    };
  }, targetRatio);
}

const CHECKPOINTS = [0, 0.25, 0.5, 0.75, 1];

async function assertStickyAtCheckpoints(page: Page, label: string): Promise<void> {
  for (const ratio of CHECKPOINTS) {
    const m = await scrollAndMeasure(page, ratio);
    // Sanity: there must be real scroll to test against (otherwise the
    // bug is unreachable and the test is meaningless).
    expect(
      m.scrollHeight,
      `${label} @ ${ratio}: viewer must overflow viewport (got ${m.scrollHeight} vs ${m.clientHeight})`,
    ).toBeGreaterThan(m.clientHeight + 100);
    expect(
      Math.abs(m.toolbarTop - m.scrollRegionTop),
      `${label} @ ratio ${ratio}: toolbar.top=${m.toolbarTop} expected to equal scrollRegion.top=${m.scrollRegionTop} (±1px)`,
    ).toBeLessThanOrEqual(1);
  }
}

test.describe("Viewer toolbar sticky positioning (#90)", () => {
  test("markdown visual mode — toolbar stays pinned to scroll region top", async ({ page }) => {
    await setupStickyMocks(page, [{ name: "tall.md", content: TALL_MD }]);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("tall.md").click();
    await expect(page.locator(".markdown-viewer")).toBeVisible();
    await expect(page.locator(".viewer-toolbar").first()).toBeVisible();
    await assertStickyAtCheckpoints(page, "markdown");
  });

  test("source mode — toolbar stays pinned to scroll region top", async ({ page }) => {
    await setupStickyMocks(page, [{ name: "tall.ts", content: TALL_TS }]);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("tall.ts").click();
    await expect(page.locator(".source-view")).toBeVisible();
    await expect(page.locator(".viewer-toolbar").first()).toBeVisible();
    await assertStickyAtCheckpoints(page, "source");
  });

  test("markdown with mermaid (stacking-context-heavy) — toolbar stays pinned", async ({ page }) => {
    await setupStickyMocks(page, [{ name: "tall-mermaid.md", content: TALL_MERMAID_MD }]);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("tall-mermaid.md").click();
    await expect(page.locator(".markdown-viewer")).toBeVisible();
    await expect(page.locator(".viewer-toolbar").first()).toBeVisible();
    // Wait for the mermaid container to appear so we are exercising the
    // stacking-context-heavy DOM. We do not require the SVG to fully
    // render; the markdown body alone (≥ 4500 lines) is what makes the
    // page scrollable, and the mermaid wrapper is enough to introduce
    // additional stacking contexts above it. Embedded mermaid blocks
    // render through `MermaidView` whose root element has class
    // `.mermaid-view` (see src/components/viewers/MermaidView.tsx).
    await expect(page.locator(".mermaid-view").first()).toBeAttached();
    await assertStickyAtCheckpoints(page, "mermaid-md");
  });
});
