/**
 * Regression test for the cold-start menu-area flicker fix.
 *
 * The bug: `tauri.conf.json` previously declared `app.windows[0]` with no
 * menu. Tauri's runtime auto-created and showed the window before `setup()`
 * ran, then `setup()` called `Window::set_menu()` to attach the per-window
 * menu post-show. On Windows, attaching a native HMENU to a visible window
 * shrinks the WebView2 client rect by the menu-bar height, firing `WM_SIZE`
 * and a viewport-driven React re-render — visible to the user as a tiny
 * flicker in the menu area at launch.
 *
 * The fix: `app.windows` in `tauri.conf.json` is now empty. The main window
 * is built programmatically in `src-tauri/src/lib.rs::build_main_window`
 * with `.menu(menu)` set BEFORE `.build()`, so the HMENU is attached during
 * window creation and the WebView2 client rect never reflows post-show.
 *
 * This test guards both halves of that invariant. A regression that puts
 * the window back into config (Tauri auto-creates → no-menu first frame)
 * or replaces the builder's `.menu()` with a post-build `set_menu()` call
 * would re-introduce the flicker silently — pixel-level oracles are flake-
 * prone for cold-start timing on Windows, so we assert the structural
 * pre-condition instead.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll } from "vitest";

describe("main window — menu attached at build time (cold-start flicker fix)", () => {
  const repoRoot = resolve(__dirname, "..", "..");

  describe("tauri.conf.json::app.windows[]", () => {
    let config: { app?: { windows?: unknown[] } };

    beforeAll(() => {
      const raw = readFileSync(resolve(repoRoot, "src-tauri", "tauri.conf.json"), "utf-8");
      config = JSON.parse(raw) as typeof config;
    });

    it("is empty so Tauri does not auto-create a window before setup() runs", () => {
      // A non-empty `windows[]` here means the runtime would auto-create
      // the window before `setup()` could attach a menu, re-introducing
      // the post-show menu-attach reflow this fix eliminated.
      expect(Array.isArray(config.app?.windows)).toBe(true);
      expect(config.app?.windows).toHaveLength(0);
    });
  });

  describe("src-tauri/src/lib.rs::build_main_window", () => {
    let libRs: string;

    beforeAll(() => {
      // Normalize CRLF → LF so regexes that anchor on `\n` work uniformly
      // regardless of git's autocrlf checkout setting on contributor machines.
      libRs = readFileSync(resolve(repoRoot, "src-tauri", "src", "lib.rs"), "utf-8").replace(
        /\r\n/g,
        "\n"
      );
    });

    /** Return the body text of `fn build_main_window` (header through the
     *  matching closing `}`), or `null` if the function is missing. */
    const buildMainBody = (): string | null => {
      const startIdx = libRs.indexOf("fn build_main_window");
      if (startIdx === -1) return null;
      // Find the first `\n}\n` after the start — every other `}` in the
      // function body is indented, so a column-0 `}` reliably terminates.
      const endIdx = libRs.indexOf("\n}\n", startIdx);
      if (endIdx === -1) return null;
      return libRs.slice(startIdx, endIdx + 3);
    };

    it("exists and is the canonical main-window factory", () => {
      expect(libRs).toMatch(/fn build_main_window\s*\(/);
    });

    it("attaches the menu via the builder's .menu() call BEFORE .build()", () => {
      // The function attaches the menu at builder time; if a future change
      // moves the menu to a post-build `set_menu()` call, the `.menu(...)`
      // line disappears and this assertion fails fast.
      const body = buildMainBody();
      expect(body, "build_main_window function body").not.toBeNull();

      // `.menu(menu)` must appear, AND must come before `.build()`.
      const menuIdx = body!.indexOf(".menu(");
      const buildIdx = body!.indexOf(".build()");
      expect(menuIdx, ".menu() must be present in the builder chain").toBeGreaterThan(-1);
      expect(buildIdx, ".build() must be present in the builder chain").toBeGreaterThan(-1);
      expect(menuIdx).toBeLessThan(buildIdx);
    });

    it("does NOT call Window::set_menu on the main window post-creation", () => {
      // The bug was `main_win.set_menu(...)` (i.e. `Window::set_menu`) on a
      // visible window — that's what shrunk the WebView2 client rect by the
      // menu-bar height and caused the flicker. macOS legitimately needs
      // `app.set_menu(...)` (the AppHandle method) because the macOS menu
      // bar is global; that's NOT the bug pattern (macOS does not exhibit
      // the HMENU client-rect shrink, and the menu is OS-rendered above the
      // window frame anyway). This test allows `app.set_menu(` and flags
      // any other `<receiver>.set_menu(` form — those would all be calls
      // on a Window/WebviewWindow value, i.e. the original bug pattern.
      const allSetMenu = libRs.match(/\w+\.set_menu\s*\(/g) ?? [];
      const offenders = allSetMenu.filter((s) => !/^app\.set_menu/.test(s));
      expect(
        offenders,
        "lib.rs must not call Window::set_menu — that re-introduces the post-show menu-attach reflow. Only `app.set_menu(...)` (AppHandle, macOS-only path) is permitted."
      ).toEqual([]);
    });

    it("preserves PR #265's cold-start FOUC fix via .background_color() + .theme()", () => {
      // Iter-1 of PR #363 deleted the hard-coded `WINDOW_BG` constant.
      // Both window builders now resolve the OS-frame background AND
      // the OS-chrome theme dynamically from the persisted
      // `OnboardingState.theme` via `commands::theme::resolve_persisted_theme`
      // (single disk read returning `PersistedTheme { bg, theme, raw_pref }`),
      // so light-theme users no longer get a dark-background flash on
      // cold start. The previous regex (`const WINDOW_BG: Color = …`
      // and `.background_color(WINDOW_BG)`) is now a counter-assertion.
      expect(libRs).not.toMatch(/const WINDOW_BG\b/);

      // Both factories must call into `resolve_persisted_theme(handle)`
      // (the single-disk-read resolver that replaced the previous
      // `resolve_window_bg` + `persisted_theme_pref` pair, eliminating
      // the duplicate disk read flagged by the security-perf review).
      const mainBody = buildMainBody();
      expect(mainBody, "build_main_window function body").not.toBeNull();
      expect(mainBody!).toMatch(
        /let pref = commands::theme::resolve_persisted_theme\(handle\);/,
      );
      expect(mainBody!).toMatch(/\.background_color\(pref\.bg\)/);
      expect(mainBody!).toMatch(/\.theme\(Some\(pref\.theme\)\)/);

      // Same invariant for the secondary-window factory used by
      // `open_new_window` / CLI-driven additional windows. Without
      // this, secondary windows would still cold-start with the Tauri
      // default white frame even after PR #363.
      const startIdx = libRs.indexOf("fn create_app_window");
      expect(startIdx).toBeGreaterThan(-1);
      const endIdx = libRs.indexOf("\n}\n", startIdx);
      expect(endIdx).toBeGreaterThan(-1);
      const createBody = libRs.slice(startIdx, endIdx + 3);
      expect(createBody).toMatch(
        /let pref = commands::theme::resolve_persisted_theme\(handle\);/,
      );
      expect(createBody).toMatch(/\.background_color\(pref\.bg\)/);
      expect(createBody).toMatch(/\.theme\(Some\(pref\.theme\)\)/);
    });

    it("calls apply_theme_to_window AFTER builder.build() for muda HMENU + popup theme", () => {
      // Regression guard for the dark-popup-menu / stale-titlebar bug
      // family (initial fix iter-1 + iter-2). `WebviewWindowBuilder::theme()`
      // pre-build only flips Windows DWM immersive-dark-mode on the
      // title bar — it does NOT route through muda (per-window HMENU
      // theme) and on Windows it does NOT set the process-wide popup
      // `SetPreferredAppMode`. The post-build
      // `apply_theme_to_window(&window, native)` call is the chokepoint
      // that does both. Removing it silently re-introduces the original
      // bug (dropdown popups stay OS-themed even when app pref is
      // explicit light/dark; per-window preferred_theme short-circuits
      // event-loop runtime updates so the title bar never refreshes).
      const mainBody = buildMainBody();
      expect(mainBody, "build_main_window function body").not.toBeNull();
      const buildIdx = mainBody!.indexOf(".build()");
      const applyIdx = mainBody!.indexOf("apply_theme_to_window");
      expect(buildIdx, ".build() must be present").toBeGreaterThan(-1);
      expect(applyIdx, "apply_theme_to_window must be present").toBeGreaterThan(-1);
      expect(
        applyIdx,
        "apply_theme_to_window MUST be called AFTER builder.build() — pre-build it cannot reach the HWND",
      ).toBeGreaterThan(buildIdx);

      // Same invariant for create_app_window.
      const startIdx = libRs.indexOf("fn create_app_window");
      expect(startIdx).toBeGreaterThan(-1);
      const endIdx = libRs.indexOf("\n}\n", startIdx);
      const createBody = libRs.slice(startIdx, endIdx + 3);
      const createBuildIdx = createBody.indexOf(".build()");
      const createApplyIdx = createBody.indexOf("apply_theme_to_window");
      expect(createBuildIdx).toBeGreaterThan(-1);
      expect(createApplyIdx).toBeGreaterThan(-1);
      expect(createApplyIdx).toBeGreaterThan(createBuildIdx);
    });

    it("on macOS, applies the theme AFTER app.set_menu so NSApp.appearance flips with the menu attached", () => {
      // Architecture-review HIGH finding: on macOS the global menu bar
      // belongs to NSApp, and its appearance can be snapshotted at the
      // moment `set_menu` attaches. If we flip NSApp.appearance BEFORE
      // `set_menu`, the menu colour can latch wrong. The setup() block
      // must do `app.set_menu(...)` first, THEN call
      // `apply_theme_to_window(...)` against the main window.
      //
      // We assert on the cfg-gated macOS block in `setup()`: find the
      // `#[cfg(target_os = "macos")]` block that wraps `app.set_menu`
      // and verify that block ALSO contains an `apply_theme_to_window`
      // call AFTER the `set_menu` line.
      const macosBlockStart = libRs.indexOf("app.set_menu(main_menu)");
      expect(
        macosBlockStart,
        "setup() must attach the global menu on macOS via app.set_menu(main_menu)",
      ).toBeGreaterThan(-1);

      // Look forward from `app.set_menu` to the end of the enclosing
      // macOS block (the next column-0 `}`). The
      // `apply_theme_to_window` call must appear inside that window.
      const blockEnd = libRs.indexOf("\n            }", macosBlockStart);
      expect(blockEnd).toBeGreaterThan(macosBlockStart);
      const macosBlock = libRs.slice(macosBlockStart, blockEnd);
      expect(
        macosBlock,
        "macOS setup block must call apply_theme_to_window AFTER app.set_menu so NSApp.appearance flips with the menu in place",
      ).toMatch(/apply_theme_to_window/);
    });
  });
});
