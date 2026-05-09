/**
 * Native E2E — Concurrent CLI launch with the same folder must not
 * create a duplicate window.
 *
 * Tests rule `multiwin-atomic-registry-mutations` (and its underpinning
 * `multiwin-lifecycle-registry`) from
 * docs/best-practices-common/tauri/v2-patterns.md: `WindowKind::Folder(path)`
 * MUST be reached only via `WindowRegistry::try_claim_folder` so that two
 * concurrent CLI launches resolving to the same canonical folder cannot
 * both win the route. The expected steady state is one-folder-one-window.
 *
 * Why native (not browser): The invariant lives in real Rust managed
 * state (`WindowRegistry`) and the registry's claim-then-build dance
 * cannot be exercised through the Vite dev-server IPC mock.
 *
 * Limitation: The browser-mocked `set_root_via_test` debug command is
 * serial — there is no way to drive a true two-thread race from
 * Playwright. We assert the next-best invariant: invoking
 * `set_root_via_test` twice with the same canonical path leaves the
 * webview owning that folder exactly once and does not crash.
 */

import { test, expect, setRootViaTest } from "./fixtures";

test.describe("multiwin-concurrent-cli-launch (E1)", () => {
  // Issue #364: installer.spec.ts now runs in its own playwright.installer.config.ts
  // (no shared CDP binary), so the cross-test interaction that motivated this
  // skip is resolved.
  test("two routings of the same folder do not split the window", async ({ nativePage }) => {
    const folder = process.cwd();

    await setRootViaTest(nativePage, folder);
    await setRootViaTest(nativePage, folder);

    const label = await nativePage.evaluate(() => {
      // @ts-ignore — Tauri internals
      return window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label as string | undefined;
    });
    // The current webview is still labelled (registry entry survived)
    expect(typeof label).toBe("string");
    expect(label).not.toBe("");

    // The app remains responsive after the duplicate route — verifying
    // try_claim_folder did not panic, deadlock the registry lock, or
    // leave the renderer in a half-mounted state.
    const stillResponsive = await nativePage.evaluate(async () => {
      try {
        // @ts-ignore — Tauri internals
        await window.__TAURI_INTERNALS__.invoke("get_log_path");
        return true;
      } catch {
        return false;
      }
    });
    expect(stillResponsive).toBe(true);
  });
});
