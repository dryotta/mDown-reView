//! Windows implementation: detect whether the install dir is on user PATH and
//! whether `mdownreview-cli.exe` exists alongside the app exe. Install/remove
//! are no-ops in iter 2 — the NSIS pre/post-install hooks (Group B) own PATH
//! mutation; an in-app re-add path is deliberately deferred.

use super::CliShimStatus;
use tauri::AppHandle;
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

pub fn status(_app: &AppHandle) -> CliShimStatus {
    let exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(_) => return CliShimStatus::Broken,
    };
    let install_dir = match exe.parent() {
        Some(p) => p,
        None => return CliShimStatus::Broken,
    };
    let cli_path = install_dir.join("mdownreview-cli.exe");
    if !cli_path.exists() {
        return CliShimStatus::Missing;
    }

    let env_key = match RegKey::predef(HKEY_CURRENT_USER).open_subkey("Environment") {
        Ok(k) => k,
        Err(_) => return CliShimStatus::Missing,
    };
    let path_value: String = match env_key.get_value("Path") {
        Ok(v) => v,
        Err(_) => return CliShimStatus::Missing,
    };
    let install_dir_str = install_dir.to_string_lossy().to_lowercase();
    let on_path = path_value
        .split(';')
        .any(|seg| seg.trim().to_lowercase() == install_dir_str);
    if on_path {
        CliShimStatus::Done
    } else {
        CliShimStatus::Missing
    }
}

pub fn install(_app: &AppHandle) -> Result<(), String> {
    // No-op — the NSIS POSTINSTALL hook (Group B) adds the install dir to
    // HKCU\Environment\Path. An in-app re-add would need a winreg write plus
    // a WM_SETTINGCHANGE broadcast; deferred past iter 2.
    Ok(())
}

pub fn remove(_app: &AppHandle) -> Result<(), String> {
    // No-op — NSIS PREUNINSTALL hook handles PATH removal.
    Ok(())
}
