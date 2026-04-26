import { test, expect } from "./fixtures";

const FIXTURES_DIR = "/e2e/fixtures";

/**
 * AC #71/F7 — Author identity end-to-end.
 *
 * Open Settings → set display name → Save. We assert two contracts:
 *  1. The `set_author` IPC chokepoint received the trimmed value the
 *     user typed (this is the boundary that connects the UI to the
 *     persisted `OnboardingState.author`).
 *  2. Re-opening Settings shows the new value, proving `useAuthor`
 *     hydrated the Zustand cache from the (now-updated) `get_author`
 *     return — the same cache `useCommentActions` reads synchronously
 *     when stamping new comments.
 *
 * The end-to-end "author flows into add_comment payload" link is
 * covered by the `useCommentActions` unit test, which mocks the same
 * `useStore` selector this dialog writes to.
 */
test("author identity round-trips through set_author / get_author", async ({ page }) => {
  await page.addInitScript(({ dir }: { dir: string }) => {
    interface SetAuthorArgs {
      name: string;
    }
    (window as Record<string, unknown>).__SET_AUTHOR_CALLS__ = [] as SetAuthorArgs[];
    let savedAuthor = "OS-Default-User";

    window.__TAURI_IPC_MOCK__ = async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "get_launch_args") return { files: [], folders: [dir] };
      if (cmd === "read_dir")
        return [{ name: "sample.md", path: `${dir}/sample.md`, is_dir: false }];
      if (cmd === "read_text_file") return "# Heading\n";
      if (cmd === "get_file_comments") return [];
      if (cmd === "get_author") return savedAuthor;
      if (cmd === "set_author") {
        const name = String((args as { name: string }).name).trim();
        ((window as Record<string, unknown>).__SET_AUTHOR_CALLS__ as SetAuthorArgs[]).push({
          name,
        });
        savedAuthor = name;
        return name;
      }
      if (cmd === "check_path_exists") return "file";
      if (cmd === "get_log_path") return "/mock/log.log";
      return null;
    };
  }, { dir: FIXTURES_DIR });

  await page.goto("/");
  await expect(page.locator(".app-layout")).toBeVisible();

  // Open Settings and verify the OS-user fallback is pre-filled (proving
  // the launch-time `useAuthor` hydration ran).
  await page.getByRole("button", { name: "Open settings" }).click();
  const input = page.getByLabel("Display name");
  await expect(input).toBeVisible();
  await expect(input).toHaveValue("OS-Default-User");

  // Edit + Save.
  await input.fill("Reviewer-2");
  await page.getByRole("button", { name: "Save" }).click();

  // Dialog closes on success.
  await expect(input).not.toBeVisible();

  // The IPC chokepoint received the trimmed value.
  await expect.poll(async () =>
    page.evaluate(() => (window as Record<string, unknown>).__SET_AUTHOR_CALLS__),
  ).toEqual([{ name: "Reviewer-2" }]);

  // Re-open Settings — the input now reflects the persisted value via
  // `useAuthor` reading the Zustand cache that was updated on save.
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByLabel("Display name")).toHaveValue("Reviewer-2");
});

