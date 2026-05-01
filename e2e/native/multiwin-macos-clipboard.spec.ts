/**
 * Native E2E — On macOS, Cmd+C / Cmd+V / Cmd+X / Cmd+A in the
 * `<textarea>` of `CommentInput` MUST route through the native Edit
 * menu so WKWebView delivers the keystrokes to the focused input.
 *
 * Tests rules `mac-menu-edit-submenu` and
 * `mac-webview-clipboard-requires-edit-menu` in
 * docs/best-practices-common/tauri/macos-platform.md.
 *
 * Today's behaviour: the menu builder in `lib.rs` does not yet emit a
 * macOS Edit submenu (Section H5 of issue #315), so on Mac the
 * standard clipboard shortcuts can be swallowed by the native menu
 * system before they reach the textarea. This spec is platform-gated
 * and a documentation skeleton until H5 lands.
 */

import { test, expect } from "./fixtures";

test.describe("multiwin-macos-clipboard (E7)", () => {
  test.skip(process.platform !== "darwin", "macOS-only");
  test.skip(
    true,
    "FIXME: pending #315 Section H5 — native Edit submenu (undo/redo/cut/copy/paste/select_all) not yet built on macOS"
  );

  test("Cmd+C / Cmd+V in CommentInput uses the native Edit menu pipeline", async ({
    nativePage,
  }) => {
    // Future-state contract once H5 lands:
    //
    //  1. Open a markdown file and start a comment so a `<textarea>`
    //     in `.comment-input` is mounted and focused.
    //  2. Programmatically copy text via the system clipboard, then
    //     dispatch Cmd+V at the OS level (Playwright's
    //     keyboard.press('Meta+v')).
    //  3. Assert the textarea's value reflects the pasted content.
    //  4. Conversely, type text, select-all (Cmd+A), Cmd+C, then
    //     verify the clipboard contains the expected payload via a
    //     navigator.clipboard read.
    //
    //  5. The structural assertion is that the keystrokes work without
    //     any web-side clipboard polyfill — the fix is purely the
    //     native menu, never a JS workaround.

    const inputVisible = await nativePage.evaluate(() => {
      return document.querySelector(".comment-input textarea") !== null;
    });
    // Until H5 wires the menu, the assertion below is the contract,
    // not a passing test — the skip above keeps it inert.
    expect(inputVisible).toBe(true);
  });
});
