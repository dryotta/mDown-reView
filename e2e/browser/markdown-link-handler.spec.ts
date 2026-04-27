import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";
const FILE = `${FIXTURES_DIR}/links.md`;

const MD_BODY = `# Links

- [ext](https://example.com)
- [local](./other.md)
- [bad](javascript:alert(1))
- [breakout](../../../../etc/passwd)
- [encoded](./My%20Doc.md)
`;

async function setupMocks(page: Page): Promise<void> {
  await page.addInitScript(
    ({ dir, file, body }: { dir: string; file: string; body: string }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__OPEN_URL_CALLS__ = [] as string[];
      w.__READ_FILE_CALLS__ = [] as string[];
      w.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "get_launch_args") return { files: [], folders: [dir] };
        if (cmd === "read_dir")
          return [
            { name: "links.md", path: file, is_dir: false },
            { name: "other.md", path: `${dir}/other.md`, is_dir: false },
            { name: "My Doc.md", path: `${dir}/My Doc.md`, is_dir: false },
          ];
        if (cmd === "read_text_file") {
          const path = (args as { path: string }).path;
          (w.__READ_FILE_CALLS__ as string[]).push(path);
          if (path === file) return body;
          return "# other\n";
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
    { dir: FIXTURES_DIR, file: FILE, body: MD_BODY },
  );
}

async function getOpenUrlCalls(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const w = window as unknown as { __OPEN_URL_CALLS__?: string[] };
    return (w.__OPEN_URL_CALLS__ ?? []).slice();
  });
}

async function getReadFileCalls(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const w = window as unknown as { __READ_FILE_CALLS__?: string[] };
    return (w.__READ_FILE_CALLS__ ?? []).slice();
  });
}

test.describe("MarkdownViewer link handler (A2)", () => {
  test("https click routes via openExternalUrl", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("links.md").click();
    await expect(page.locator(".markdown-body")).toBeVisible();

    await page.locator(".markdown-body a", { hasText: "ext" }).click();

    await expect.poll(() => getOpenUrlCalls(page)).toContain("https://example.com");
  });

  test("relative ./other.md click opens new tab via store.openFile", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("links.md").click();
    await expect(page.locator(".markdown-body")).toBeVisible();

    await page.locator(".markdown-body a", { hasText: "local" }).click();

    await expect(page.locator(".tab-bar .tab", { hasText: "other.md" })).toBeVisible();
    expect(await getOpenUrlCalls(page)).toHaveLength(0);
  });

  test("javascript: link triggers neither openExternalUrl nor openFile", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("links.md").click();
    await expect(page.locator(".markdown-body")).toBeVisible();
    const initialTabs = await page.locator(".tab-bar .tab").count();

    await page.locator(".markdown-body a", { hasText: "bad" }).click();
    await page.waitForTimeout(100);

    expect(await getOpenUrlCalls(page)).toHaveLength(0);
    expect(await page.locator(".tab-bar .tab").count()).toBe(initialTabs);
  });

  test("workspace-escape `../../../../etc/passwd` link is dropped (no openFile)", async ({
    page,
  }) => {
    await setupMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("links.md").click();
    await expect(page.locator(".markdown-body")).toBeVisible();
    const initialTabs = await page.locator(".tab-bar .tab").count();
    const callsBefore = (await getReadFileCalls(page)).length;

    await page.locator(".markdown-body a", { hasText: "breakout" }).click();
    await page.waitForTimeout(100);

    expect(await page.locator(".tab-bar .tab").count()).toBe(initialTabs);
    expect(await getOpenUrlCalls(page)).toHaveLength(0);
    const after = await getReadFileCalls(page);
    // No new read_text_file call should have been issued for /etc/passwd.
    expect(after.slice(callsBefore).some((p) => p.includes("/etc/passwd"))).toBe(false);
  });

  test("URL-encoded relative link `./My%20Doc.md` opens the decoded path", async ({
    page,
  }) => {
    await setupMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("links.md").click();
    await expect(page.locator(".markdown-body")).toBeVisible();

    await page.locator(".markdown-body a", { hasText: "encoded" }).click();

    await expect(
      page.locator(".tab-bar .tab", { hasText: "My Doc.md" }),
    ).toBeVisible();
    // openFile must have been called with the decoded path, NOT the raw href.
    const reads = await getReadFileCalls(page);
    expect(reads.some((p) => p.endsWith("/My Doc.md"))).toBe(true);
    expect(reads.some((p) => p.includes("%20"))).toBe(false);
  });
});
