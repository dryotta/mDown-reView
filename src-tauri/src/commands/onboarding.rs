//! Onboarding IPC commands. App-specific path resolution lives here so
//! `core::onboarding` stays pure & testable on an injectable path.

use crate::core::onboarding::{load_at, OnboardingState};
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
