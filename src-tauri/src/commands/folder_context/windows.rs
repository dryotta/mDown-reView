use super::FolderContextStatus;
use tauri::AppHandle;
use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
use winreg::RegKey;

const KEY: &str = r"Software\Classes\Directory\shell\Open with mdownreview";
const KEY_BG: &str = r"Software\Classes\Directory\Background\shell\Open with mdownreview";

pub fn status(_app: &AppHandle) -> FolderContextStatus {
    match RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(KEY, KEY_READ) {
        Ok(_) => FolderContextStatus::Done,
        Err(_) => FolderContextStatus::Missing,
    }
}

pub fn register(_app: &AppHandle) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_str = exe.to_string_lossy().to_string();
    let cmd = format!(r#""{}" "%V""#, exe_str);
    for k in [KEY, KEY_BG] {
        let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey_with_flags(k, KEY_WRITE)
            .map_err(|e| e.to_string())?;
        key.set_value("", &"Open with mdownreview")
            .map_err(|e| e.to_string())?;
        key.set_value("Icon", &exe_str).map_err(|e| e.to_string())?;
        let (cmd_key, _) = key.create_subkey("command").map_err(|e| e.to_string())?;
        cmd_key.set_value("", &cmd).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn unregister(_app: &AppHandle) -> Result<(), String> {
    for k in [KEY, KEY_BG] {
        let _ = RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(k);
    }
    Ok(())
}
