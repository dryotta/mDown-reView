//! CLI shim install/status/remove. Delegates to a platform sub-module.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CliShimStatus {
    Done,
    Missing,
    Broken,
    Unsupported,
}

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
use macos as imp;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
use windows as imp;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod unsupported;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
use unsupported as imp;

#[tauri::command]
pub fn cli_shim_status(app: tauri::AppHandle) -> CliShimStatus {
    imp::status(&app)
}

#[tauri::command]
pub fn install_cli_shim(app: tauri::AppHandle) -> Result<(), String> {
    imp::install(&app)
}

#[tauri::command]
pub fn remove_cli_shim(app: tauri::AppHandle) -> Result<(), String> {
    imp::remove(&app)
}
