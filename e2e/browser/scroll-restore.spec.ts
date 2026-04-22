import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

/** Helper to find and interact with the scrollable container above a viewer element */
function scrollableContainerScript(viewerSelector: string) {
  return `
    (function() {
      const el = document.querySelector('${viewerSelector}');
      if (!el) return null;
      let parent = el.parentElement;
      while (parent) {
        const style = getComputedStyle(parent);
        const canScroll = style.overflowY === 'auto' || style.overflowY === 'scroll'
          || style.overflow === 'auto' || style.overflow === 'scroll';
        if (canScroll && parent.scrollHeight > parent.clientHeight + 10) return parent;
        parent = parent.parentElement;
      }
      return null;
    })()
  `;
}

async function setupScrollMocks(page: Page, files: { name: string; content: string; ext?: string }[]) {
  await page.addInitScript(({ dir, files }: { dir: string; files: { name: string; content: string }[] }) => {
    const fileMap: Record<string, string> = {};
    const dirEntries = files.map((f) => {
      const path = `${dir}/${f.name}`;
      fileMap[path] = f.content;
      return { name: f.name, path, is_dir: false };
    });

    window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "get_launch_args") return { files: [], folders: [dir] };
      if (cmd === "read_dir") return dirEntries;
      if (cmd === "read_text_file") {
        const path = (args as { path: string }).path;
        return fileMap[path] ?? "// empty";
      }
      if (cmd === "load_review_comments") return null;
      if (cmd === "save_review_comments") return null;
      if (cmd === "check_path_exists") return "file";
      if (cmd === "get_log_path") return "/mock/log.log";
      return null;
    };
  }, { dir: FIXTURES_DIR, files });
}

// Generate content long enough to overflow the viewport
const longSourceContent = Array.from({ length: 500 }, (_, i) =>
  `// Line ${i}: This is a long source file with enough content to overflow the viewport`
).join("\n");

const longMarkdownContent = Array.from({ length: 300 }, (_, i) =>
  `## Heading ${i}\n\nParagraph ${i} with enough text to take up vertical space.\n`
).join("\n");

const shortContent = "// Short file\nconst x = 1;\n";

test.describe("Scroll Restore", () => {
  test("scroll position restored for source files when switching tabs", async ({ page }) => {
    await setupScrollMocks(page, [
      { name: "long.ts", content: longSourceContent },
      { name: "short.ts", content: shortContent },
    ]);
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();

    // Open the long source file
    await page.locator(".folder-tree").getByText("long.ts").click();
    await expect(page.locator(".source-view")).toBeVisible();
    await page.waitForTimeout(500);

    // Scroll down via the scrollable container
    const scrolled = await page.evaluate(() => {
      const el = document.querySelector(".source-view");
      if (!el) return 0;
      let parent = el.parentElement;
      while (parent) {
        const style = getComputedStyle(parent);
        if ((style.overflowY === "auto" || style.overflow === "auto") &&
            parent.scrollHeight > parent.clientHeight + 10) {
          parent.scrollTo(0, 300);
          return parent.scrollTop;
        }
        parent = parent.parentElement;
      }
      return 0;
    });
    test.skip(scrolled === 0, "No scrollable container found");

    await page.waitForTimeout(300);

    // Switch to another file
    await page.locator(".folder-tree").getByText("short.ts").click();
    await page.waitForTimeout(300);

    // Switch back
    await page.locator(".tab-bar").getByText("long.ts").click();
    await page.waitForTimeout(800);

    // Verify scroll was restored
    const scrollAfter = await page.evaluate(() => {
      const el = document.querySelector(".source-view");
      if (!el) return 0;
      let parent = el.parentElement;
      while (parent) {
        const style = getComputedStyle(parent);
        if ((style.overflowY === "auto" || style.overflow === "auto") &&
            parent.scrollHeight > parent.clientHeight + 10) {
          return parent.scrollTop;
        }
        parent = parent.parentElement;
      }
      return 0;
    });
    expect(scrollAfter).toBeGreaterThan(0);
  });

  test("scroll position restored for markdown files when switching tabs", async ({ page }) => {
    await setupScrollMocks(page, [
      { name: "long.md", content: longMarkdownContent },
      { name: "short.ts", content: shortContent },
    ]);
    await page.goto("/");
    await expect(page.locator(".app-layout")).toBeVisible();

    // Open the long markdown file
    await page.locator(".folder-tree").getByText("long.md").click();
    await expect(page.locator(".markdown-viewer")).toBeVisible();
    await page.waitForTimeout(500);

    // Scroll down via the scrollable container (should be ViewerRouter's div, not .markdown-viewer itself)
    const scrolled = await page.evaluate(() => {
      const el = document.querySelector(".markdown-viewer");
      if (!el) return 0;
      let parent = el.parentElement;
      while (parent) {
        const style = getComputedStyle(parent);
        if ((style.overflowY === "auto" || style.overflow === "auto") &&
            parent.scrollHeight > parent.clientHeight + 10) {
          parent.scrollTo(0, 300);
          return parent.scrollTop;
        }
        parent = parent.parentElement;
      }
      return 0;
    });
    test.skip(scrolled === 0, "No scrollable container found for markdown");

    await page.waitForTimeout(300);

    // Switch to another file
    await page.locator(".folder-tree").getByText("short.ts").click();
    await page.waitForTimeout(300);

    // Switch back
    await page.locator(".tab-bar").getByText("long.md").click();
    await page.waitForTimeout(800);

    // Verify scroll was restored
    const scrollAfter = await page.evaluate(() => {
      const el = document.querySelector(".markdown-viewer");
      if (!el) return 0;
      let parent = el.parentElement;
      while (parent) {
        const style = getComputedStyle(parent);
        if ((style.overflowY === "auto" || style.overflow === "auto") &&
            parent.scrollHeight > parent.clientHeight + 10) {
          return parent.scrollTop;
        }
        parent = parent.parentElement;
      }
      return 0;
    });
    expect(scrollAfter).toBeGreaterThan(0);
  });
});
