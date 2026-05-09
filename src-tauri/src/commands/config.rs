//! User-facing config IPC and cold-start window-background resolver.
//!
//! Hosts `set_author` / `get_author` (persists the display name written into
//! `MrsfComment.author` for newly-created comments) and `set_theme` (persists
//! the user's theme preference — `"system"` / `"light"` / `"dark"`). Both
//! values live in `OnboardingState` rather than a dedicated settings file
//! because they are one-off settings knobs; splitting a new file would be
//! overkill at the current scale (a SPLIT into `Settings` vs `OnboardingState`
//! is tracked as a follow-up).
//!
//! The cold-start window-background resolver `resolve_window_bg(app)` reads
//! the persisted theme preference (or detects OS theme in-process when
//! absent / `"system"`) and returns the `(Color, tauri::Theme)` pair the
//! window builder applies via `.background_color()` + `.theme(Some(...))`.
//! This eliminates the cold-start light-theme flash regression from PR #265.
//!
//! Validation: `set_author` rejects ≤128 UTF-8 bytes with no control
//! characters and no newlines; `set_theme` rejects anything outside the
//! closed enum `{"system","light","dark"}`. Failures surface as a typed
//! `ConfigError` so the renderer can branch on `kind` rather than parsing
//! prose strings.

use crate::core::onboarding::{load_at, save_at, OnboardingState};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use crate::mdr_command;

const AUTHOR_MAX_BYTES: usize = 128;

/// Discriminated error: each variant carries a stable `kind` tag the TS side
/// can branch on (mirrors `system::SystemError`).
#[derive(serde::Serialize, Debug, specta::Type)]
#[serde(tag = "kind")]
pub enum ConfigError {
    /// Author rejected by validation (length / control chars / newlines).
    /// `reason` is a short machine-readable token, not free-form prose.
    InvalidAuthor { reason: &'static str },
    /// Theme rejected by validation. Renderer never sends garbage but this is
    /// defense-in-depth. Closed enum (no `reason` field) — the only valid values
    /// are "system" / "light" / "dark" so a single tag is sufficient.
    InvalidTheme,
    /// Persisting onboarding state failed (disk full, permission denied, etc.).
    IoError { message: String },
}

fn default_path(app: &AppHandle) -> Result<PathBuf, ConfigError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| ConfigError::IoError {
            message: e.to_string(),
        })?;
    Ok(dir.join("onboarding.json"))
}

/// Validate an author string under the documented rules and trim trailing
/// whitespace. Returns `Ok(trimmed)` or a typed `ConfigError::InvalidAuthor`.
///
/// Rules:
/// - byte length ≤ 128 (matches MRSF's modest field budget)
/// - no ASCII control chars (rules out `\t`, `\r`, etc.)
/// - no newlines (already covered by control-char rule, but kept as a
///   distinct token so the UI can render a more specific error)
pub fn validate_author(name: &str) -> Result<String, ConfigError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ConfigError::InvalidAuthor { reason: "empty" });
    }
    if trimmed.len() > AUTHOR_MAX_BYTES {
        return Err(ConfigError::InvalidAuthor { reason: "too_long" });
    }
    if trimmed.contains('\n') || trimmed.contains('\r') {
        return Err(ConfigError::InvalidAuthor { reason: "newline" });
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return Err(ConfigError::InvalidAuthor {
            reason: "control_char",
        });
    }
    Ok(trimmed.to_string())
}

/// Pure helper used by the IPC entry point and by integration tests so they
/// can drive the validate→persist path without an AppHandle.
pub fn set_author_at(path: &Path, name: &str) -> Result<String, ConfigError> {
    let cleaned = validate_author(name)?;
    let mut state = load_at(path);
    state.author = Some(cleaned.clone());
    save_at(path, &state).map_err(|e| ConfigError::IoError { message: e })?;
    Ok(cleaned)
}

#[mdr_command]
pub fn set_author(app: AppHandle, name: String) -> Result<String, ConfigError> {
    let path = default_path(&app)?;
    set_author_at(&path, &name)
}

/// OS-user fallback when no author has been configured yet. Reads
/// `USERNAME` (Windows) or `USER` (macOS / Linux). No `whoami` crate —
/// the env-var path covers every supported target and keeps the binary
/// lean. Returns `"anonymous"` when neither var is set.
pub fn default_author() -> String {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "anonymous".into())
}

/// Pure helper: read author from `path`, falling back to the OS-user
/// resolver `default_author()` (or any closure of the same shape, for
/// tests). Never fails — load failures are absorbed by `load_at`'s
/// `Default` policy.
pub fn get_author_at_with<F: FnOnce() -> String>(path: &Path, fallback: F) -> String {
    let state = load_at(path);
    state.author.unwrap_or_else(fallback)
}

#[mdr_command]
pub fn get_author(app: AppHandle) -> Result<String, ConfigError> {
    let path = default_path(&app)?;
    Ok(get_author_at_with(&path, default_author))
}

/// Pure helper used by the IPC entry point and integration tests so they can
/// drive the validate→persist path without an AppHandle. Mirrors `set_author_at`.
pub fn set_theme_at(path: &Path, theme: &str) -> Result<(), ConfigError> {
    if !matches!(theme, "system" | "light" | "dark") {
        return Err(ConfigError::InvalidTheme);
    }
    let mut state = load_at(path);
    state.theme = Some(theme.to_string());
    save_at(path, &state).map_err(|e| ConfigError::IoError { message: e })
}

#[mdr_command]
pub fn set_theme(app: AppHandle, theme: String) -> Result<(), ConfigError> {
    let path = default_path(&app)?;
    set_theme_at(&path, &theme)
}

// ── Window background resolver (cold-start FOUC fix from PR #363) ────────

use tauri::utils::config::Color;

/// Light-theme `--color-bg` (matches `[data-theme="light"]` in app.css).
pub const LIGHT_BG: Color = Color(0xff, 0xff, 0xff, 0xff);
/// Dark-theme `--color-bg` (matches `[data-theme="dark"]` in app.css).
pub const DARK_BG: Color = Color(0x0d, 0x11, 0x17, 0xff);

/// Pure resolver: maps an OnboardingState (the persisted theme preference)
/// + an injected OS-theme-detection closure to the (background_color, theme)
/// pair the window builder should use.
///
/// Resolution order:
///   1. `state.theme == Some("light"|"dark")` — explicit user preference wins.
///   2. `state.theme == Some("system")` or `None` — defer to `os_detect`.
///   3. `os_detect` returns "light"/"dark" — use it.
///   4. `os_detect` returns anything else (or detection failed) — fall back
///      to LIGHT (NOT dark). Per product-expert v3 review: light-theme users
///      are the asymmetric-exposure cohort; dark-theme users never see the
///      flash because dark→dark masks any wrong answer. Aligns with
///      browser `prefers-color-scheme` default and macOS "absent = light"
///      convention.
///
/// Returns (Color, tauri::Theme) so the window builder can call BOTH
/// `.background_color()` (OS-paint pre-attach) AND `.theme()` (OS chrome,
/// e.g. Windows titlebar dark mode). Every branch returns a concrete
/// `tauri::Theme` (Light or Dark) — never `None`.
///
/// Mirrors the `get_author_at_with<F: FnOnce() -> String>` pattern at line
/// ~97 of this file: dependency-injection seam for unit-testability across
/// platforms without `#[cfg]`-gated test bodies.
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

/// Production caller — reads OnboardingState from disk and detects OS theme
/// in-process (Win registry / macOS CFPreferences / Linux fallback).
/// Called from `lib.rs::build_main_window` and `lib.rs::create_app_window`.
pub fn resolve_window_bg(app: &AppHandle) -> (Color, tauri::Theme) {
    let state = match default_path(app) {
        Ok(p) => load_at(&p),
        Err(_) => OnboardingState::default(),
    };
    resolve_window_bg_with(&state, detect_os_theme)
}

/// In-process OS theme detection. NEVER use `Command::new("defaults")` —
/// security-expert + perf-expert v3 ruling: shell-out adds 30-80ms to cold
/// start, has PATH-hijack risk, and defeats the FOUC fix's purpose.
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
    "light" // fallback per product-expert ruling — see resolve_window_bg_with doc
}

#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
fn detect_os_theme() -> &'static str {
    // CFPreferencesCopyAppValue("AppleInterfaceStyle", kCFPreferencesAnyApplication)
    // returns CFString "Dark" when dark mode is on, NULL otherwise (light is
    // the default; absence IS the light signal). In-process CFPreferences
    // call — no fork+exec.
    //
    // The `preferences` symbols live in `core-foundation-sys` (the FFI
    // crate); `core-foundation` 0.10 does NOT re-export them. We import
    // the function and the global `kCFPreferencesAnyApplication` constant
    // (a `CFStringRef` static) directly from -sys. The constant must be
    // used by reference — constructing `CFString::new("kCFPreferencesAnyApplication")`
    // would silently pass a literal Rust string and never match the real
    // global preferences scope.
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
    use tempfile::tempdir;

    #[test]
    fn rejects_empty() {
        let err = validate_author("   ").unwrap_err();
        match err {
            ConfigError::InvalidAuthor { reason } => assert_eq!(reason, "empty"),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn rejects_over_128_bytes() {
        let long: String = "a".repeat(129);
        let err = validate_author(&long).unwrap_err();
        match err {
            ConfigError::InvalidAuthor { reason } => assert_eq!(reason, "too_long"),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn allows_exactly_128_bytes() {
        let max: String = "a".repeat(128);
        assert_eq!(validate_author(&max).unwrap(), max);
    }

    #[test]
    fn rejects_newline() {
        let err = validate_author("alice\nbob").unwrap_err();
        match err {
            ConfigError::InvalidAuthor { reason } => assert_eq!(reason, "newline"),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn rejects_carriage_return() {
        let err = validate_author("alice\rbob").unwrap_err();
        match err {
            ConfigError::InvalidAuthor { reason } => assert_eq!(reason, "newline"),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn rejects_control_char() {
        let err = validate_author("alice\tbob").unwrap_err();
        match err {
            ConfigError::InvalidAuthor { reason } => assert_eq!(reason, "control_char"),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn happy_path_trims_and_persists() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("onboarding.json");
        let stored = set_author_at(&path, "  Alice  ").unwrap();
        assert_eq!(stored, "Alice");
        let state = crate::core::onboarding::load_at(&path);
        assert_eq!(state.author.as_deref(), Some("Alice"));
    }

    #[test]
    fn get_author_returns_persisted_value() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("onboarding.json");
        set_author_at(&path, "Reviewer-2").unwrap();
        let v = get_author_at_with(&path, || "should-not-call".into());
        assert_eq!(v, "Reviewer-2");
    }

    #[test]
    fn get_author_falls_back_to_supplied_default() {
        // No author persisted → the closure is consulted.
        let dir = tempdir().unwrap();
        let path = dir.path().join("onboarding.json");
        let v = get_author_at_with(&path, || "fallback-user".into());
        assert_eq!(v, "fallback-user");
    }

    #[test]
    fn default_author_returns_non_empty() {
        // Smoke test for the OS-user resolver: at least one of USERNAME /
        // USER is set on every supported runner, OR we fall through to
        // "anonymous". Never panics, never empty.
        let v = default_author();
        assert!(!v.is_empty());
    }

    #[test]
    fn unicode_within_128_bytes_is_accepted() {
        // Multi-byte chars: 32 × 4-byte chars = 128 bytes.
        let s: String = "🎉".repeat(32);
        assert_eq!(s.len(), 128);
        assert_eq!(validate_author(&s).unwrap(), s);
    }

    // ── set_theme tests (mirrors set_author tests) ────────────────────────────

    #[test]
    fn set_theme_rejects_empty() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("onboarding.json");
        let err = set_theme_at(&path, "").unwrap_err();
        assert!(matches!(err, ConfigError::InvalidTheme));
    }

    #[test]
    fn set_theme_rejects_uppercase() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("onboarding.json");
        let err = set_theme_at(&path, "Light").unwrap_err();
        assert!(matches!(err, ConfigError::InvalidTheme));
    }

    #[test]
    fn set_theme_rejects_unknown_value() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("onboarding.json");
        let err = set_theme_at(&path, "auto").unwrap_err();
        assert!(matches!(err, ConfigError::InvalidTheme));
    }

    #[test]
    fn set_theme_rejects_value_with_newline() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("onboarding.json");
        let err = set_theme_at(&path, "dark\n").unwrap_err();
        assert!(matches!(err, ConfigError::InvalidTheme));
    }

    #[test]
    fn set_theme_accepts_each_valid_value() {
        for v in ["system", "light", "dark"] {
            let dir = tempdir().unwrap();
            let path = dir.path().join("onboarding.json");
            set_theme_at(&path, v).expect("valid value should persist");
            let state = crate::core::onboarding::load_at(&path);
            assert_eq!(state.theme.as_deref(), Some(v));
        }
    }

    #[test]
    fn set_theme_preserves_author_on_subsequent_writes() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("onboarding.json");
        set_author_at(&path, "Alice").unwrap();
        set_theme_at(&path, "dark").unwrap();
        let state = crate::core::onboarding::load_at(&path);
        assert_eq!(state.author.as_deref(), Some("Alice"));
        assert_eq!(state.theme.as_deref(), Some("dark"));
    }

    // ── resolve_window_bg_with tests (8-branch matrix) ────────────────────────

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
        let state = OnboardingState::default(); // theme: None
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
