import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = "/e2e/fixtures";

/**
 * G4 — verifies the ViewerToolbar reveal/open buttons dispatch the correct
 * IPC commands. The test mock records every invoke call so we can assert
 * the exact `(cmd, args)` pair was sent for each button click.
 */
async function setupToolbarMocks(page: Page) {
  await page.addInitScript((dir: string) => {
    (window as unknown as { __IPC_CALLS__: Array<[string, unknown]> }).__IPC_CALLS__ = [];
    window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
      (window as unknown as { __IPC_CALLS__: Array<[string, unknown]> }).__IPC_CALLS__.push([
        cmd,
        args,
      ]);
      if (cmd === "get_launch_args") return { files: [], folders: [dir] };
      if (cmd === "read_dir") {
        return [
          { name: "doc.md", path: `${dir}/doc.md`, is_dir: false },
          { name: "pic.png", path: `${dir}/pic.png`, is_dir: false },
        ];
      }
      if (cmd === "read_text_file") return "# Doc\n\nbody.";
      if (cmd === "load_review_comments") return null;
      if (cmd === "check_path_exists") return "file";
      if (cmd === "get_log_path") return "/mock/log.log";
      if (cmd === "get_file_comments") return [];
      if (cmd === "reveal_in_folder") return undefined;
      if (cmd === "open_in_default_app") return undefined;
      return null;
    };
  }, FIXTURES_DIR);
}

async function getCalls(page: Page): Promise<Array<[string, unknown]>> {
  return await page.evaluate(
    () => (window as unknown as { __IPC_CALLS__: Array<[string, unknown]> }).__IPC_CALLS__,
  );
}

test.describe("Viewer toolbar reveal/open actions (#65 G4)", () => {
  test("reveal + open buttons dispatch IPC for markdown viewer (EnhancedViewer toolbar)", async ({
    page,
  }) => {
    await setupToolbarMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("doc.md").click();
    await expect(page.locator(".markdown-viewer")).toBeVisible();

    await page.getByRole("button", { name: /reveal in folder/i }).first().click();
    await page.getByRole("button", { name: /open in default app/i }).first().click();

    const calls = await getCalls(page);
    const reveal = calls.find(
      ([c, a]) =>
        c === "reveal_in_folder" && (a as { path?: string }).path === `${FIXTURES_DIR}/doc.md`,
    );
    const open = calls.find(
      ([c, a]) =>
        c === "open_in_default_app" && (a as { path?: string }).path === `${FIXTURES_DIR}/doc.md`,
    );
    expect(reveal, "reveal_in_folder IPC was not invoked with the active path").toBeTruthy();
    expect(open, "open_in_default_app IPC was not invoked with the active path").toBeTruthy();
  });

  test("reveal + open buttons appear and dispatch IPC for image viewer (wrapped toolbar)", async ({
    page,
  }) => {
    await setupToolbarMocks(page);
    await page.goto("/");
    await page.locator(".folder-tree").getByText("pic.png").click();
    await expect(page.locator(".image-viewer")).toBeVisible();

    await page.getByRole("button", { name: /reveal in folder/i }).first().click();
    await page.getByRole("button", { name: /open in default app/i }).first().click();

    const calls = await getCalls(page);
    const reveal = calls.find(
      ([c, a]) =>
        c === "reveal_in_folder" && (a as { path?: string }).path === `${FIXTURES_DIR}/pic.png`,
    );
    const open = calls.find(
      ([c, a]) =>
        c === "open_in_default_app" && (a as { path?: string }).path === `${FIXTURES_DIR}/pic.png`,
    );
    expect(reveal, "reveal_in_folder IPC was not invoked for image viewer").toBeTruthy();
    expect(open, "open_in_default_app IPC was not invoked for image viewer").toBeTruthy();
  });
});
