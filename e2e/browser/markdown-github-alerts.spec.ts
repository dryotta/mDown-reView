import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";
const FILE = `${FIXTURES_DIR}/alerts.md`;

const MD_BODY = [
  "> [!NOTE]\n> Note body\n",
  "> [!TIP]\n> Tip body\n",
  "> [!IMPORTANT]\n> Important body\n",
  "> [!WARNING]\n> Warning body\n",
  "> [!CAUTION]\n> Caution body\n",
  "> Plain quote, not an alert\n",
].join("\n");

async function setupMocks(page: Page): Promise<void> {
  await page.addInitScript(
    ({ dir, file, body }: { dir: string; file: string; body: string }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") return { files: [], folders: [dir] };
        if (cmd === "read_dir") return [{ name: "alerts.md", path: file, is_dir: false }];
        if (cmd === "read_text_file") return body;
        if (cmd === "load_review_comments") return null;
        if (cmd === "save_review_comments") return null;
        if (cmd === "check_path_exists") return "file";
        if (cmd === "get_log_path") return "/mock/log.log";
        if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
        return null;
      };
    },
    { dir: FIXTURES_DIR, file: FILE, body: MD_BODY },
  );
}

test.describe("MarkdownViewer GitHub-style alerts (B1)", () => {
  test("renders all 5 alert kinds with class + title; leaves plain blockquote alone", async ({
    page,
  }) => {
    await setupMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("alerts.md").click();
    await expect(page.locator(".markdown-body")).toBeVisible();

    for (const kind of ["note", "tip", "important", "warning", "caution"] as const) {
      const alert = page.locator(`.markdown-body div.md-alert.md-alert-${kind}`);
      await expect(alert).toHaveCount(1);
      const title = alert.locator("p.md-alert-title");
      await expect(title).toHaveText(kind.charAt(0).toUpperCase() + kind.slice(1));
    }

    // Non-matching blockquote stays a <blockquote>, not an alert div.
    await expect(page.locator(".markdown-body blockquote")).toHaveCount(1);
    await expect(page.locator(".markdown-body blockquote")).toContainText(
      "Plain quote, not an alert",
    );
  });
});
