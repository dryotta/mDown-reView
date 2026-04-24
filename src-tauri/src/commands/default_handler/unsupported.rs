use super::DefaultHandlerStatus;
use tauri::AppHandle;

pub fn status(_app: &AppHandle) -> DefaultHandlerStatus {
    DefaultHandlerStatus::Unsupported
}

pub fn set(_app: &AppHandle) -> Result<(), String> {
    Err("unsupported on this platform".into())
}
