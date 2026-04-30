import { readFileSync } from "node:fs";
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { getRenderCounts, assertWithinBaseline } from "./helpers/render-counts";

const baselines = JSON.parse(
  readFileSync("e2e/browser/fixtures/render-baselines.json", "utf8"),
);

/**
 * Bootstraps with a 100KB markdown file (and its containing folder) via
 * launch-args. The flow: useLaunchArgsBootstrap → setRoot + openFile →
 * FolderTree mounts, ViewerRouter mounts MarkdownViewer which calls
 * read_text_file (mocked to return 100KB). End state measured after the
 * first H2 of the rendered markdown is visible.
 */
async function installFileMock(page: Page, content: string) {
  await page.addInitScript((c: string) => {
    window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "get_launch_args")
        return {
          files: ["/test-workspace/large.md"],
          folders: ["/test-workspace"],
        };
      if (cmd === "read_dir") {
        const p = (args as { path: string }).path;
        if (p === "/test-workspace") {
          return {
            entries: [
              { name: "large.md", path: "/test-workspace/large.md", is_dir: false },
            ],
            total: 1,
            has_more: false,
          };
        }
        return { entries: [], total: 0, has_more: false };
      }
      if (cmd === "check_path_exists") {
        const p = (args as { path: string }).path;
        return p === "/test-workspace" ? "directory" : "file";
      }
      if (cmd === "read_text_file") {
        return {
          content: c,
          size_bytes: new TextEncoder().encode(c).length,
          line_count: c.split("\n").length,
        };
      }
      if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
      return null;
    };
  }, content);
}

function build100kb(): string {
  const sections: string[] = [];
  for (let i = 0; i < 30; i++) {
    sections.push(
      `## Section ${i}\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.\n\n\`\`\`ts\nconst x: number = ${i};\n\`\`\`\n\n`,
    );
  }
  let s = sections.join("");
  while (s.length < 100_000) s += sections.join("");
  return s.slice(0, 100_000);
}

test.describe("render counts — open file 100KB md (AC3 / #298)", () => {
  test("open-file render counts ≤ baseline", async ({ page }) => {
    const content = build100kb();
    await installFileMock(page, content);
    await page.goto("/");

    // Settled signal: the markdown viewer rendered at least one H2 from
    // the 100KB document. Shiki highlight is async — give it a beat.
    await expect(page.locator(".markdown-viewer h2").first()).toBeVisible({
      timeout: 10_000,
    });
    await page.waitForTimeout(250);

    const counts = await getRenderCounts(page);
    // eslint-disable-next-line no-console
    console.log("[open-file counts]", JSON.stringify(counts));
    assertWithinBaseline(counts, baselines.openFile100kb, "openFile100kb");
  });
});
