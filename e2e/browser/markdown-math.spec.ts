import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";
const MATH_FILE = `${FIXTURES_DIR}/math.md`;
const PLAIN_FILE = `${FIXTURES_DIR}/plain.md`;

const MATH_BODY =
  "# Math\n\nInline: $E=mc^2$\n\nBlock:\n\n$$\n\\int_0^1 x\\,dx\n$$\n";
const PLAIN_BODY = "# Plain\n\nNo math here. Just text and a `code` span.\n";

async function setupMocks(page: Page): Promise<void> {
  await page.addInitScript(
    ({
      dir,
      mathFile,
      plainFile,
      mathBody,
      plainBody,
    }: {
      dir: string;
      mathFile: string;
      plainFile: string;
      mathBody: string;
      plainBody: string;
    }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__TAURI_IPC_MOCK__ = async (cmd: string, args: unknown) => {
        if (cmd === "get_launch_args") return { files: [], folders: [dir] };
        if (cmd === "read_dir") {
          return [
            { name: "math.md", path: mathFile, is_dir: false },
            { name: "plain.md", path: plainFile, is_dir: false },
          ];
        }
        if (cmd === "read_text_file") {
          const a = args as { path?: string } | undefined;
          if (a?.path === mathFile) return mathBody;
          if (a?.path === plainFile) return plainBody;
          return "";
        }
        if (cmd === "load_review_comments") return null;
        if (cmd === "save_review_comments") return null;
        if (cmd === "check_path_exists") return "file";
        if (cmd === "get_log_path") return "/mock/log.log";
        if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
        return null;
      };
    },
    {
      dir: FIXTURES_DIR,
      mathFile: MATH_FILE,
      plainFile: PLAIN_FILE,
      mathBody: MATH_BODY,
      plainBody: PLAIN_BODY,
    },
  );
}

test.describe("MarkdownViewer KaTeX math (B3)", () => {
  test("KaTeX CSS is NOT loaded for a math-free document", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await setupMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("plain.md").click();
    await expect(page.locator(".markdown-body")).toBeVisible();
    await expect(page.locator(".markdown-body h1")).toContainText("Plain");

    // No KaTeX CSS link tag should have been injected.
    expect(await page.locator('link[data-katex-css="1"]').count()).toBe(0);
    // No KaTeX rendering should appear either.
    expect(await page.locator(".markdown-body .katex").count()).toBe(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("opening a math document renders .katex and lazy-loads the CSS", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await setupMocks(page);
    await page.goto("/");

    // Open a non-math file FIRST and confirm CSS is absent.
    await page.locator(".folder-tree").getByText("plain.md").click();
    await expect(page.locator(".markdown-body h1")).toContainText("Plain");
    expect(await page.locator('link[data-katex-css="1"]').count()).toBe(0);

    // Now open the math file. .katex must appear and the link tag must be
    // injected exactly once.
    await page.locator(".folder-tree").getByText("math.md").click();
    await expect(page.locator(".markdown-body .katex").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('link[data-katex-css="1"]')).toHaveCount(1);

    // Both inline and block math must render.
    expect(await page.locator(".markdown-body .katex").count()).toBeGreaterThanOrEqual(2);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
