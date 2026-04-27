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
      if (cmd === "get_file_comments") return { threads: [], sidecar_mtime_ms: null };
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
      // SettingsView mounts and refreshes onboarding statuses (B7).
      if (cmd === "cli_shim_status") return "missing";
      if (cmd === "default_handler_status") return "missing";
      if (cmd === "folder_context_status") return "missing";
      if (cmd === "onboarding_state")
        return { schema_version: 1, last_seen_sections: [] };
      return null;
    };
  }, { dir: FIXTURES_DIR });

  await page.goto("/");
  await expect(page.locator(".app-layout")).toBeVisible();

  // Open Settings via the native menu event (`menu-open-settings`), then
  // click the SettingsView footer link to mount the legacy author dialog —
  // post-#79 the dialog has its own `authorDialogOpen` flag (B1 forward-fix)
  // and is no longer auto-opened by `openSettings`.
  const openAuthorDialog = async () => {
    await page.evaluate(() => {
      (window as unknown as {
        __DISPATCH_TAURI_EVENT__?: (event: string, payload: unknown) => void;
      }).__DISPATCH_TAURI_EVENT__?.("menu-open-settings", null);
    });
    await page.getByRole("button", { name: /Author & preferences/i }).click();
  };
  await openAuthorDialog();
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

  // Re-open the author dialog via the same path — the input now reflects
  // the persisted value via `useAuthor` reading the Zustand cache.
  await openAuthorDialog();
  await expect(page.getByLabel("Display name")).toHaveValue("Reviewer-2");
});

