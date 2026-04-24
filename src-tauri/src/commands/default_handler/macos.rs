use super::DefaultHandlerStatus;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

pub fn status(_app: &AppHandle) -> DefaultHandlerStatus {
    // Programmatic LSCopyDefaultRoleHandlerForContentType requires core-foundation
    // FFI; out of scope for iter 2 (lean expert pushed back on the dep). Returning
    // Unknown lets the UI prompt "Click to check in System Settings" instead.
    DefaultHandlerStatus::Unknown
}

pub fn set(app: &AppHandle) -> Result<(), String> {
    app.opener()
        .open_url(
            "x-apple.systempreferences:com.apple.preference.general",
            None::<&str>,
        )
        .map_err(|e| e.to_string())
}
