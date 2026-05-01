/**
 * Native E2E — On macOS, closing the last window MUST hide it (not
 * quit), and clicking the Dock icon (Reopen) MUST show it again.
 *
 * Tests rules `mac-lifecycle-close-hides` and
 * `mac-lifecycle-reopen-on-activate` in
 * docs/best-practices-common/tauri/macos-platform.md.
 *
 * Today's behaviour: the `RunEvent::WindowEvent` handler does not yet
 * intercept `CloseRequested` on macOS to call `api.prevent_close()` +
 * `window.hide()`, and `RunEvent::Reopen` is not yet wired to a
 * show+focus path (Section H5 of issue #315). This spec is
 * platform-gated and a documentation skeleton until H5 lands.
 */

import { test, expect } from "./fixtures";

test.describe("multiwin-macos-close-hides (E8)", () => {
  test.skip(process.platform !== "darwin", "macOS-only");
  test.skip(
    true,
    "FIXME: pending #315 Section H5 — close-hides interceptor and Reopen handler not yet implemented on macOS"
  );

  test("closing the last window hides it; Dock-icon Reopen brings it back", async ({
    nativePage,
  }) => {
    // Future-state contract once H5 lands:
    //
    //  1. With exactly one window open, simulate the user clicking
    //     the close (red traffic light) button.
    //  2. Assert the window is hidden, NOT destroyed:
    //       - The Tauri process is still running.
    //       - The window's Rust-side handle (`get_webview_window`) is
    //         still resolvable; only `is_visible()` flips to false.
    //       - The registry entry for the window remains (close-hides
    //         is not a destroy event).
    //  3. Simulate `RunEvent::Reopen { has_visible_windows: false }`
    //     (Dock-icon click). The window must `show()` and
    //     `set_focus()`.
    //  4. Cmd+Q is the only path that should call `app.exit(0)`; this
    //     test must not exit the app to remain idempotent across runs.

    const label = await nativePage.evaluate(() => {
      // @ts-ignore — Tauri internals
      return window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label as string | undefined;
    });
    // Inert under the skip above; the contract is documented in the
    // step-list comments rather than asserted today.
    expect(typeof label).toBe("string");
  });
});
