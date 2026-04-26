// Browser-only spec — DOM geometry assertions require a real layout engine
// (jsdom cannot compute scrollWidth / clientWidth). Mirrors the rationale in
// e2e/browser/viewer-toolbar-sticky.spec.ts.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_BODY = readFileSync(
  join(__dirname, "fixtures/markdown-overflow-wrap/sample.md"),
  "utf8",
);

const FIXTURES_DIR = "/e2e/fixtures";
const FILE = `${FIXTURES_DIR}/overflow.md`;

const VIEWPORTS = [600, 900, 1280, 1920] as const;

async function setupMocks(page: Page): Promise<void> {
  await page.addInitScript(
    ({ dir, file, body }: { dir: string; file: string; body: string }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") return { files: [], folders: [dir] };
        if (cmd === "read_dir") return [{ name: "overflow.md", path: file, is_dir: false }];
        if (cmd === "read_text_file") return body;
        if (cmd === "load_review_comments") return null;
        if (cmd === "save_review_comments") return null;
        if (cmd === "check_path_exists") return "file";
        if (cmd === "get_log_path") return "/mock/log.log";
        if (cmd === "get_file_comments") return [];
        return null;
      };
    },
    { dir: FIXTURES_DIR, file: FILE, body: FIXTURE_BODY },
  );
}

async function flushLayout(page: Page): Promise<void> {
  // Two RAFs guarantee styles + layout have flushed after a viewport change.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test.describe("MarkdownViewer overflow wrap (#91)", () => {
  for (const width of VIEWPORTS) {
    test(`long inline tokens do not overflow page or container at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await setupMocks(page);
      await page.goto("/");
      await page.locator(".folder-tree").getByText("overflow.md").click();
      await expect(page.locator(".markdown-body")).toBeVisible();
      await flushLayout(page);

      const measurements = await page.evaluate(() => {
        const doc = document.scrollingElement as HTMLElement;
        const body = document.querySelector(".markdown-body") as HTMLElement;
        const pre = document.querySelector(".markdown-body pre") as HTMLElement | null;
        return {
          docScroll: doc.scrollWidth,
          docClient: doc.clientWidth,
          bodyScroll: body.scrollWidth,
          bodyClient: body.clientWidth,
          preScroll: pre?.scrollWidth ?? 0,
          preClient: pre?.clientWidth ?? 0,
        };
      });

      // 1. Page (document) must not scroll horizontally.
      expect(Math.abs(measurements.docScroll - measurements.docClient)).toBeLessThanOrEqual(1);
      // 2. The markdown container itself must not overflow its own client box.
      expect(Math.abs(measurements.bodyScroll - measurements.bodyClient)).toBeLessThanOrEqual(1);
      // 3. The fenced <pre> kept its internal horizontal scroll (long no-space
      //    line was not broken — proves the `pre`/`pre code` reset works).
      expect(measurements.preScroll).toBeGreaterThan(measurements.preClient);
    });
  }
});
