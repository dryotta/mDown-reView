import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

const FILE_CONTENTS: Record<string, string> = {
  "page.html": "<!doctype html><html><head><title>z</title></head><body><h1>Hello</h1><p>World</p></body></html>",
};

async function setupMocks(page: Page) {
  await page.addInitScript(({ dir, contents }: { dir: string; contents: Record<string, string> }) => {
    window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "get_launch_args") return { files: [], folders: [dir] };
      if (cmd === "read_dir") {
        return Object.keys(contents).map((name) => ({ name, path: `${dir}/${name}`, is_dir: false }));
      }
      if (cmd === "read_text_file") {
        const path = (args as { path: string }).path;
        const name = path.split("/").pop() ?? "";
        return contents[name] ?? "";
      }
      if (cmd === "resolve_html_assets") {
        // Frontend passes the html as the first arg; pass it through unchanged.
        return (args as { html?: string }).html ?? "";
      }
      if (cmd === "load_review_comments") return null;
      if (cmd === "save_review_comments") return null;
      if (cmd === "check_path_exists") return "file";
      if (cmd === "get_log_path") return "/mock/log.log";
      if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
      if (cmd === "get_file_viewer_pref") return null;
      if (cmd === "set_file_viewer_pref") return null;
      return null;
    };
  }, { dir: FIXTURES_DIR, contents: FILE_CONTENTS });
}

// Read the `zoom` CSS property the production code sets via
// `documentElement.style.setProperty("zoom", ...)`. Returned as a string —
// `""` when unset, otherwise the numeric factor.
async function iframeZoom(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const iframe = document.querySelector(
      "iframe[title='HTML preview']",
    ) as HTMLIFrameElement | null;
    if (!iframe || !iframe.contentDocument) {
      throw new Error("HTML preview iframe not found or contentDocument null");
    }
    return iframe.contentDocument.documentElement.style.getPropertyValue("zoom");
  });
}

test.describe("HtmlPreviewView zoom (#157 — iframe content actually scales)", () => {
  test("Ctrl+= raises iframe `zoom`, Ctrl+0 resets to 1", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/");

    await page.locator(".folder-tree").getByText("page.html").click();
    await expect(page.locator("iframe[title='HTML preview']")).toBeVisible({ timeout: 10000 });

    // Baseline — production code applies `zoom = "1"` immediately on mount.
    await expect.poll(async () => await iframeZoom(page)).toBe("1");

    // Two zoom-in steps — must raise the numeric value above 1.
    await page.keyboard.press("Control+=");
    await page.keyboard.press("Control+=");
    await expect.poll(async () => parseFloat(await iframeZoom(page))).toBeGreaterThan(1);
    const grown = parseFloat(await iframeZoom(page));

    // One zoom-out step — strictly smaller than the two-step zoomed value.
    await page.keyboard.press("Control+-");
    await expect.poll(async () => parseFloat(await iframeZoom(page))).toBeLessThan(grown);

    // Reset — back to exactly 1.
    await page.keyboard.press("Control+0");
    await expect.poll(async () => await iframeZoom(page)).toBe("1");
  });
});
