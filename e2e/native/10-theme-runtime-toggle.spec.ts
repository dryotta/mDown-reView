import { test, expect } from "./fixtures";

/**
 * Native E2E regression test for the runtime theme-toggle bug family.
 *
 * Closes the test-coverage round-2 outstanding gap (`Finding 4`) — the
 * Round-1 unit tests cover the helper functions in isolation
 * (theme_to_tauri mapping, ThemeApplier mock dispatch) but no spec
 * drives the **real binary** through the `set_theme` IPC and asserts:
 *
 *   1. The pref is persisted (visible via `onboarding_state` IPC).
 *   2. The renderer's `<html data-theme>` updates.
 *   3. A second `set_theme` flips both back.
 *
 * **Limitation acknowledged**: This spec CANNOT assert the native
 * chrome colour (Win32 DWM title bar / Win32 HMENU / Win32 popup
 * `SetPreferredAppMode`) via CDP. Those bits live in OS-owned
 * resources outside the WebView2 surface; verifying them would
 * require Win32 introspection (`DwmGetWindowAttribute`,
 * `GetWindowTheme`) which Playwright cannot drive. Round-1 source-text
 * guards in `src/__tests__/main-window-menu-at-build-time.test.ts`
 * cover the structural call chain (`apply_theme_to_window` is invoked
 * post-build, AFTER `app.set_menu` on macOS). Manual QA verifies the
 * visual outcome.
 *
 * What this spec UNIQUELY catches:
 *
 *   - A regression where the `set_theme` IPC fails / panics under the
 *     real Tauri runtime (the unit tests use a mock applier).
 *   - A regression where `set_theme` no longer persists (e.g. someone
 *     reorders the body so `dispatch_set_theme` runs before
 *     `set_theme_at` and the latter fails silently).
 *   - A regression where `useApplyTheme` no longer reacts to Zustand
 *     theme changes triggered by IPC round-trip.
 */
test.describe("Theme runtime toggle (native)", () => {
  test("10.1 - set_theme IPC persists pref and updates data-theme end-to-end", async ({
    nativePage,
  }) => {
    // 1. Flip to dark via IPC.
    await nativePage.evaluate(() => {
      // @ts-ignore — Tauri internals injected by the runtime.
      return window.__TAURI_INTERNALS__.invoke("set_theme", { theme: "dark" });
    });

    // 2. Read back from disk via the onboarding_state IPC.
    const persistedDark: { theme?: string | null } = await nativePage.evaluate(
      () => {
        // @ts-ignore
        return window.__TAURI_INTERNALS__.invoke("onboarding_state");
      },
    );
    expect(persistedDark.theme).toBe("dark");

    // 3. Renderer's <html data-theme> should reflect the change. The
    //    IPC round-trip + Zustand setState + useApplyTheme effect all
    //    happen on the next microtask — poll briefly to avoid race.
    await expect
      .poll(
        () =>
          nativePage.evaluate(() =>
            document.documentElement.getAttribute("data-theme"),
          ),
        { timeout: 5_000, intervals: [50, 100, 200] },
      )
      .toBe("dark");

    // 4. Flip back to light. The fix's load-bearing line (iterating
    //    webview_windows and calling per-window WebviewWindow::set_theme)
    //    runs again inside the Tauri runtime. If a regression broke
    //    that path (e.g. reverted to AppHandle::set_theme), the native
    //    chrome would freeze, but disk + data-theme would still update
    //    — this spec would still pass. The source-text guards cover
    //    the structural shape; this spec covers the IPC liveness.
    await nativePage.evaluate(() => {
      // @ts-ignore
      return window.__TAURI_INTERNALS__.invoke("set_theme", { theme: "light" });
    });

    const persistedLight: { theme?: string | null } = await nativePage.evaluate(
      () => {
        // @ts-ignore
        return window.__TAURI_INTERNALS__.invoke("onboarding_state");
      },
    );
    expect(persistedLight.theme).toBe("light");

    await expect
      .poll(
        () =>
          nativePage.evaluate(() =>
            document.documentElement.getAttribute("data-theme"),
          ),
        { timeout: 5_000, intervals: [50, 100, 200] },
      )
      .toBe("light");

    // 5. Flip to system mode. The IPC must accept it (closed-enum
    //    validator in `commands::config::set_theme_at`) and the
    //    renderer's useApplyTheme must defer to
    //    matchMedia("(prefers-color-scheme: dark)") rather than the
    //    persisted pref.
    await nativePage.evaluate(() => {
      // @ts-ignore
      return window.__TAURI_INTERNALS__.invoke("set_theme", { theme: "system" });
    });

    const persistedSystem: { theme?: string | null } = await nativePage.evaluate(
      () => {
        // @ts-ignore
        return window.__TAURI_INTERNALS__.invoke("onboarding_state");
      },
    );
    expect(persistedSystem.theme).toBe("system");

    // Cleanup: restore default ("system") for subsequent specs that
    // assume a clean state. (Already done above — this comment
    // documents the intent.)
  });

  test("10.2 - set_theme IPC rejects garbage with InvalidTheme error", async ({
    nativePage,
  }) => {
    // The closed-enum validator in `commands::config::set_theme_at`
    // rejects anything outside `{system, light, dark}`. Verify the
    // typed error surfaces over IPC so the renderer can show a
    // meaningful message (vs a stringified JSON parse error).
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
