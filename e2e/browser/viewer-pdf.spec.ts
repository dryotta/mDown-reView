import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// asset.localhost URLs are unreachable in browser-only tests (no Tauri shell);
// the iframe src fails with ERR_CONNECTION_REFUSED. Suppress from console-spy.
test.use({ consoleErrorAllowlist: ["Failed to load resource", "asset.localhost"] });

const FIXTURES_DIR = "/e2e/fixtures";

async function setupPdfMocks(page: Page) {
  await page.addInitScript((dir: string) => {
    window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "get_launch_args") return { files: [], folders: [dir] };
      if (cmd === "read_dir") {
        return {
          entries: [
            { name: "spec.pdf", path: `${dir}/spec.pdf`, is_dir: false },
          ],
          total: 1,
          has_more: false,
        };
      }
      if (cmd === "load_review_comments") return null;
      if (cmd === "check_path_exists") return "file";
      if (cmd === "get_log_path") return "/mock/log.log";
      if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
      if (cmd === "get_file_badges") return {};
      if (cmd === "scan_review_files") return [];
      if (cmd === "update_watched_files") return undefined;
      if (cmd === "update_tree_watched_dirs") return undefined;
      if (cmd === "canonicalize_path") return typeof args?.path === "string" ? args.path : "";
      if (cmd === "get_file_viewer_pref") return null;
      if (cmd === "set_file_viewer_pref") return undefined;
      if (cmd === "get_author") return "test-user";
      if (cmd === "stat_file") return { size_bytes: 1024, mtime_ms: null };
      if (cmd === "register_window_folder") return undefined;
      if (cmd === "unregister_window_folder") return undefined;
      if (cmd === "get_sidecar_config") return { enabled: false, sidecar_root: null, count_in_folder: 0, count_colocated: 0 };
      if (cmd === "check_update") return null;
      if (cmd === "onboarding_state") return { schema_version: 1, last_seen_sections: [] };
      if (cmd === "cli_shim_status" || cmd === "default_handler_status") return "missing";
      // PdfViewer streams via asset:// — no read_text_file / read_binary_file.
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

    // PdfViewer intentionally omits the sandbox attribute because the
    // Chromium built-in PDF renderer requires script execution + same-origin
    // access. The CSP still constrains the frame.
    const sandbox = await iframe.getAttribute("sandbox");
    expect(sandbox).toBeNull();

    // Title is set to the filename so screen readers announce it.
    await expect(iframe).toHaveAttribute("title", "spec.pdf");
  });
});
