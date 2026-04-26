// Browser-only spec — DOM geometry assertions require a real layout engine
// (jsdom cannot compute scrollWidth / clientWidth). Mirrors the rationale and
// scaffolding in e2e/browser/markdown-overflow-wrap.spec.ts (#91), but exercises
// the comments panel cascade added for #150.
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";
const FILE = `${FIXTURES_DIR}/sample.md`;

const FILE_BODY = "# Comment overflow wrap fixture (#150)\n";

// 200 / 300 a-z chars, no whitespace and no slash — single unbreakable tokens.
const LONG_INLINE = "a".repeat(200);
const LONG_FENCED = "b".repeat(300);
const LONG_CELL = "c".repeat(200);

const COMMENT_TEXT = [
  "Long inline path: `" + LONG_INLINE + "`",
  "",
  "```bash",
  LONG_FENCED,
  "```",
  "",
  "| header | value |",
  "|---|---|",
  "| x | " + LONG_CELL + " |",
  "",
].join("\n");

const VIEWPORTS = [600, 900, 1280, 1920] as const;

interface SetupArgs {
  dir: string;
  file: string;
  body: string;
  comment: string;
}

async function setupMocks(page: Page): Promise<void> {
  await page.addInitScript(
    ({ dir, file, body, comment }: SetupArgs) => {
      const w = window as unknown as Record<string, unknown>;
      const thread = {
        root: {
          id: "c-1",
          author: "Tester",
          timestamp: "2025-01-01T00:00:00.000Z",
          text: comment,
          resolved: false,
          line: 1,
          anchor_kind: "line",
          matchedLineNumber: 1,
          isOrphaned: false,
        },
        replies: [],
      };
      w.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") return { files: [], folders: [dir] };
        if (cmd === "read_dir") return [{ name: "sample.md", path: file, is_dir: false }];
        if (cmd === "read_text_file") return body;
        if (cmd === "stat_file") return { size_bytes: body.length };
        if (cmd === "load_review_comments") {
          return {
            mrsf_version: "1.1",
            document: "sample.md",
            comments: [
              {
                id: "c-1",
                author: "Tester",
                timestamp: "2025-01-01T00:00:00.000Z",
                text: comment,
                resolved: false,
                line: 1,
                anchor_kind: "line",
              },
            ],
          };
        }
        if (cmd === "save_review_comments") return null;
        if (cmd === "get_file_comments") return [thread];
        if (cmd === "get_file_badges") return {};
        if (cmd === "check_path_exists") return "file";
        if (cmd === "get_log_path") return "/mock/log.log";
        if (cmd === "compute_anchor_hash") return "deadbeef";
        return null;
      };
      // Pre-seed the persisted UI store: tiny folder pane, comments panel
      // visible at a realistic 360 px width. Matches the persist key/version
      // used by markdown-overflow-wrap.spec.ts (Zustand persist v1).
      try {
        localStorage.setItem(
          "mdownreview-ui",
          JSON.stringify({
            state: {
              folderPaneWidth: 80,
              commentsPaneVisible: true,
              commentsPaneWidth: 360,
            },
            version: 1,
          }),
        );
      } catch {
        // best effort
      }
    },
    { dir: FIXTURES_DIR, file: FILE, body: FILE_BODY, comment: COMMENT_TEXT },
  );
}

async function flushLayout(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test.describe("CommentsPanel overflow wrap (#150)", () => {
  for (const width of VIEWPORTS) {
    test(`long tokens in comment body do not overflow page or panel at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await setupMocks(page);
      await page.goto("/");
      await page.locator(".folder-tree").getByText("sample.md").click();
      await expect(page.locator(".comment-text").first()).toBeVisible();
      await flushLayout(page);

      const measurements = await page.evaluate(() => {
        const doc = document.scrollingElement as HTMLElement;
        const body = document.querySelector(".comment-text") as HTMLElement;
        const pre = document.querySelector(".comment-text pre") as HTMLElement | null;
        return {
          docScroll: doc.scrollWidth,
          docClient: doc.clientWidth,
          bodyScroll: body.scrollWidth,
          bodyClient: body.clientWidth,
          preScroll: pre?.scrollWidth ?? 0,
          preClient: pre?.clientWidth ?? 0,
        };
      });

      // 1. Page (document) must not scroll horizontally.
      expect(measurements.docScroll - measurements.docClient).toBeLessThanOrEqual(1);
      // 2. The .comment-text container must not overflow its own client box
      //    (would indicate the long inline `code` or wide table cell pushed
      //    the panel sideways).
      expect(measurements.bodyScroll - measurements.bodyClient).toBeLessThanOrEqual(1);
      // 3. The fenced <pre> kept its internal horizontal scroll — proves the
      //    `.comment-text pre / pre code` reset works (otherwise the long
      //    fenced line would wrap and preScroll would equal preClient).
      expect(measurements.preScroll).toBeGreaterThan(measurements.preClient);
    });
  }
});
