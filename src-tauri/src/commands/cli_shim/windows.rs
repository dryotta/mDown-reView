//! Windows implementation: detect whether the install dir is on user PATH and
//! whether `mdownreview-cli.exe` exists alongside the app exe.
//!
//! Iter-4 onwards, `install` and `remove` mutate `HKCU\Environment\Path`
//! directly (dedup-aware add / case-insensitive filter), preserving the
//! original value type (REG_SZ vs REG_EXPAND_SZ), and broadcast
//! `WM_SETTINGCHANGE` so already-running shells pick up the change without
//! a reboot. This is complementary to the NSIS installer hooks
//! (`installer-hooks.nsh`) — both writers target the same registry value
//! with the same dedupe contract, so reinstalling and toggling in-app
//! never double up. **HKCU only — never HKLM, no admin elevation.**

use super::{CliShimError, CliShimStatus};
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

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable; no registry / Win32 access).
// ---------------------------------------------------------------------------

/// Reject install dirs that would corrupt the PATH string or are empty.
fn validate_install_dir(dir: &str) -> Result<(), CliShimError> {
    if dir.is_empty() {
        return Err(CliShimError::Io {
            message: "install directory is empty".into(),
        });
    }
    if dir.contains(';') {
        return Err(CliShimError::Io {
            message: format!("install directory contains ';' which is forbidden in PATH: {dir}"),
        });
    }
    Ok(())
}

/// Append `install_dir` to `existing` PATH if not already present
/// (case-insensitive). Preserves all other tokens. If `existing` already ends
/// with `;`, no extra separator is inserted.
pub(crate) fn add_path_token(existing: &str, install_dir: &str) -> String {
    let already_present = existing
        .split(';')
        .any(|t| t.eq_ignore_ascii_case(install_dir));
    if already_present {
        return existing.to_string();
    }
    if existing.is_empty() {
        return install_dir.to_string();
    }
    if existing.ends_with(';') {
        format!("{existing}{install_dir}")
    } else {
        format!("{existing};{install_dir}")
    }
}

/// Remove every token equal to `install_dir` (case-insensitive). Preserves
/// the order of remaining tokens AND empty tokens (some PATH strings
/// legitimately contain `a;;b`).
pub(crate) fn remove_path_token(existing: &str, install_dir: &str) -> String {
    existing
        .split(';')
        .filter(|t| !t.eq_ignore_ascii_case(install_dir))
        .collect::<Vec<_>>()
        .join(";")
}

// ---------------------------------------------------------------------------
// Registry I/O (preserves REG_SZ vs REG_EXPAND_SZ value type).
// ---------------------------------------------------------------------------

fn read_path_value(env_key: &RegKey) -> std::io::Result<(String, winreg::enums::RegType)> {
    use winreg::enums::*;
    let raw = match env_key.get_raw_value("Path") {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => winreg::RegValue {
            bytes: Vec::new(),
            vtype: REG_SZ,
        },
        Err(e) => return Err(e),
    };
    let utf16: Vec<u16> = raw
        .bytes
        .chunks_exact(2)
        .map(|p| u16::from_le_bytes([p[0], p[1]]))
        .take_while(|&c| c != 0)
        .collect();
    Ok((String::from_utf16_lossy(&utf16), raw.vtype))
}

fn write_path_value(
    env_key: &RegKey,
    value: &str,
    vtype: winreg::enums::RegType,
) -> std::io::Result<()> {
    let mut bytes: Vec<u8> = value.encode_utf16().flat_map(|c| c.to_le_bytes()).collect();
    bytes.extend_from_slice(&[0, 0]); // UTF-16 null terminator
    env_key.set_raw_value("Path", &winreg::RegValue { bytes, vtype })
}

// ---------------------------------------------------------------------------
// WM_SETTINGCHANGE broadcast — fire-and-forget; never fails the IPC.
// ---------------------------------------------------------------------------

fn broadcast_environment_change() {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
    };
    let env_str: Vec<u16> = "Environment\0".encode_utf16().collect();
    let mut result: usize = 0;
    // Cast HWND_BROADCAST in case windows-sys exposes it as HWND alias.
    let target: HWND = HWND_BROADCAST;
    unsafe {
        SendMessageTimeoutW(
            target,
            WM_SETTINGCHANGE,
            0,
            env_str.as_ptr() as isize,
            SMTO_ABORTIFHUNG,
            5000,
            &mut result,
        );
    }
}

// ---------------------------------------------------------------------------
// Resolve the directory containing the running exe (to install/remove from PATH).
// ---------------------------------------------------------------------------

fn current_exe_dir() -> Result<String, CliShimError> {
    let exe = std::env::current_exe().map_err(|e| CliShimError::Io {
        message: format!("current_exe: {e}"),
    })?;
    exe.parent()
        .ok_or_else(|| CliShimError::Io {
            message: "current_exe has no parent".into(),
        })?
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| CliShimError::Io {
            message: "install_dir is not valid UTF-8".into(),
        })
}

pub fn install(_app: &AppHandle) -> Result<(), CliShimError> {
    use winreg::enums::*;
    let install_dir = current_exe_dir()?;
    validate_install_dir(&install_dir)?;
    let env_key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags("Environment", KEY_READ | KEY_WRITE)
        .map_err(|e| CliShimError::Io {
            message: format!("open HKCU\\Environment: {e}"),
        })?;
    let (current, vtype) = read_path_value(&env_key).map_err(|e| CliShimError::Io {
        message: format!("read Path: {e}"),
    })?;
    let updated = add_path_token(&current, &install_dir);
    if updated != current {
        write_path_value(&env_key, &updated, vtype).map_err(|e| CliShimError::Io {
            message: format!("write Path: {e}"),
        })?;
        broadcast_environment_change();
    }
    Ok(())
}

pub fn remove(_app: &AppHandle) -> Result<(), CliShimError> {
    use winreg::enums::*;
    let install_dir = current_exe_dir()?;
    let env_key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags("Environment", KEY_READ | KEY_WRITE)
        .map_err(|e| CliShimError::Io {
            message: format!("open HKCU\\Environment: {e}"),
        })?;
    let (current, vtype) = read_path_value(&env_key).map_err(|e| CliShimError::Io {
        message: format!("read Path: {e}"),
    })?;
    let updated = remove_path_token(&current, &install_dir);
    if updated != current {
        write_path_value(&env_key, &updated, vtype).map_err(|e| CliShimError::Io {
            message: format!("write Path: {e}"),
        })?;
        broadcast_environment_change();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_path_token_appends_to_empty() {
        assert_eq!(add_path_token("", r"C:\Apps\mdr"), r"C:\Apps\mdr");
    }

    #[test]
    fn add_path_token_appends_with_separator() {
        assert_eq!(
            add_path_token(r"C:\Windows", r"C:\Apps\mdr"),
            r"C:\Windows;C:\Apps\mdr"
        );
    }

    #[test]
    fn add_path_token_skips_when_present_case_insensitive() {
        let p = r"C:\Windows;c:\apps\MDR;C:\Other";
        assert_eq!(add_path_token(p, r"C:\Apps\mdr"), p);
    }

    #[test]
    fn add_path_token_handles_trailing_semicolon() {
        assert_eq!(
            add_path_token(r"C:\Windows;", r"C:\Apps\mdr"),
            r"C:\Windows;C:\Apps\mdr"
        );
    }

    #[test]
    fn remove_path_token_removes_all_case_insensitive() {
        assert_eq!(
            remove_path_token(r"C:\Apps\mdr;C:\Windows;c:\APPS\MDR", r"C:\Apps\mdr"),
            r"C:\Windows"
        );
    }

    #[test]
    fn remove_path_token_preserves_order_and_empty_tokens() {
        assert_eq!(
            remove_path_token(r"a;;b;c:\apps\mdr;d", r"C:\Apps\mdr"),
            "a;;b;d"
        );
    }

    #[test]
    fn remove_path_token_no_op_when_absent() {
        let p = r"C:\Windows;C:\Other";
        assert_eq!(remove_path_token(p, r"C:\Apps\mdr"), p);
    }

    #[test]
    fn validate_install_dir_rejects_semicolon() {
        assert!(validate_install_dir(r"C:\Bad;Path").is_err());
    }

    #[test]
    fn validate_install_dir_rejects_empty() {
        assert!(validate_install_dir("").is_err());
    }

    #[test]
    fn validate_install_dir_accepts_normal_path() {
        assert!(validate_install_dir(r"C:\Program Files\mdownreview").is_ok());
    }
}
