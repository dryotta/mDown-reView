// Issue #79 — Settings region (replaces the legacy onboarding modal flow).
//
// Verifies the four entry points (Welcome link, toolbar gear, menu event,
// and Esc-to-close) plus the per-row toggle success and failure paths.
//
// IPC mock pattern follows the conventions used in `comment-on-file.spec.ts`
// and `ux-overhaul.spec.ts`: install `window.__TAURI_IPC_MOCK__` via
// `addInitScript`, then drive events through `__DISPATCH_TAURI_EVENT__`.

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

declare global {
  interface Window {
    __TAURI_IPC_MOCK__?: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
    __DISPATCH_TAURI_EVENT__?: (event: string, payload: unknown) => void;
  }
}

/**
 * Default mock — empty workspace, all integrations missing, every action
 * resolves successfully. Tests that need bespoke behaviour (e.g. the
 * failure path) install their own mock via `addInitScript` BEFORE calling
 * this helper, and the helper here is then skipped.
 */
async function installDefaultMock(page: Page) {
  await page.addInitScript(() => {
    // The legacy `<SettingsDialog>` opens as a true modal via showModal(),
    // which marks every element outside the dialog (including SettingsView's
    // switches) as inert and intercepts pointer events. Demote it to a
    // non-modal dialog so the new region remains interactive in tests. The
    // legacy overlay is owned by another group and slated for removal.
    HTMLDialogElement.prototype.showModal = HTMLDialogElement.prototype.show;

    // Mutable per-page state so the success-path test sees the status flip
    // from "missing" → "done" after install_cli_shim resolves.
    const state = { cliShim: "missing" as "missing" | "done" };
    (window as unknown as { __SETTINGS_STATE__: typeof state }).__SETTINGS_STATE__ = state;

    // Tiny delay so Playwright can observe `aria-busy="true"` between the
    // click and the IPC resolve.
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
      if (cmd === "get_launch_args") return { files: [], folders: [] };
      if (cmd === "cli_shim_status") return state.cliShim;
      if (cmd === "default_handler_status") return "missing";
      if (cmd === "folder_context_status") return "missing";
      if (cmd === "onboarding_state")
        return { schema_version: 1, last_seen_sections: [] };
      if (cmd === "install_cli_shim") {
        await delay(150);
        state.cliShim = "done";
        return undefined;
      }
      if (cmd === "remove_cli_shim") {
        await delay(150);
        state.cliShim = "missing";
        return undefined;
      }
      if (cmd === "set_default_handler") {
        await delay(150);
        return undefined;
      }
      if (cmd === "register_folder_context" || cmd === "unregister_folder_context") {
        await delay(150);
        return undefined;
      }
      return null;
    };
  });
}

const settingsRegion = (page: Page) => page.getByRole("region", { name: "Settings" });
const settingsLink = (page: Page) => page.getByRole("button", { name: "→ Settings" });
const toolbarGear = (page: Page) => page.locator(".toolbar").getByRole("button", { name: "Settings" });
const cliSwitch = (page: Page) =>
  page.getByTestId("settings-row-cliShim").getByRole("switch", { name: "CLI shim" });

test.describe("Settings region (#79)", () => {
  test("WelcomeView shows Settings link that opens the Settings region", async ({ page }) => {
    await installDefaultMock(page);
    await page.goto("/");

    await expect(settingsLink(page)).toBeVisible();
    await settingsLink(page).click();
    await expect(settingsRegion(page)).toBeVisible();
  });

  test("Top toolbar gear opens the Settings region", async ({ page }) => {
    await installDefaultMock(page);
    await page.goto("/");

    await toolbarGear(page).click();
    await expect(settingsRegion(page)).toBeVisible();
  });

  test("menu-help-settings event opens the Settings region", async ({ page }) => {
    await installDefaultMock(page);
    await page.goto("/");
    // Sanity: not open yet.
    await expect(settingsRegion(page)).toHaveCount(0);

    await page.evaluate(() => {
      window.__DISPATCH_TAURI_EVENT__?.("menu-help-settings", null);
    });

    await expect(settingsRegion(page)).toBeVisible();
  });

  test("Esc closes the Settings region (returns to WelcomeView)", async ({ page }) => {
    await installDefaultMock(page);
    await page.goto("/");

    await toolbarGear(page).click();
    await expect(settingsRegion(page)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(settingsRegion(page)).toHaveCount(0);
    // Welcome surface is back.
    await expect(settingsLink(page)).toBeVisible();
  });

  test("Toggle success: CLI-shim switch shows aria-busy then aria-checked=true", async ({
    page,
  }) => {
    await installDefaultMock(page);
    await page.goto("/");
    await toolbarGear(page).click();

    const sw = cliSwitch(page);
    await expect(sw).toHaveAttribute("aria-checked", "false");

    // Click without awaiting the IPC resolve — the mock delays 150ms so we
    // can observe the in-flight state.
    await sw.click();
    await expect(sw).toHaveAttribute("aria-busy", "true");

    // After the install + status refresh settle.
    await expect(sw).toHaveAttribute("aria-busy", "false");
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("settings-row-error-cliShim")).toHaveCount(0);
  });

  test("Toggle failure: rejected IPC surfaces inline error and does not flip aria-checked", async ({
    page,
  }) => {
    // Override the default mock with one where install_cli_shim rejects.
    await page.addInitScript(() => {
      // See installDefaultMock for why we demote showModal → show.
      HTMLDialogElement.prototype.showModal = HTMLDialogElement.prototype.show;
      window.__TAURI_IPC_MOCK__ = async (cmd: string) => {
        if (cmd === "get_launch_args") return { files: [], folders: [] };
        if (cmd === "cli_shim_status") return "missing";
        if (cmd === "default_handler_status") return "missing";
        if (cmd === "folder_context_status") return "missing";
        if (cmd === "onboarding_state")
          return { schema_version: 1, last_seen_sections: [] };
        if (cmd === "install_cli_shim") {
          // Reject with a string — matches the Rust `Result<_, String>`
          // shape that the real bridge would deliver.
          throw "permission denied: /usr/local/bin/mdr";
        }
        return null;
      };
    });
    await page.goto("/");
    await toolbarGear(page).click();

    const sw = cliSwitch(page);
    await expect(sw).toHaveAttribute("aria-checked", "false");

    await sw.click();

    const errorRow = page.getByTestId("settings-row-error-cliShim");
    await expect(errorRow).toBeVisible();
    await expect(errorRow).toContainText("permission denied");
    await expect(sw).toHaveAttribute("aria-checked", "false");
  });
});
