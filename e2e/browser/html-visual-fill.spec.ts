import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

/**
 * Install IPC mocks that serve a minimal HTML file and a markdown file
 * so we can test both visual viewers without needing real filesystem access.
 */
async function setupMocks(page: Page): Promise<void> {
  const htmlContent = `<!DOCTYPE html><html><body><h1>Hello</h1><p>World</p></body></html>`;
  const mdContent = `# Heading\n\nParagraph text.`;
  const htmlPath = `${FIXTURES_DIR}/page.html`;
  const mdPath = `${FIXTURES_DIR}/readme.md`;

  await page.addInitScript(
    ({ dir, hp, hc, mp, mc }: { dir: string; hp: string; hc: string; mp: string; mc: string }) => {
      (window as unknown as Record<string, unknown>).__TAURI_IPC_MOCK__ = async (
        cmd: string,
        args: Record<string, unknown>,
      ) => {
        if (cmd === "get_launch_args") return { files: [], folders: [dir] };
        if (cmd === "read_dir")
          return [
            { name: "page.html", path: hp, is_dir: false },
            { name: "readme.md", path: mp, is_dir: false },
          ];
        if (cmd === "read_text_file") {
          const p = (args as { path?: string }).path;
          if (p === hp) return hc;
          if (p === mp) return mc;
          return "";
        }
        if (cmd === "resolve_html_assets") return (args as { html?: string }).html ?? "";
        if (cmd === "load_review_comments") return null;
        if (cmd === "save_review_comments") return null;
        if (cmd === "get_log_path") return "/mock/log.log";
        if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
        return null;
      };
    },
    { dir: FIXTURES_DIR, hp: htmlPath, hc: htmlContent, mp: mdPath, mc: mdContent },
  );
}

test.describe("HTML visual view fills vertical space (#213)", () => {
  test("iframe bottom is flush with scroll region bottom", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/");

    // Open the HTML file and switch to Visual view.
    await page.locator(".folder-tree").getByText("page.html").click();
    await page.getByRole("button", { name: /visual/i }).click();

    const iframe = page.locator("iframe[title='HTML preview']");
    await expect(iframe).toBeVisible();

    // Measure bounding boxes of the scroll region and the iframe.
    const boxes = await page.evaluate(() => {
      const sr = document.querySelector(".viewer-scroll-region");
      const ifr = document.querySelector("iframe[title='HTML preview']");
      if (!sr || !ifr) return null;
      const srRect = sr.getBoundingClientRect();
      const ifrRect = ifr.getBoundingClientRect();
      return {
        scrollBottom: srRect.bottom,
        iframeBottom: ifrRect.bottom,
        scrollHeight: srRect.height,
        iframeHeight: ifrRect.height,
      };
    });

    expect(boxes).not.toBeNull();
    // The iframe bottom should be within 10px of the scroll region bottom.
    // A small gap is acceptable for the banner and toolbar.
    expect(Math.abs(boxes!.scrollBottom - boxes!.iframeBottom)).toBeLessThanOrEqual(10);
    // The iframe should have meaningful height (not collapsed).
    expect(boxes!.iframeHeight).toBeGreaterThan(100);
  });

  test("markdown visual viewer renders without errors", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/");

    // Open the markdown file — it defaults to visual view.
    await page.locator(".folder-tree").getByText("readme.md").click();

    // Verify the rendered markdown heading is visible.
    const heading = page.locator(".markdown-body h1");
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText(/Heading/);
  });
});
