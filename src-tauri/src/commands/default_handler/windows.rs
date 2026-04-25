use super::DefaultHandlerStatus;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

pub fn status(_app: &AppHandle) -> DefaultHandlerStatus {
    let prog_id: String = match RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\UserChoice")
        .and_then(|k| k.get_value("ProgId"))
    {
        Ok(v) => v,
        Err(_) => return DefaultHandlerStatus::Unknown,
    };
    if prog_id.contains("mdownreview") {
        DefaultHandlerStatus::Done
    } else {
        DefaultHandlerStatus::Other
    }
}

pub fn set(app: &AppHandle) -> Result<(), String> {
    // Cannot programmatically set UserChoice (Windows hash-protected since Win10).
    // Open the system "Default Apps" pane and let the user pick.
    app.opener()
        .open_url("ms-settings:defaultapps", None::<&str>)
        .map_err(|e| e.to_string())
}
