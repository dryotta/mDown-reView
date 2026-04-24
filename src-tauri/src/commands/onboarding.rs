//! Onboarding IPC commands. App-specific path resolution lives here so
//! `core::onboarding` stays pure & testable on an injectable path.

use crate::core::onboarding::{load_at, save_at, OnboardingState};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn default_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("onboarding.json"))
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

#[tauri::command]
pub fn onboarding_skip(_app: AppHandle) -> Result<(), String> {
    // No-op per spec. Kept as an explicit IPC chokepoint so the FE has a
    // single command for "user dismissed without completing".
    Ok(())
}
