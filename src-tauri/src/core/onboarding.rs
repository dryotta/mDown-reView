//! Onboarding state — pure data + I/O on an injectable path.
//!
//! Tracks which onboarding sections the user has already seen. Schema is
//! versioned from day one: a future `schema_version` is treated as untrusted
//! and ignored (returns Default). Unknown legacy fields (e.g. the removed
//! `last_welcomed_version`) are silently dropped by serde.

use serde::{Deserialize, Serialize};
use std::path::Path;

const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnboardingState {
    pub schema_version: u32,
    #[serde(default)]
    pub last_seen_sections: Vec<String>,
    /// Display name written into `MrsfComment.author` for new comments.
    /// Set via `commands::config::set_author`. Persisted alongside other
    /// onboarding bits because it's a one-off, settings-shaped value with no
    /// natural home elsewhere.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
}

impl Default for OnboardingState {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            last_seen_sections: Vec::new(),
            author: None,
        }
    }
}

/// Load state from `path`. Returns `Default::default()` on any failure
/// (missing, unreadable, malformed, or future schema version).
pub fn load_at(path: &Path) -> OnboardingState {
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(_) => return OnboardingState::default(),
    };
    let parsed: OnboardingState = match serde_json::from_slice(&bytes) {
        Ok(s) => s,
        Err(_) => return OnboardingState::default(),
    };
    if parsed.schema_version > SCHEMA_VERSION {
        return OnboardingState::default();
    }
    parsed
}

/// Save atomically via [`crate::core::atomic::write_atomic`].
pub fn save_at(path: &Path, state: &OnboardingState) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(state).map_err(|e| e.to_string())?;
    crate::core::atomic::write_atomic(path, &bytes).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn missing_file_returns_default() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("onboarding.json");
        let state = load_at(&path);
        assert_eq!(state.schema_version, SCHEMA_VERSION);
        assert!(state.last_seen_sections.is_empty());
    }

    #[test]
    fn save_then_load_roundtrip() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("onboarding.json");
        let original = OnboardingState {
            last_seen_sections: vec!["cli".into(), "default-handler".into()],
            ..Default::default()
        };
        save_at(&path, &original).unwrap();
        let loaded = load_at(&path);
        assert_eq!(
            loaded.last_seen_sections,
            vec!["cli".to_string(), "default-handler".into()]
        );
    }

    #[test]
    fn corrupt_json_returns_default() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("onboarding.json");
        std::fs::write(&path, b"{not valid json").unwrap();
        let state = load_at(&path);
        assert_eq!(state.schema_version, SCHEMA_VERSION);
    }

    #[test]
    fn future_schema_version_returns_default() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("onboarding.json");
        std::fs::write(
            &path,
            br#"{"schema_version":99,"last_seen_sections":[]}"#,
        )
        .unwrap();
        let state = load_at(&path);
        assert_eq!(state.schema_version, SCHEMA_VERSION);
    }

    #[test]
    fn legacy_payload_with_last_welcomed_version_loads_cleanly() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("onboarding.json");
        std::fs::write(
            &path,
            r#"{"schema_version":1,"last_welcomed_version":"0.3.4","last_seen_sections":["cli"]}"#,
        )
        .unwrap();
        let state = load_at(&path);
        assert_eq!(state.schema_version, 1);
        assert_eq!(state.last_seen_sections, vec!["cli".to_string()]);
    }

    #[test]
    fn save_creates_parent_dir() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("nested/missing/onboarding.json");
        save_at(&path, &OnboardingState::default()).unwrap();
        assert!(path.exists());
    }
}
