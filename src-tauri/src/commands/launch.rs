//! Launch-time and diagnostic commands (CLI args, log path, file scanner).

use super::is_sidecar_file;
use crate::core::types::LaunchArgs;
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};

pub type LaunchArgsState = Arc<Mutex<Option<LaunchArgs>>>;

/// Get (and clear) launch args stored during setup.
#[tauri::command]
pub fn get_launch_args(state: State<LaunchArgsState>) -> Result<LaunchArgs, String> {
    let mut guard = state.lock().map_err(|e| format!("lock poisoned: {}", e))?;
    Ok(guard.take().unwrap_or_default())
}

/// Get the log file path for display in the About dialog.
#[tauri::command]
pub fn get_log_path(app: tauri::AppHandle) -> Result<String, String> {
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    Ok(log_dir.join("mdownreview.log").to_string_lossy().into_owned())
}

/// Scan a directory tree for MRSF sidecar files (delegates to core::scanner).
#[tauri::command]
pub fn scan_review_files(root: String) -> Result<Vec<(String, String)>, String> {
    Ok(crate::core::scanner::find_review_files(&root, 10_000))
}

/// Test-only command: open a folder and all its non-sidecar files via args-received.
#[cfg(debug_assertions)]
#[tauri::command]
pub fn set_root_via_test(path: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Emitter;

    let folder = std::path::Path::new(&path);
    let mut files: Vec<String> = Vec::new();

    if let Ok(entries) = std::fs::read_dir(folder) {
        let mut paths: Vec<std::path::PathBuf> = entries
            .flatten()
            .filter_map(|e| {
                let p = e.path();
                if !p.is_file() {
                    return None;
                }
                let name = p.file_name()?.to_str()?.to_owned();
                if is_sidecar_file(&name) {
                    return None;
                }
                Some(p)
            })
            .collect();
        paths.sort();
        files = paths
            .into_iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
    }

    let payload = serde_json::json!({
        "files": files,
        "folders": [path],
    });

    if let Some(window) = app.get_webview_window("main") {
        window
            .emit("args-received", payload)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}
