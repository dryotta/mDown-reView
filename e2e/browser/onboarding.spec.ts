import { test, expect } from "./fixtures";

declare global {
  interface Window {
    __TAURI_IPC_MOCK__?: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
    __DISPATCH_TAURI_EVENT__?: (event: string, payload: unknown) => void;
  }
}

/**
 * Onboarding wiring — Group D of issue #55.
 *
 * Verifies the bootstrap effect, Help-menu listeners, and Skip semantics
 * end-to-end against the IPC mock.
 */
test.describe("Onboarding (Group D)", () => {
  test("auto-welcome on first launch when onboarding_should_welcome=true", async ({ page }) => {
    await page.addInitScript(() => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") return { files: [], folders: [] };
        if (cmd === "onboarding_should_welcome") return true;
        if (cmd === "onboarding_state")
          return { schema_version: 1, last_welcomed_version: null, last_seen_sections: [] };
        return null;
      };
    });
    await page.goto("/");
    const dialog = page.getByRole("dialog", { name: "Welcome to mDown reView" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".onboarding-header h2")).toHaveText("Welcome to mDown reView");
  });

  test("Help → Welcome menu event opens the welcome panel", async ({ page }) => {
    await page.addInitScript(() => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") return { files: [], folders: [] };
        if (cmd === "onboarding_should_welcome") return false;
        if (cmd === "onboarding_state")
          return { schema_version: 1, last_welcomed_version: null, last_seen_sections: [] };
        return null;
      };
    });
    await page.goto("/");
    // Wait for bootstrap to settle (mock returns false → no panel yet).
    await expect(page.locator(".onboarding-overlay")).toHaveCount(0);

    await page.evaluate(() => {
      window.__DISPATCH_TAURI_EVENT__?.("menu-help-welcome", null);
    });

    await expect(page.getByRole("dialog", { name: "Welcome to mDown reView" })).toBeVisible();
  });

  test("Skip dismisses without writing version", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __MARK_WELCOMED_CALLS__: number }).__MARK_WELCOMED_CALLS__ = 0;
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") return { files: [], folders: [] };
        if (cmd === "onboarding_should_welcome") return true;
        if (cmd === "onboarding_state")
          return { schema_version: 1, last_welcomed_version: null, last_seen_sections: [] };
        if (cmd === "onboarding_mark_welcomed") {
          (window as unknown as { __MARK_WELCOMED_CALLS__: number }).__MARK_WELCOMED_CALLS__++;
          return null;
        }
        return null;
      };
    });
    await page.goto("/");
    await expect(page.getByRole("dialog", { name: "Welcome to mDown reView" })).toBeVisible();

    await page.getByRole("button", { name: "Skip for now" }).click();

    await expect(page.locator(".onboarding-overlay")).toHaveCount(0);
    const calls = await page.evaluate(
      () => (window as unknown as { __MARK_WELCOMED_CALLS__: number }).__MARK_WELCOMED_CALLS__,
    );
    expect(calls).toBe(0);
  });

  test("section status flips to Done after install action succeeds", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __CLI_DONE__: boolean }).__CLI_DONE__ = false;
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") return { files: [], folders: [] };
        if (cmd === "onboarding_should_welcome") return true;
        if (cmd === "onboarding_state")
          return { schema_version: 1, last_welcomed_version: null, last_seen_sections: [] };
        if (cmd === "cli_shim_status")
          return (window as unknown as { __CLI_DONE__: boolean }).__CLI_DONE__ ? "done" : "missing";
        if (cmd === "install_cli_shim") {
          (window as unknown as { __CLI_DONE__: boolean }).__CLI_DONE__ = true;
          return null;
        }
        return null;
      };
    });
    await page.goto("/");
    const dialog = page.getByRole("dialog", { name: "Welcome to mDown reView" });
    await expect(dialog).toBeVisible();

    // CLI section is the unique one with an "Install" button; use that anchor.
    const cliSection = dialog.locator(".section-shell", {
      hasText: "Command-line tool",
    });
    await expect(cliSection.getByTestId("section-status")).toHaveText("Not set up");

    await cliSection.getByRole("button", { name: "Install" }).click();
    await expect(cliSection.getByTestId("section-status")).toHaveText("Done");
  });

  test("re-trigger after a prior welcome shows 'What's new in v…' title", async ({ page }) => {
    await page.addInitScript(() => {
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") return { files: [], folders: [] };
        if (cmd === "onboarding_should_welcome") return true;
        if (cmd === "onboarding_state")
          return {
            schema_version: 1,
            last_welcomed_version: "0.3.3",
            last_seen_sections: [],
          };
        return null;
      };
    });
    await page.goto("/");
    const dialog = page.locator(".onboarding-overlay");
    await expect(dialog).toBeVisible();
    const title = dialog.locator(".onboarding-header h2");
    await expect(title).toContainText("What's new in v");
  });
});
