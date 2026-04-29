//! IPC commands for sidecar configuration and migration.
//!
//! Thin glue — all heavy logic lives in `core::sidecar::config` and
//! `core::sidecar::migration`.

use crate::core::paths::canonicalize_no_verbatim;
use crate::core::sidecar::config::{load_mrsf_config, SidecarConfigState};
use crate::core::sidecar::migration::{self, MigrateDirection, SidecarCounts};
use std::path::PathBuf;
use tauri::{Emitter, Manager};

// ── Result types ─────────────────────────────────────────────────────

// Field names use snake_case to match the frontend's TS contract
// (`SidecarConfigResult` in `src/lib/tauri-commands.ts`). Do NOT add
// `#[serde(rename_all = "camelCase")]` here — that silently turns every
// numeric field into `undefined` on the JS side and the dialog falls
// back to 0/0 (issue #240 regression).
#[derive(serde::Serialize)]
pub struct SidecarConfigResult {
    pub enabled: bool,
    pub sidecar_root: Option<String>,
    pub count_in_folder: u32,
    pub count_colocated: u32,
}

#[derive(serde::Serialize)]
pub struct MigrateSidecarsResult {
    pub moved: u32,
    pub failed: Vec<String>,
    pub config: SidecarConfigResult,
}

// ── Helpers ──────────────────────────────────────────────────────────

fn canon(root: &str) -> Result<PathBuf, String> {
    canonicalize_no_verbatim(std::path::Path::new(root)).map_err(|e| {
        tracing::error!("[rust] sidecar_config: canonicalize error: {e}");
        e.to_string()
    })
}

fn build_result(root: &PathBuf, sidecar_root: &Option<PathBuf>) -> SidecarConfigResult {
    let SidecarCounts {
        count_in_folder,
        count_colocated,
    } = migration::count_sidecars(root, sidecar_root.as_deref());

    SidecarConfigResult {
        enabled: sidecar_root.is_some(),
        sidecar_root: sidecar_root
            .as_ref()
            .map(|p| p.to_string_lossy().into_owned()),
        count_in_folder,
        count_colocated,
    }
}

/// Emit `folder-changed` to ALL windows so every folder pane refreshes.
/// Also emit `sidecar-config-changed` so the watcher hook rescans ghosts.
fn emit_config_changed(app: &tauri::AppHandle, root: &std::path::Path) {
    let path_str = root.to_string_lossy().into_owned();
    let event = crate::watcher::FolderChangeEvent { path: path_str };
    for win in app.webview_windows().values() {
        let _ = win.emit("folder-changed", event.clone());
        let _ = win.emit("sidecar-config-changed", ());
    }
}

// ── Commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_sidecar_config(
    root: String,
    config_state: tauri::State<'_, SidecarConfigState>,
) -> Result<SidecarConfigResult, String> {
    let root = canon(&root)?;

    let sidecar_root = match config_state.resolve_for_file(&root) {
        Some((_, sr)) => sr,
        None => load_mrsf_config(&root)?,
    };

    Ok(build_result(&root, &sidecar_root))
}

#[tauri::command]
pub fn set_sidecar_config(
    window: tauri::Window,
    root: String,
    enabled: bool,
    config_state: tauri::State<'_, SidecarConfigState>,
) -> Result<SidecarConfigResult, String> {
    let root = canon(&root)?;
    let config_path = root.join(".mrsf.yaml");

    let sidecar_root = if enabled {
        let content = b"sidecar_root: .reviews\n";
        crate::core::atomic::write_atomic(&config_path, content).map_err(|e| {
            tracing::error!("[rust] sidecar_config: write error: {e}");
            e.to_string()
        })?;
        Some(PathBuf::from(".reviews"))
    } else {
        if config_path.exists() {
            std::fs::remove_file(&config_path).map_err(|e| {
                tracing::error!("[rust] sidecar_config: delete error: {e}");
                e.to_string()
            })?;
        }
        None
    };

    config_state.set_config(root.clone(), sidecar_root.clone());
    emit_config_changed(&window.app_handle(), &root);

    Ok(build_result(&root, &sidecar_root))
}

#[tauri::command(rename_all = "camelCase")]
pub fn migrate_sidecars_cmd(
    window: tauri::Window,
    root: String,
    direction: MigrateDirection,
    config_state: tauri::State<'_, SidecarConfigState>,
) -> Result<MigrateSidecarsResult, String> {
    let root = canon(&root)?;

    let sidecar_root = match config_state.resolve_for_file(&root) {
        Some((_, sr)) => sr,
        None => load_mrsf_config(&root)?,
    };

    let sr = sidecar_root
        .as_ref()
        .ok_or_else(|| "no sidecar_root configured — enable sidecar folder first".to_string())?;

    let result = migration::migrate_sidecars(&root, sr, direction);

    // Re-count after migration
    let config = build_result(&root, &sidecar_root);
    emit_config_changed(&window.app_handle(), &root);

    Ok(MigrateSidecarsResult {
        moved: result.moved,
        failed: result.failed,
        config,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Regression: SidecarConfigResult and MigrateSidecarsResult MUST
    /// serialize using snake_case field names to match the TS contract
    /// in `src/lib/tauri-commands.ts`. Adding `rename_all = "camelCase"`
    /// would silently turn the numeric counts into `undefined` on the
    /// JS side and the dialog would show 0/0.
    #[test]
    fn sidecar_config_result_uses_snake_case_keys() {
        let r = SidecarConfigResult {
            enabled: true,
            sidecar_root: Some(".reviews".into()),
            count_in_folder: 1,
            count_colocated: 2,
        };
        let json = serde_json::to_value(&r).unwrap();
        assert!(json.get("count_in_folder").is_some(), "missing snake_case count_in_folder");
        assert!(json.get("count_colocated").is_some(), "missing snake_case count_colocated");
        assert!(json.get("sidecar_root").is_some(), "missing snake_case sidecar_root");
        assert!(json.get("countInFolder").is_none(), "camelCase leaked through");
        assert!(json.get("countColocated").is_none(), "camelCase leaked through");
        assert!(json.get("sidecarRoot").is_none(), "camelCase leaked through");
    }

    #[test]
    fn migrate_sidecars_result_uses_snake_case_keys() {
        let r = MigrateSidecarsResult {
            moved: 1,
            failed: vec![],
            config: SidecarConfigResult {
                enabled: false,
                sidecar_root: None,
                count_in_folder: 0,
                count_colocated: 0,
            },
        };
        let json = serde_json::to_value(&r).unwrap();
        let cfg = json.get("config").unwrap();
        assert!(cfg.get("count_in_folder").is_some());
        assert!(cfg.get("count_colocated").is_some());
    }
}
