// Issue #252 — iter 2: SourceView virtualization regression test.
//
// jsdom can't validate that virtualisation actually engaged in the real
// rendering pipeline (the `SourceView` component test mocks viewport
// dimensions via the opt-in `installVirtualizerViewportShim` helper).
// This browser-level Playwright spec opens a 50K-line synthetic file and
// asserts only a viewport-bounded slice of `.source-line` rows mounts.
//
// Per `docs/test-strategy.md`, this is the layer that can prove the
// claim: real layout + real ResizeObserver + real `@tanstack/react-virtual`
// scroll observation.

import { test, expect } from "./fixtures";

const FIXTURES_DIR = "/e2e/fixtures";

const HUGE_TS = Array.from(
  { length: 50_000 },
  (_, i) =>
    `// line ${i + 1}: const value_${i + 1} = ${i + 1}; // padding so the row is wide enough`,
).join("\n");

test("source-virtualisation — opens a 50K-line file and only mounts a viewport-bounded row window (#252)", async ({
  page,
}) => {
  test.slow();

  const dir = FIXTURES_DIR;
  const filePath = `${dir}/huge.ts`;
  await page.addInitScript(
    ({ d, p, content }) => {
      window.__TAURI_IPC_MOCK__ = async (
        cmd: string,
        args: Record<string, unknown>,
      ) => {
        if (cmd === "get_launch_args") return { files: [], folders: [d] };
        if (cmd === "read_dir")
          return [{ name: "huge.ts", path: p, is_dir: false }];
        if (cmd === "read_text_file") {
          const path = (args as { path: string }).path;
          if (path === p)
            return { content, size_bytes: content.length, line_count: 50_000 };
          return { content: "", size_bytes: 0, line_count: 0 };
        }
        if (cmd === "load_review_comments") return null;
        if (cmd === "save_review_comments") return null;
        if (cmd === "check_path_exists") return "file";
        if (cmd === "get_log_path") return "/mock/log.log";
        if (cmd === "get_file_comments")
          return { threads: [], sidecar_mtime_ms: null };
        if (cmd === "get_file_badges") return [];
        if (cmd === "scan_review_files") return [];
        if (cmd === "update_watched_files") return undefined;
        return null;
      };
    },
    { d: dir, p: filePath, content: HUGE_TS },
  );

  await page.goto("/");
  await page.locator(".folder-tree").getByText("huge.ts").click();
  await expect(page.locator(".source-view")).toBeVisible({ timeout: 30_000 });
  // Wait for the virtualiser to mount its first batch.
  await expect(page.locator(".source-line").first()).toBeVisible({
    timeout: 30_000,
  });

  const renderedRows = await page.locator(".source-line").count();

  // Sanity: rendered window must be far less than 50,000 — proves
  // virtualisation engaged. A non-virtualised regression would mount all
  // 50,000 rows; the viewport + overscan should bound the count well
  // under 500 even on a tall display.
  expect(renderedRows).toBeLessThan(500);
  // And it must be > 0 so we know the viewer actually rendered.
  expect(renderedRows).toBeGreaterThan(0);
});
