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

use crate::core::onboarding::{load_at, save_at};
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

pub(crate) fn default_path(app: &AppHandle) -> Result<PathBuf, ConfigError> {
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

}