//! Onboarding IPC commands. App-specific path resolution lives here so
//! `core::onboarding` stays pure & testable on an injectable path.

use crate::core::onboarding::{load_at, save_at, OnboardingState};
use std::cmp::Ordering;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Minimum version a user must already have been welcomed *into* for us to
/// suppress the welcome screen. Bump this when welcome content materially
/// changes — older `last_welcomed_version` values will then re-trigger the
/// welcome flow exactly once. Iter-2 baseline = the package version it shipped
/// in.
pub(crate) const WELCOME_MIN_VERSION: &str = "0.3.4";

fn default_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("onboarding.json"))
}

/// Naive 3-component semver comparison. Splits on `.`, takes the first three
/// fields, parses each as `u32` (defaulting to 0 if missing or non-numeric),
/// and compares the resulting tuple. Pre-release suffixes (e.g. `-beta`) are
/// stripped, so `0.4.0-beta` compares equal to `0.4.0` — acceptable for our
/// gating use case (welcome / update prompts), and avoids pulling in a full
/// semver dep.
fn cmp_semver(a: &str, b: &str) -> Ordering {
    fn parts(v: &str) -> (u32, u32, u32) {
        let head = v.split('-').next().unwrap_or(v);
        let mut it = head.split('.');
        let p = |s: Option<&str>| s.and_then(|x| x.parse::<u32>().ok()).unwrap_or(0);
        (p(it.next()), p(it.next()), p(it.next()))
    }
    parts(a).cmp(&parts(b))
}

#[tauri::command]
pub fn onboarding_state(app: AppHandle) -> Result<OnboardingState, String> {
    let path = default_path(&app)?;
    Ok(load_at(&path))
}

#[tauri::command]
pub fn onboarding_mark_welcomed(app: AppHandle, version: String) -> Result<(), String> {
    let path = default_path(&app)?;
    let mut state = load_at(&path);
    state.last_welcomed_version = Some(version);
    save_at(&path, &state)
}

/// Decide whether to show the welcome flow. Pure helper so tests can drive it
/// against a temp `onboarding.json` without an `AppHandle`.
fn should_welcome_at(path: &Path, current: &str) -> bool {
    // Defensive: if our compiled-in version is somehow older than the welcome
    // floor, never welcome.
    if cmp_semver(current, WELCOME_MIN_VERSION) == Ordering::Less {
        return false;
    }
    let state = load_at(path);
    match state.last_welcomed_version {
        None => true,
        Some(ref v) => cmp_semver(v, WELCOME_MIN_VERSION) == Ordering::Less,
    }
}

#[tauri::command]
pub fn onboarding_should_welcome(app: AppHandle) -> Result<bool, String> {
    let path = default_path(&app)?;
    Ok(should_welcome_at(&path, env!("CARGO_PKG_VERSION")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::onboarding::OnboardingState;
    use tempfile::tempdir;

    fn write_state(path: &Path, state: &OnboardingState) {
        let bytes = serde_json::to_vec_pretty(state).unwrap();
        crate::core::atomic::write_atomic(path, &bytes).unwrap();
    }

    #[test]
    fn cmp_semver_handles_basic_cases() {
        assert_eq!(cmp_semver("1.0.0", "0.9.0"), Ordering::Greater);
        assert_eq!(cmp_semver("0.4.1", "0.4.1"), Ordering::Equal);
        assert_eq!(cmp_semver("0.3.0", "0.4.0"), Ordering::Less);
        // Pre-release suffix stripped — acceptable approximation.
        assert_eq!(cmp_semver("0.4.0-beta", "0.4.0"), Ordering::Equal);
        // Missing components default to 0.
        assert_eq!(cmp_semver("1", "1.0.0"), Ordering::Equal);
        // Non-numeric components default to 0.
        assert_eq!(cmp_semver("1.x.0", "1.0.0"), Ordering::Equal);
    }

    #[test]
    fn should_welcome_when_never_welcomed() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("onboarding.json");
        let state = OnboardingState::default(); // last_welcomed_version: None
        write_state(&path, &state);
        assert!(should_welcome_at(&path, WELCOME_MIN_VERSION));
    }

    #[test]
    fn should_not_welcome_when_welcomed_for_min_or_higher() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("onboarding.json");

        let state = OnboardingState {
            last_welcomed_version: Some(WELCOME_MIN_VERSION.into()),
            ..Default::default()
        };
        write_state(&path, &state);
        assert!(!should_welcome_at(&path, WELCOME_MIN_VERSION));

        // +1 patch bump — still >= floor, so still suppressed.
        let (maj, min, pat) = {
            let mut it = WELCOME_MIN_VERSION.split('.');
            (
                it.next().unwrap().parse::<u32>().unwrap(),
                it.next().unwrap().parse::<u32>().unwrap(),
                it.next().unwrap().parse::<u32>().unwrap(),
            )
        };
        let bumped = OnboardingState {
            last_welcomed_version: Some(format!("{}.{}.{}", maj, min, pat + 1)),
            ..Default::default()
        };
        write_state(&path, &bumped);
        assert!(!should_welcome_at(&path, WELCOME_MIN_VERSION));
    }

    #[test]
    fn should_welcome_when_welcomed_older_version() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("onboarding.json");
        let state = OnboardingState {
            last_welcomed_version: Some("0.0.1".into()),
            ..Default::default()
        };
        write_state(&path, &state);
        // Sanity: floor is greater than 0.0.1.
        assert_eq!(
            cmp_semver(WELCOME_MIN_VERSION, "0.0.1"),
            Ordering::Greater,
            "WELCOME_MIN_VERSION must exceed 0.0.1 for this test to be meaningful"
        );
        assert!(should_welcome_at(&path, WELCOME_MIN_VERSION));
    }
}
