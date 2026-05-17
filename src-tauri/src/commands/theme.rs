// Theme persistence, native chrome/menu application, and cold-start
// resolver. Split out of commands/config.rs (architecture rule 23
// file-size budget).

use crate::commands::config::{default_path, set_theme_at, ConfigError};
use crate::core::onboarding::{load_at, OnboardingState};
use crate::mdr_command;
use tauri::utils::config::Color;
use tauri::{AppHandle, Manager};

// Theme value mapper.

/// Map the persisted theme string to the `tauri::Theme` override applied
/// at runtime via per-window `WebviewWindow::set_theme`.
///
/// - `"light"` / `"dark"` -> `Some(Theme::Light | Theme::Dark)` (explicit
///   override; takes effect immediately on every window's title bar AND
///   on the Win32 native menu bar via muda's `set_theme_for_hwnd`).
/// - `"system"` (or any unrecognised value) -> `None`, which lets muda
///   use `MenuTheme::Auto` and the runtime defer to the OS. On macOS
///   the per-window `Window::set_theme` ends up calling `set_ns_theme`
///   which sets NSApp.appearance, covering the global menu bar.
pub fn theme_to_tauri(theme: &str) -> Option<tauri::Theme> {
    match theme {
        "light" => Some(tauri::Theme::Light),
        "dark" => Some(tauri::Theme::Dark),
        _ => None,
    }
}

// Persisted preference resolver (single disk read).

/// Light-theme background colour. Matches `[data-theme="light"]` in app.css.
pub const LIGHT_BG: Color = Color(0xff, 0xff, 0xff, 0xff);
/// Dark-theme background colour. Matches `[data-theme="dark"]` in app.css.
pub const DARK_BG: Color = Color(0x0d, 0x11, 0x17, 0xff);

/// Resolved per-window cold-start theme bundle. Returned by
/// `resolve_persisted_theme` so window-build sites can fold all
/// theme-related lookups into a single disk read on the cold-start hot
/// path. Previously `build_main_window` called `resolve_window_bg` AND
/// `persisted_theme_pref` separately, each loading `onboarding.json`
/// from disk - flagged by the security-perf review of the initial fix.
pub struct PersistedTheme {
    /// Background colour for `WebviewWindowBuilder::background_color`.
    pub bg: Color,
    /// Concrete `tauri::Theme` for `WebviewWindowBuilder::theme()`.
    /// Always `Light` or `Dark`.
    pub theme: tauri::Theme,
    /// Raw persisted preference (`"system"` / `"light"` / `"dark"`).
    /// Preserves the user's `"system"` distinction so downstream
    /// `apply_theme_to_window` can pick the right `MenuTheme` and (on
    /// Windows) the right popup `PreferredAppMode`.
    pub raw_pref: String,
}

/// Single-disk-read cold-start resolver. Call ONCE per window build.
pub fn resolve_persisted_theme(app: &AppHandle) -> PersistedTheme {
    let state = match default_path(app) {
        Ok(p) => load_at(&p),
        Err(_) => OnboardingState::default(),
    };
    let raw_pref = state
        .theme
        .clone()
        .unwrap_or_else(|| "system".to_string());
    let (bg, theme) = resolve_window_bg_with(&state, detect_os_theme);
    PersistedTheme { bg, theme, raw_pref }
}

/// Pure resolver: maps an `OnboardingState` + an injected
/// OS-theme-detection closure to the `(background_color, theme)` pair
/// the window builder should use. Defense-in-depth fallback to LIGHT
/// per the product-expert v3 ruling on cold-start FOUC asymmetry.
pub fn resolve_window_bg_with<F: FnOnce() -> &'static str>(
    state: &OnboardingState,
    os_detect: F,
) -> (Color, tauri::Theme) {
    let resolved: &str = match state.theme.as_deref() {
        Some("light") => "light",
        Some("dark") => "dark",
        _ => os_detect(),
    };
    match resolved {
        "dark" => (DARK_BG, tauri::Theme::Dark),
        _ => (LIGHT_BG, tauri::Theme::Light),
    }
}

/// Convenience for callers that only need the `(Color, Theme)` pair.
/// New code should prefer `resolve_persisted_theme` so the cold-start
/// hot path stays at one disk read per window.
pub fn resolve_window_bg(app: &AppHandle) -> (Color, tauri::Theme) {
    let p = resolve_persisted_theme(app);
    (p.bg, p.theme)
}

/// Read the persisted theme preference (`"system"` / `"light"` /
/// `"dark"`) from disk. Returns `"system"` when no preference is
/// persisted or on read failure. Hot-path callers should use
/// `resolve_persisted_theme` instead.
pub fn persisted_theme_pref(app: &AppHandle) -> String {
    resolve_persisted_theme(app).raw_pref
}

// Native runtime dispatcher (the IPC chokepoint).

/// Abstraction over "apply this native theme to every window now". The
/// production impl is `AppHandle`. Tests provide a mock that records
/// calls so a regression that removes the load-bearing `apply_theme`
/// invocation from the `set_theme` IPC is caught mechanically.
/// Pattern mirrors `menu.rs::MenuEmitter`.
pub trait ThemeApplier {
    fn apply_theme(&self, native: Option<tauri::Theme>);
}

impl<R: tauri::Runtime> ThemeApplier for AppHandle<R> {
    fn apply_theme(&self, native: Option<tauri::Theme>) {
        for (label, window) in self.webview_windows() {
            if let Err(e) = window.set_theme(native) {
                log::warn!("[theme] set_theme({native:?}) failed on {label}: {e}");
            }
        }
        #[cfg(target_os = "windows")]
        popup_theme::apply(native);
    }
}

/// Drive the dispatcher with the validated pref string. Pure adapter so
/// tests can exercise the `pref -> native -> applier` chain without an
/// `AppHandle`.
pub fn dispatch_set_theme<A: ThemeApplier>(applier: &A, theme_pref: &str) {
    let native = theme_to_tauri(theme_pref);
    log::info!("[theme] dispatch_set_theme pref={theme_pref:?} native={native:?}");
    applier.apply_theme(native);
}

/// IPC chokepoint: persist the pref to disk, then drive the
/// `ThemeApplier` to flip every window's native chrome + menu live (and
/// on Windows the process-wide popup-menu mode).
///
/// Cross-window propagation: this IPC is invoked ONCE per user action,
/// not N times. The menu fires `menu-theme-*` as a Targeted event
/// (per `menu.rs::menu_event_delivery`) so only the firing window's
/// `useMenuListeners` calls `setTheme`. The firing window's Zustand
/// update propagates to other renderers via `useCrossWindowPrefsSync`'s
/// localStorage `storage` event - those renderers update their own
/// `<html data-theme>` without calling the IPC. Meanwhile this one IPC
/// call iterates every native window and applies the theme. Reduces
/// what would have been N IPCs x N windows each (O(N^2)) to one IPC x
/// N windows (O(N)).
#[mdr_command]
pub fn set_theme(app: AppHandle, theme: String) -> Result<(), ConfigError> {
    let path = default_path(&app)?;
    set_theme_at(&path, &theme)?;
    dispatch_set_theme(&app, &theme);
    Ok(())
}

// Per-window post-build helper.

/// Push the given native theme override into a freshly-built window's
/// native chrome + menu, AND (on Windows) flip the process-wide
/// popup-menu mode so the dropdowns drawn by USER32 follow the same
/// preference. Used by `lib.rs::build_main_window` /
/// `create_app_window` after `WebviewWindowBuilder::build()`.
///
/// Takes the resolved `native: Option<tauri::Theme>` (which the caller
/// already has from `PersistedTheme::raw_pref` -> `theme_to_tauri`) so
/// the cold-start hot path doesn't re-read `onboarding.json`.
///
/// `WebviewWindowBuilder::theme()` (pre-build) flips Windows DWM
/// immersive-dark-mode on the title bar but does NOT route through
/// muda, so the HMENU would otherwise default to `MenuTheme::Auto`.
/// On a dark OS with an explicit light app preference (or vice versa)
/// the menu would visibly mismatch the rest of the chrome.
///
/// Why per-window `WebviewWindow::set_theme` instead of
/// `AppHandle::set_theme`? On Windows, `AppHandle::set_theme` forwards
/// to `event_loop.set_theme` (process-wide), which lands in tao's
/// `update_theme` where it reads
/// `window_state.preferred_theme.or(event_loop_preferred_theme)`. The
/// per-window `preferred_theme` short-circuits the `.or(...)` if it's
/// `Some(...)` - and our builder sets it via `.theme(Some(_))` at build
/// time. Result: the event-loop value is silently ignored and the
/// title bar does NOT repaint on runtime theme change. The per-window
/// path updates `window_state.preferred_theme` directly and triggers
/// the DWM flip + forced `WM_NCACTIVATE` redraw.
///
/// macOS ordering: this helper MUST be called AFTER `app.set_menu()`
/// (lib.rs `setup()` does this), otherwise the global menu bar can
/// snapshot NSApp.appearance at attach time with the wrong colour.
///
/// Errors are logged and swallowed: a transient race during
/// construction must not abort the window itself, and the renderer's
/// `useApplyTheme` still paints `<html data-theme>` correctly.
pub fn apply_theme_to_window(window: &tauri::WebviewWindow, native: Option<tauri::Theme>) {
    if let Err(e) = window.set_theme(native) {
        log::warn!(
            "[theme] apply_theme_to_window: set_theme({native:?}) failed on {}: {e}",
            window.label()
        );
    }
    #[cfg(target_os = "windows")]
    popup_theme::apply(native);
}

/// Convenience wrapper that re-reads the persisted pref from disk. Use
/// when the caller doesn't already have a `PersistedTheme` in hand. For
/// the cold-start path, callers should hold the `PersistedTheme` from
/// `resolve_persisted_theme` and call `apply_theme_to_window` directly.
pub fn apply_persisted_theme_to_window(app: &AppHandle, window: &tauri::WebviewWindow) {
    let native = theme_to_tauri(&persisted_theme_pref(app));
    apply_theme_to_window(window, native);
}

// Win32 popup-menu FFI (uxtheme ordinals 135 + 136).
//
// Process-wide Win32 popup-menu theming via undocumented uxtheme.dll
// ordinals. muda's `set_theme_for_hwnd` themes the menu BAR via
// owner-draw subclassing, but the popup dropdowns are separate `HMENU`s
// drawn by USER32 using `GetSysColor(COLOR_MENU)` - they ignore muda
// entirely and follow the OS theme by default.
//
// To override popup menus per-app we call the undocumented
// `SetPreferredAppMode` (uxtheme.dll ordinal 135) + `FlushMenuThemes`
// (ordinal 136), the same trick Windows Terminal, Notepad++, VS
// Code (Electron) and several Tauri/Wry apps use. tao already loads
// ordinal 135 in `tao::platform_impl::windows::dark_mode::allow_dark_mode_for_app`
// but it ONLY ever passes `Default` (Win10 1809-1903) or `AllowDark`
// (Win10 1903+) - never `ForceDark` or `ForceLight`. Those are the
// variants that override the OS theme, and we need them when the
// user's app preference disagrees with the OS.
//
// Process-wide and stateful: once `SetPreferredAppMode` is called,
// every subsequent popup-menu opens with the chosen scheme until
// the next call. `FlushMenuThemes` invalidates uxtheme's cached menu
// data so the change takes effect for the NEXT popup. Currently-open
// popups are NOT repainted - they live in their own OS-owned window
// class.
//
// Idempotent and gracefully degrades: when the ordinals are absent
// (very old Windows, future API removal) the calls become no-ops and
// the popups stay following the OS theme.
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod popup_theme {
    use std::sync::OnceLock;
    use windows_sys::Win32::Foundation::HMODULE;
    use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryA};

    #[repr(C)]
    #[derive(Copy, Clone)]
    enum PreferredAppMode {
        #[allow(dead_code)]
        Default = 0,
        AllowDark = 1,
        ForceDark = 2,
        ForceLight = 3,
    }

    type SetPreferredAppModeFn =
        unsafe extern "system" fn(PreferredAppMode) -> PreferredAppMode;
    type FlushMenuThemesFn = unsafe extern "system" fn();

    struct UxthemeApi {
        set_mode: Option<SetPreferredAppModeFn>,
        flush_menus: Option<FlushMenuThemesFn>,
    }

    fn api() -> &'static UxthemeApi {
        static API: OnceLock<UxthemeApi> = OnceLock::new();
        API.get_or_init(|| unsafe {
            let lib: HMODULE = LoadLibraryA(b"uxtheme.dll\0".as_ptr());
            if lib.is_null() {
                return UxthemeApi { set_mode: None, flush_menus: None };
            }
            let set_mode_raw = GetProcAddress(lib, 135usize as *const u8);
            let flush_raw = GetProcAddress(lib, 136usize as *const u8);
            UxthemeApi {
                set_mode: set_mode_raw.map(|f| {
                    std::mem::transmute::<
                        unsafe extern "system" fn() -> isize,
                        SetPreferredAppModeFn,
                    >(f)
                }),
                flush_menus: flush_raw.map(|f| {
                    std::mem::transmute::<
                        unsafe extern "system" fn() -> isize,
                        FlushMenuThemesFn,
                    >(f)
                }),
            }
        })
    }

    pub fn apply(theme: Option<tauri::Theme>) {
        let mode = match theme {
            Some(tauri::Theme::Light) => PreferredAppMode::ForceLight,
            Some(tauri::Theme::Dark) => PreferredAppMode::ForceDark,
            _ => PreferredAppMode::AllowDark,
        };
        let api = api();
        if let Some(set_mode) = api.set_mode {
            unsafe { set_mode(mode); }
        }
        if let Some(flush) = api.flush_menus {
            unsafe { flush(); }
        }
    }
}

// In-process OS-theme detection.

#[cfg(target_os = "windows")]
fn detect_os_theme() -> &'static str {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(key) = hkcu.open_subkey(
        "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
    ) {
        let v: Result<u32, _> = key.get_value("AppsUseLightTheme");
        if let Ok(value) = v {
            return if value == 1 { "light" } else { "dark" };
        }
    }
    "light"
}

#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
fn detect_os_theme() -> &'static str {
    use core_foundation::base::TCFType;
    use core_foundation::string::{CFString, CFStringRef};
    use core_foundation_sys::preferences::{
        kCFPreferencesAnyApplication, CFPreferencesCopyAppValue,
    };
    unsafe {
        let key = CFString::new("AppleInterfaceStyle");
        let value = CFPreferencesCopyAppValue(
            key.as_concrete_TypeRef(),
            kCFPreferencesAnyApplication,
        );
        if value.is_null() {
            return "light";
        }
        let s = CFString::wrap_under_create_rule(value as CFStringRef);
        if s.to_string().eq_ignore_ascii_case("dark") {
            "dark"
        } else {
            "light"
        }
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn detect_os_theme() -> &'static str {
    "light"
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    // theme_to_tauri (closed-enum mapper)

    #[test]
    fn theme_to_tauri_maps_light_to_some_light() {
        assert!(matches!(theme_to_tauri("light"), Some(tauri::Theme::Light)));
    }

    #[test]
    fn theme_to_tauri_maps_dark_to_some_dark() {
        assert!(matches!(theme_to_tauri("dark"), Some(tauri::Theme::Dark)));
    }

    #[test]
    fn theme_to_tauri_maps_system_to_none() {
        assert!(theme_to_tauri("system").is_none());
    }

    #[test]
    fn theme_to_tauri_maps_unknown_to_none() {
        assert!(theme_to_tauri("").is_none());
        assert!(theme_to_tauri("auto").is_none());
        assert!(theme_to_tauri("Light").is_none()); // case-sensitive
    }

    // ThemeApplier dispatch contract (regression guard against silent
    // removal of the load-bearing applier.apply_theme(...) call inside
    // the IPC).

    #[derive(Default)]
    struct MockApplier {
        calls: RefCell<Vec<Option<tauri::Theme>>>,
    }

    impl ThemeApplier for MockApplier {
        fn apply_theme(&self, native: Option<tauri::Theme>) {
            self.calls.borrow_mut().push(native);
        }
    }

    #[test]
    fn dispatch_set_theme_maps_light_and_invokes_applier_once() {
        let mock = MockApplier::default();
        dispatch_set_theme(&mock, "light");
        let calls = mock.calls.borrow();
        assert_eq!(calls.len(), 1);
        assert!(matches!(calls[0], Some(tauri::Theme::Light)));
    }

    #[test]
    fn dispatch_set_theme_maps_dark_and_invokes_applier_once() {
        let mock = MockApplier::default();
        dispatch_set_theme(&mock, "dark");
        let calls = mock.calls.borrow();
        assert_eq!(calls.len(), 1);
        assert!(matches!(calls[0], Some(tauri::Theme::Dark)));
    }

    #[test]
    fn dispatch_set_theme_maps_system_to_none_and_invokes_applier_once() {
        let mock = MockApplier::default();
        dispatch_set_theme(&mock, "system");
        let calls = mock.calls.borrow();
        assert_eq!(calls.len(), 1);
        assert!(calls[0].is_none());
    }

    #[test]
    fn dispatch_set_theme_invokes_applier_per_call() {
        let mock = MockApplier::default();
        dispatch_set_theme(&mock, "light");
        dispatch_set_theme(&mock, "dark");
        dispatch_set_theme(&mock, "system");
        let calls = mock.calls.borrow();
        assert_eq!(calls.len(), 3);
        assert!(matches!(calls[0], Some(tauri::Theme::Light)));
        assert!(matches!(calls[1], Some(tauri::Theme::Dark)));
        assert!(calls[2].is_none());
    }

    // resolve_window_bg_with (8-branch matrix)

    #[test]
    fn resolve_explicit_light_overrides_os_dark() {
        let mut state = OnboardingState::default();
        state.theme = Some("light".into());
        let (bg, theme) = resolve_window_bg_with(&state, || "dark");
        assert_eq!(bg, LIGHT_BG);
        assert!(matches!(theme, tauri::Theme::Light));
    }

    #[test]
    fn resolve_explicit_dark_overrides_os_light() {
        let mut state = OnboardingState::default();
        state.theme = Some("dark".into());
        let (bg, theme) = resolve_window_bg_with(&state, || "light");
        assert_eq!(bg, DARK_BG);
        assert!(matches!(theme, tauri::Theme::Dark));
    }

    #[test]
    fn resolve_system_preference_defers_to_os_detect_light() {
        let mut state = OnboardingState::default();
        state.theme = Some("system".into());
        let (bg, theme) = resolve_window_bg_with(&state, || "light");
        assert_eq!(bg, LIGHT_BG);
        assert!(matches!(theme, tauri::Theme::Light));
    }

    #[test]
    fn resolve_system_preference_defers_to_os_detect_dark() {
        let mut state = OnboardingState::default();
        state.theme = Some("system".into());
        let (bg, theme) = resolve_window_bg_with(&state, || "dark");
        assert_eq!(bg, DARK_BG);
        assert!(matches!(theme, tauri::Theme::Dark));
    }

    #[test]
    fn resolve_no_preference_defers_to_os_detect_light() {
        let state = OnboardingState::default();
        let (bg, theme) = resolve_window_bg_with(&state, || "light");
        assert_eq!(bg, LIGHT_BG);
        assert!(matches!(theme, tauri::Theme::Light));
    }

    #[test]
    fn resolve_no_preference_defers_to_os_detect_dark() {
        let state = OnboardingState::default();
        let (bg, theme) = resolve_window_bg_with(&state, || "dark");
        assert_eq!(bg, DARK_BG);
        assert!(matches!(theme, tauri::Theme::Dark));
    }

    #[test]
    fn resolve_os_detect_unknown_falls_back_to_light() {
        let state = OnboardingState::default();
        let (bg, theme) = resolve_window_bg_with(&state, || "unknown");
        assert_eq!(bg, LIGHT_BG);
        assert!(matches!(theme, tauri::Theme::Light));
    }

    #[test]
    fn resolve_invalid_persisted_value_defers_to_os_detect() {
        let mut state = OnboardingState::default();
        state.theme = Some("garbage".into());
        let (bg, theme) = resolve_window_bg_with(&state, || "dark");
        assert_eq!(bg, DARK_BG);
        assert!(matches!(theme, tauri::Theme::Dark));
    }

    #[test]
    fn detect_os_theme_returns_known_value() {
        let v = detect_os_theme();
        assert!(v == "light" || v == "dark", "got {v}");
    }
}
