//! User-facing config IPC. Currently just `set_author` (persists the display
//! name written into `MrsfComment.author` for newly-created comments). The
//! value lives in `OnboardingState` rather than a dedicated settings file
//! because it's a single one-off knob — splitting a new file for it would be
//! overkill.
//!
//! Validation is strict: name must be ≤128 UTF-8 bytes with no control
//! characters and no newlines. Failures surface as a typed `ConfigError` so
//! the renderer can branch on `kind` rather than parsing prose strings.

use crate::core::onboarding::{load_at, save_at};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const AUTHOR_MAX_BYTES: usize = 128;

/// Discriminated error: each variant carries a stable `kind` tag the TS side
/// can branch on (mirrors `system::SystemError`).
#[derive(serde::Serialize, Debug)]
#[serde(tag = "kind")]
pub enum ConfigError {
    /// Author rejected by validation (length / control chars / newlines).
    /// `reason` is a short machine-readable token, not free-form prose.
    InvalidAuthor { reason: &'static str },
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

#[tauri::command]
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

#[tauri::command]
pub fn get_author(app: AppHandle) -> Result<String, ConfigError> {
    let path = default_path(&app)?;
    Ok(get_author_at_with(&path, default_author))
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
}
