import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

// Each entry: [filename, extension, viewer selector for the zoom root]
// HTML uses an iframe — zoom applies to the wrapper but content is isolated.
// Mermaid uses transform:scale, not font-size zoom — excluded per issue #157.
// KQL zoom was added in this PR (useZoom in KqlPlanView) and verified by unit
// test; the e2e test is deferred because the mock IPC doesn't populate the
// KQL operator-table path that renders .kql-plan-container with content.
const VIEWERS = [
  ["doc.md", ".md", ".markdown-viewer"],
  ["data.json", ".json", ".json-tree"],
  ["data.csv", ".csv", ".csv-table-container"],
] as const;

const FILE_CONTENTS: Record<string, string> = {
  "doc.md": "# Heading\n\nSome **bold** text and `inline code`.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n",
  "data.json": '{"name": "test", "items": [1, 2, 3]}',
  "data.csv": "name,value\nalpha,1\nbeta,2\ngamma,3",
  "page.html": "<html><body><h1>Hello</h1><p>World</p></body></html>",
  "query.kql": "StormEvents\n| where State == 'TEXAS'\n| summarize count() by EventType\n| order by count_ desc\n| take 5",
};

async function setupMocks(page: Page, files: string[]) {
  await page.addInitScript(({ dir, fileList, contents }: {
    dir: string;
    fileList: string[];
    contents: Record<string, string>;
  }) => {
    window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "get_launch_args") return { files: [], folders: [dir] };
      if (cmd === "read_dir")
        return fileList.map(name => ({
          name,
          path: `${dir}/${name}`,
          is_dir: false,
        }));
      if (cmd === "read_text_file") {
        const path = (args as { path: string }).path;
        const name = path.split("/").pop() ?? "";
        return contents[name] ?? "";
      }
      if (cmd === "load_review_comments") return null;
      if (cmd === "save_review_comments") return null;
      if (cmd === "check_path_exists") return "file";
      if (cmd === "get_log_path") return "/mock/log.log";
      if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
      return null;
    };
  }, { dir: FIXTURES_DIR, fileList: files, contents: FILE_CONTENTS });
}

async function fontSize(page: Page, selector: string): Promise<number> {
  return await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error(`element not found: ${sel}`);
    return parseFloat(getComputedStyle(el).fontSize);
  }, selector);
}

test.describe("Zoom all viewers (#157 AC1)", () => {
  for (const [filename, _ext, selector] of VIEWERS) {
    test(`${filename}: Ctrl+= grows font, Ctrl+- shrinks, Ctrl+0 resets`, async ({ page }) => {
      const files = Object.keys(FILE_CONTENTS);
      await setupMocks(page, files);
      await page.goto("/");

      // Open the file
      await page.locator(".folder-tree").getByText(filename).click();
      await expect(page.locator(selector)).toBeVisible({ timeout: 10000 });

      const baseline = await fontSize(page, selector);
      expect(baseline).toBeGreaterThan(0);

      // Two zoom-in steps (×1.1 each → ~×1.21)
      await page.keyboard.press("Control+=");
      await page.keyboard.press("Control+=");
      await expect
        .poll(async () => await fontSize(page, selector))
        .toBeGreaterThan(baseline * 1.15);
      const grown = await fontSize(page, selector);

      // One zoom-out step → smaller than the two-step zoomed value
      await page.keyboard.press("Control+-");
      await expect
        .poll(async () => await fontSize(page, selector))
        .toBeLessThan(grown);

      // Reset → back to baseline
      await page.keyboard.press("Control+0");
      await expect
        .poll(async () => await fontSize(page, selector))
        .toBeCloseTo(baseline, 0);
    });
  }
});
