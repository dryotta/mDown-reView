/**
 * Browser e2e test for syntax highlighting (#181).
 *
 * Verifies that TypeScript tokens render with non-default colors in
 * source view and markdown fenced code blocks. Runs in a real Chromium
 * browser with real CSS and real Shiki — catches CSS override and Shiki
 * loading issues that unit tests with jsdom/mocks cannot.
 */
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

async function setupSourceViewMock(page: Page) {
  const tsContent = [
    "import { invoke } from '@tauri-apps/api/core';",
    "",
    "const greeting: string = 'hello world';",
    "",
    "export async function fetchData(): Promise<string> {",
    "  return await invoke('read_text_file', { path: '/test.txt' });",
    "}",
  ].join("\n");

  await page.addInitScript(
    ({ dir, content }: { dir: string; content: string }) => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "get_launch_args")
          return { files: [], folders: [dir] };
        if (cmd === "read_dir")
          return [{ name: "example.ts", path: `${dir}/example.ts`, is_dir: false }];
        if (cmd === "read_text_file") return content;
        if (cmd === "load_review_comments") return null;
        if (cmd === "save_review_comments") return null;
        if (cmd === "get_log_path") return "/mock/log.log";
        if (cmd === "get_file_comments")
          return { threads: [], sidecar_mtime_ms: null };
        return null;
      };
    },
    { dir: FIXTURES_DIR, content: tsContent },
  );
}

async function setupMarkdownViewMock(page: Page) {
  const mdContent = [
    "# Hello World",
    "",
    "Some text before code.",
    "",
    "```typescript",
    "const x: number = 42;",
    "function greet(name: string): string {",
    "  return `Hello, ${name}!`;",
    "}",
    "```",
    "",
    "Some text after code.",
  ].join("\n");

  await page.addInitScript(
    ({ dir, content }: { dir: string; content: string }) => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "get_launch_args")
          return { files: [], folders: [dir] };
        if (cmd === "read_dir")
          return [{ name: "example.md", path: `${dir}/example.md`, is_dir: false }];
        if (cmd === "read_text_file") return content;
        if (cmd === "load_review_comments") return null;
        if (cmd === "save_review_comments") return null;
        if (cmd === "get_log_path") return "/mock/log.log";
        if (cmd === "get_file_comments")
          return { threads: [], sidecar_mtime_ms: null };
        return null;
      };
    },
    { dir: FIXTURES_DIR, content: mdContent },
  );
}

test.describe("Source view syntax highlighting (#181)", () => {
  test("TypeScript tokens render with non-default colors", async ({ page }) => {
    await setupSourceViewMock(page);
    await page.goto("/");

    // Click on the file in the tree
    await page.locator(".folder-tree").getByText("example.ts").click();

    // Wait for the source view to appear and Shiki to highlight
    const sourceLines = page.locator(".source-line-content");
    await expect(sourceLines.first()).toBeVisible();

    // Wait for Shiki highlighting to complete
    await page.waitForTimeout(2000);

    // Check that at least one source line contains a span with a color style
    const coloredSpans = page.locator(
      '.source-line-content span[style*="color:#"]',
    );

    const count = await coloredSpans.count();
    expect(count).toBeGreaterThan(0);

    // Verify that not ALL spans have the same color
    const colors = new Set<string>();
    for (let i = 0; i < Math.min(count, 20); i++) {
      const style = await coloredSpans.nth(i).getAttribute("style");
      if (style) {
        const match = style.match(/color:\s*(#[0-9a-fA-F]{3,8})/);
        if (match) colors.add(match[1].toLowerCase());
      }
    }

    // Shiki should produce at least 2 distinct colors
    expect(
      colors.size,
      `Expected multiple distinct token colors but found: ${[...colors].join(", ")}`,
    ).toBeGreaterThanOrEqual(2);
  });
});

test.describe("Markdown fenced code block highlighting (#181)", () => {
  test("fenced TypeScript block renders with Shiki CSS variables", async ({ page }) => {
    await setupMarkdownViewMock(page);
    await page.goto("/");

    // Click on the markdown file
    await page.locator(".folder-tree").getByText("example.md").click();

    // Wait for the markdown viewer and Shiki highlighting to load
    await expect(page.locator(".markdown-body")).toBeVisible();

    // Wait for HighlightedCode to load language and render
    await page.waitForTimeout(3000);

    // Shiki renders a <pre class="shiki"> with spans using CSS variables
    const shikiPre = page.locator("pre.shiki");
    await expect(shikiPre).toBeVisible({ timeout: 10000 });

    // Verify token spans have Shiki CSS variables
    const tokenSpans = page.locator(
      'pre.shiki span.line span[style*="--shiki-light"]',
    );
    const count = await tokenSpans.count();
    expect(count).toBeGreaterThan(0);

    // Verify multiple distinct colors via CSS variables
    const colors = new Set<string>();
    for (let i = 0; i < Math.min(count, 20); i++) {
      const style = await tokenSpans.nth(i).getAttribute("style");
      if (style) {
        const match = style.match(/--shiki-light:\s*(#[0-9a-fA-F]{3,8})/);
        if (match) colors.add(match[1].toLowerCase());
      }
    }

    expect(
      colors.size,
      `Expected multiple distinct Shiki colors but found: ${[...colors].join(", ")}`,
    ).toBeGreaterThanOrEqual(2);
  });
});
