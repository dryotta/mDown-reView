//! Folder-context-menu integration ("Open with mdownreview" on directories).
//! Windows-only in iter 2; other platforms are reported as `Unsupported`.

use serde::Serialize;
use tauri::AppHandle;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FolderContextStatus {
    Done,
    Missing,
    Unsupported,
}

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
use windows as imp;

#[cfg(not(target_os = "windows"))]
mod unsupported;
#[cfg(not(target_os = "windows"))]
use unsupported as imp;

#[tauri::command]
pub fn folder_context_status(app: AppHandle) -> FolderContextStatus {
    imp::status(&app)
}

#[tauri::command]
pub fn register_folder_context(app: AppHandle) -> Result<(), String> {
    imp::register(&app)
}

#[tauri::command]
pub fn unregister_folder_context(app: AppHandle) -> Result<(), String> {
    imp::unregister(&app)
}
