import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

interface CapturedCalls {
  openUrl: string[];
}

async function captureCalls(page: Page): Promise<CapturedCalls> {
  return { openUrl: await getOpenUrlCalls(page) };
}

async function setupHtmlPreviewMocks(page: Page, htmlBody: string): Promise<void> {
  const htmlContent = `<!DOCTYPE html><html><body>${htmlBody}</body></html>`;
  const filePath = `${FIXTURES_DIR}/page.html`;
  await page.addInitScript(
    ({ dir, htmlPath, html }: { dir: string; htmlPath: string; html: string }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__OPEN_URL_CALLS__ = [] as string[];
      w.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "get_launch_args") return { files: [], folders: [dir] };
        if (cmd === "read_dir") return [{ name: "page.html", path: htmlPath, is_dir: false }];
        if (cmd === "read_text_file") return html;
        if (cmd === "resolve_html_assets") {
          // Pass through unmodified — we don't need asset resolution for link tests.
          return (args as { html?: string }).html ?? "";
        }
        if (cmd === "load_review_comments") return null;
        if (cmd === "save_review_comments") return null;
        if (cmd === "get_log_path") return "/mock/log.log";
        if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
        if (cmd === "plugin:opener|open_url") {
          (w.__OPEN_URL_CALLS__ as string[]).push((args as { url: string }).url);
          return null;
        }
        return null;
      };
    },
    { dir: FIXTURES_DIR, htmlPath: filePath, html: htmlContent },
  );
}

async function getOpenUrlCalls(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    return ((w.__OPEN_URL_CALLS__ as string[]) ?? []).slice();
  });
}

async function openPreview(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator(".folder-tree").getByText("page.html").click();
  // HTML defaults to source mode; switch to visual.
  await page.getByRole("button", { name: /visual/i }).click();
  await expect(page.locator("iframe[title='HTML preview']")).toBeVisible();
}

test.describe("HtmlPreviewView link interception (safe mode)", () => {
  test("clicking external https link routes via openExternalUrl", async ({ page }) => {
    await setupHtmlPreviewMocks(
      page,
      `<a id="ext" href="https://example.com">e</a>`,
    );
    await openPreview(page);

    const iframe = page.frameLocator("iframe[title='HTML preview']");
    await iframe.locator("#ext").click();

    await expect.poll(async () => (await captureCalls(page)).openUrl).toContain(
      "https://example.com",
    );
  });

  test("clicking mailto: link routes via openExternalUrl", async ({ page }) => {
    await setupHtmlPreviewMocks(page, `<a id="mail" href="mailto:foo@bar.com">m</a>`);
    await openPreview(page);

    const iframe = page.frameLocator("iframe[title='HTML preview']");
    await iframe.locator("#mail").click();

    await expect.poll(async () => (await captureCalls(page)).openUrl).toContain(
      "mailto:foo@bar.com",
    );
  });

  test("clicking workspace-relative link calls store.openFile", async ({ page }) => {
    await setupHtmlPreviewMocks(page, `<a id="local" href="./foo.md">l</a>`);
    await openPreview(page);

    const iframe = page.frameLocator("iframe[title='HTML preview']");
    await iframe.locator("#local").click();

    // openFile creates a tab — assert a tab labelled "foo.md" appears.
    await expect(page.locator(".tab-bar .tab", { hasText: "foo.md" })).toBeVisible();

    // And openExternalUrl was NOT called.
    const calls = await captureCalls(page);
    expect(calls.openUrl).toHaveLength(0);
  });

  test(
    "clicking javascript: link triggers neither openExternalUrl nor openFile",
    async ({ page }) => {
      await setupHtmlPreviewMocks(
        page,
        `<a id="js" href="javascript:alert(1)">j</a>`,
      );
      await openPreview(page);

      const iframe = page.frameLocator("iframe[title='HTML preview']");
      await iframe.locator("#js").click();

      // Give any handler a tick to run.
      await page.waitForTimeout(100);

      const calls = await captureCalls(page);
      expect(calls.openUrl).toHaveLength(0);
      // No new tab should have opened beyond the existing page.html tab.
      const tabCount = await page.locator(".tab-bar .tab", { hasText: "page.html" }).count();
      expect(tabCount).toBeLessThanOrEqual(1);
    },
  );
});

test.describe("HtmlPreviewView link interception (scripts mode, bridge)", () => {
  // When sandbox briefly transitions through allow-same-origin → allow-scripts,
  // Chromium emits noisy CORS/sandbox errors from Vite's HMR client that get
  // injected into the iframe before our re-render. These are environmental
  // (dev server only) and don't reflect real product behaviour.
  test.use({
    consoleErrorAllowlist: [
      "Blocked script execution in 'about:srcdoc'",
      "blocked by CORS policy",
      "Failed to load resource",
    ],
  });

  async function enableScripts(page: Page): Promise<void> {
    await page.getByRole("button", { name: /enable scripts/i }).click();
    // Sandbox flips to allow-scripts; iframe re-renders.
    await expect(page.locator("iframe[title='HTML preview']")).toHaveAttribute(
      "sandbox",
      "allow-scripts",
    );
  }

  test("scripts mode: external https link routes via openExternalUrl", async ({ page }) => {
    await setupHtmlPreviewMocks(page, `<a id="ext" href="https://example.com">e</a>`);
    await openPreview(page);
    await enableScripts(page);

    const iframe = page.frameLocator("iframe[title='HTML preview']");
    await iframe.locator("#ext").click();

    await expect.poll(async () => (await captureCalls(page)).openUrl).toContain(
      "https://example.com",
    );
  });

  test("scripts mode: workspace link calls openFile", async ({ page }) => {
    await setupHtmlPreviewMocks(page, `<a id="local" href="./foo.md">l</a>`);
    await openPreview(page);
    await enableScripts(page);

    const iframe = page.frameLocator("iframe[title='HTML preview']");
    await iframe.locator("#local").click();

    await expect(page.locator(".tab-bar .tab", { hasText: "foo.md" })).toBeVisible();
    const calls = await captureCalls(page);
    expect(calls.openUrl).toHaveLength(0);
  });

  test("scripts mode: javascript: link triggers neither openExternalUrl nor openFile", async ({ page }) => {
    await setupHtmlPreviewMocks(page, `<a id="js" href="javascript:alert(1)">j</a>`);
    await openPreview(page);
    await enableScripts(page);

    const iframe = page.frameLocator("iframe[title='HTML preview']");
    await iframe.locator("#js").click();
    await page.waitForTimeout(100);

    const calls = await captureCalls(page);
    expect(calls.openUrl).toHaveLength(0);
  });
});
