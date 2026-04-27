import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";
const FILE = `${FIXTURES_DIR}/remote.md`;

const MD_BODY = `# Remote\n\n![alt](https://example.com/x.png)\n`;

async function setupMocks(page: Page): Promise<void> {
  await page.addInitScript(
    ({ dir, file, body }: { dir: string; file: string; body: string }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__FETCH_REMOTE_CALLS__ = [] as string[];
      w.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "get_launch_args") return { files: [], folders: [dir] };
        if (cmd === "read_dir") return [{ name: "remote.md", path: file, is_dir: false }];
        if (cmd === "read_text_file") return body;
        if (cmd === "load_review_comments") return null;
        if (cmd === "save_review_comments") return null;
        if (cmd === "get_log_path") return "/mock/log.log";
        if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
        if (cmd === "fetch_remote_asset") {
          (w.__FETCH_REMOTE_CALLS__ as string[]).push((args as { url: string }).url);
          // 1×1 transparent PNG
          const png = new Uint8Array([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
            0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
            0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
            0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
            0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
            0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
          ]);
          // Wire format: [u32 BE: ct_len][ct_bytes][payload]
          const ct = new TextEncoder().encode("image/png");
          const buf = new ArrayBuffer(4 + ct.byteLength + png.byteLength);
          const view = new DataView(buf);
          view.setUint32(0, ct.byteLength, false);
          new Uint8Array(buf, 4, ct.byteLength).set(ct);
          new Uint8Array(buf, 4 + ct.byteLength).set(png);
          return buf;
        }
        return null;
      };
    },
    { dir: FIXTURES_DIR, file: FILE, body: MD_BODY },
  );
}

test.describe("MarkdownViewer remote-image gating (A1)", () => {
  test("remote https image is blocked by default and banner becomes Allow → blob URL renders", async ({
    page,
  }) => {
    await setupMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("remote.md").click();

    // Placeholder shown; banner present.
    await expect(page.locator("[data-remote-image-placeholder]")).toBeVisible();
    const banner = page.getByRole("button", {
      name: /allow remote images for this document/i,
    });
    await expect(banner).toBeVisible();

    // Allow.
    await banner.click();

    // Mock recorded a call and an <img> with a blob URL appears.
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            ((window as unknown as { __FETCH_REMOTE_CALLS__?: string[] })
              .__FETCH_REMOTE_CALLS__ ?? []).slice(),
        ),
      )
      .toContain("https://example.com/x.png");
    const img = page.locator(".markdown-body img").first();
    await expect(img).toBeVisible();
    const src = await img.getAttribute("src");
    expect(src ?? "").toMatch(/^blob:/);
  });
});
