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
      // `OnboardingState.theme` via `commands::config::resolve_window_bg`,
      // so light-theme users no longer get a dark-background flash on
      // cold start. The previous regex (`const WINDOW_BG: Color = …`
      // and `.background_color(WINDOW_BG)`) is now a counter-assertion.
      expect(libRs).not.toMatch(/const WINDOW_BG\b/);

      // Both factories must call into `resolve_window_bg(handle)` to
      // get the persisted (bg, theme) pair, then thread BOTH into the
      // builder. Fail fast if a future change drops either side of the
      // pair: `.background_color(bg)` alone is the original PR #265 fix
      // (FOUC mitigation), `.theme(Some(theme))` is the PR #363
      // extension that also paints the OS title-bar / menu chrome to
      // match.
      const mainBody = buildMainBody();
      expect(mainBody, "build_main_window function body").not.toBeNull();
      expect(mainBody!).toMatch(
        /let \(bg, theme\) = commands::config::resolve_window_bg\(handle\);/,
      );
      expect(mainBody!).toMatch(/\.background_color\(bg\)/);
      expect(mainBody!).toMatch(/\.theme\(Some\(theme\)\)/);

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
        /let \(bg, theme\) = commands::config::resolve_window_bg\(handle\);/,
      );
      expect(createBody).toMatch(/\.background_color\(bg\)/);
      expect(createBody).toMatch(/\.theme\(Some\(theme\)\)/);
    });
  });
});
