import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// asset.localhost URLs are unreachable in browser-only tests (no Tauri shell);
// the iframe src fails with ERR_CONNECTION_REFUSED. Suppress from console-spy.
test.use({ consoleErrorAllowlist: ["Failed to load resource", "asset.localhost"] });

const FIXTURES_DIR = "/e2e/fixtures";

async function setupPdfMocks(page: Page) {
  await page.addInitScript((dir: string) => {
    window.__TAURI_IPC_MOCK__ = async (cmd: string, _args: Record<string, unknown>) => {
      if (cmd === "get_launch_args") return { files: [], folders: [dir] };
      if (cmd === "read_dir") {
        return [
          { name: "spec.pdf", path: `${dir}/spec.pdf`, is_dir: false },
        ];
      }
      if (cmd === "load_review_comments") return null;
      if (cmd === "check_path_exists") return "file";
      if (cmd === "get_log_path") return "/mock/log.log";
      if (cmd === "get_file_comments") return [];
      // PdfViewer streams via asset:// — no read_text_file / read_binary_file.
      // Returning null for any unexpected command surfaces accidental reads
      // as test failures (the wrappers throw on null where they expect data).
      return null;
    };
  }, FIXTURES_DIR);
}

test.describe("PDF viewer (#65 F3)", () => {
  test("opens .pdf in PdfViewer with sandboxed iframe", async ({ page }) => {
    await setupPdfMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("spec.pdf").click();

    const iframe = page.locator("iframe.pdf-viewer");
    await expect(iframe).toBeVisible();

    // Asset URL is built client-side by convertFileSrc — Windows uses
    // https://asset.localhost/<path>, other OSes use asset://localhost/<path>.
    // Either is acceptable as long as the encoded filename round-trips.
    const src = await iframe.getAttribute("src");
    expect(src).not.toBeNull();
    expect(src).toMatch(/asset[.:]/);
    expect(src).toContain(encodeURIComponent("spec.pdf"));

    // Empty `sandbox=""` strips ALL capabilities — no scripts, no forms.
    // Playwright surfaces an empty attribute as "".
    const sandbox = await iframe.getAttribute("sandbox");
    expect(sandbox).toBe("");

    // Title is set to the filename so screen readers announce it.
    await expect(iframe).toHaveAttribute("title", "spec.pdf");
  });
});
