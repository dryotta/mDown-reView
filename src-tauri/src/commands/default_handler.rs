//! Default-handler-for-`.md` status & "open System Settings" prompt.
//! Programmatic detection is best-effort; setting always punts to the OS UI.

use serde::Serialize;
use tauri::AppHandle;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DefaultHandlerStatus {
    Done,
    Other,
    Unknown,
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
pub fn default_handler_status(app: AppHandle) -> DefaultHandlerStatus {
    imp::status(&app)
}

#[tauri::command]
pub fn set_default_handler(app: AppHandle) -> Result<(), String> {
    imp::set(&app)
}
