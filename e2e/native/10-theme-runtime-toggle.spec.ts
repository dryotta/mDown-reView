import { test, expect } from "./fixtures";

/**
 * Native E2E regression test for the runtime theme-toggle bug family.
 *
 * Closes the test-coverage round-2 outstanding gap (Finding 4) — the
 * unit tests cover the helper functions in isolation (theme_to_tauri
 * mapping, ThemeApplier mock dispatch) but no spec drove the **real
 * binary** through the `set_theme` IPC and asserted its persistence +
 * error contract.
 *
 * **Scope of this spec — what it CAN assert from CDP**:
 *
 *   1. The IPC succeeds for every valid pref value (`light`/`dark`/`system`).
 *   2. The pref is persisted (visible via the `onboarding_state` IPC).
 *   3. The IPC rejects garbage with the typed `InvalidTheme` error.
 *
 * **Scope of this spec — what it CANNOT assert**:
 *
 *   - The renderer's `<html data-theme>` attribute. The Rust
 *     `set_theme` IPC writes disk and mutates native chrome but DOES
 *     NOT update Zustand directly — that's the renderer-side
 *     `useThemePref::setTheme` hook's job. Invoking the IPC via
 *     `window.__TAURI_INTERNALS__.invoke(...)` bypasses the renderer
 *     state machine. Renderer-side propagation is covered by the
 *     vitest test
 *     `src/hooks/__tests__/useCrossWindowPrefsSync.test.ts`, which
 *     mounts both `useCrossWindowPrefsSync` and `useApplyTheme` and
 *     asserts `<html data-theme>` updates on a synthetic storage
 *     event.
 *
 *   - The Win32 native chrome bits (DWM title bar / muda HMENU / popup
 *     `SetPreferredAppMode`). Those live in OS-owned resources
 *     outside the WebView2 surface; verifying them would require
 *     Win32 introspection (`DwmGetWindowAttribute`, `GetWindowTheme`)
 *     which Playwright cannot drive. Source-text guards in
 *     `src/__tests__/main-window-menu-at-build-time.test.ts` cover
 *     the structural call chain (`apply_theme_to_window` invoked
 *     post-build, AFTER `app.set_menu` on macOS).
 *
 * What this spec UNIQUELY catches:
 *
 *   - A regression where the `set_theme` IPC fails / panics under the
 *     real Tauri runtime (the unit tests use a mock applier).
 *   - A regression where `set_theme` no longer persists (e.g. someone
 *     reorders the body so `dispatch_set_theme` runs before
 *     `set_theme_at` and the latter fails silently).
 *   - A regression where the `InvalidTheme` typed error stops
 *     surfacing through the IPC boundary (renderer error-handling
 *     contract).
 */
test.describe("Theme runtime toggle (native)", () => {
  test("10.1 - set_theme IPC persists each valid pref to onboarding.json", async ({
    nativePage,
  }) => {
    // Flip through every valid value and verify each is persisted.
    // The loop ends on "system" (the cold-start default) so subsequent
    // specs in the same run see a clean persisted state.
    for (const theme of ["dark", "light", "system"] as const) {
      await nativePage.evaluate((t: string) => {
        // @ts-ignore — Tauri internals injected by the runtime.
        return window.__TAURI_INTERNALS__.invoke("set_theme", { theme: t });
      }, theme);

      const persisted: { theme?: string | null } = await nativePage.evaluate(
        () => {
          // @ts-ignore
          return window.__TAURI_INTERNALS__.invoke("onboarding_state");
        },
      );
      expect(persisted.theme, `theme=${theme} round-trip`).toBe(theme);
    }
  });

  test("10.2 - set_theme IPC rejects garbage with InvalidTheme error", async ({
    nativePage,
  }) => {
    // The closed-enum validator in `commands::config::set_theme_at`
    // rejects anything outside `{system, light, dark}`. Verify the
    // typed error surfaces over IPC so the renderer can branch on
    // `kind === "InvalidTheme"` (vs a stringified parse error).
    const rejection = await nativePage.evaluate(() => {
      // @ts-ignore
      return window.__TAURI_INTERNALS__
        .invoke("set_theme", { theme: "auto" })
        .then(() => ({ ok: true }))
        .catch((err: unknown) => ({ ok: false, err }));
    });

    expect(rejection.ok).toBe(false);
    // ConfigError is a `#[serde(tag = "kind")]` discriminated union —
    // the renderer branches on `kind === "InvalidTheme"`.
    expect(JSON.stringify(rejection.err)).toContain("InvalidTheme");
  });
});
