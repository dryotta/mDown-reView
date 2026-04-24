use super::FolderContextStatus;
use tauri::AppHandle;

pub fn status(_app: &AppHandle) -> FolderContextStatus {
    FolderContextStatus::Unsupported
}

pub fn register(_app: &AppHandle) -> Result<(), String> {
    Err("unsupported on this platform".into())
}

pub fn unregister(_app: &AppHandle) -> Result<(), String> {
    Err("unsupported on this platform".into())
}
