//! IPC commands for sidecar configuration and migration.
//!
//! Thin glue — all heavy logic lives in `core::sidecar::config` and
//! `core::sidecar::migration`.

use crate::core::paths::canonicalize_no_verbatim;
use crate::core::sidecar::config::{load_mrsf_config, SidecarConfigState};
use crate::core::sidecar::migration::{self, MigrateDirection, SidecarCounts};
use std::path::PathBuf;

// ── Result types ─────────────────────────────────────────────────────

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarConfigResult {
    pub enabled: bool,
    pub sidecar_root: Option<String>,
    pub count_in_folder: u32,
    pub count_colocated: u32,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
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
    Ok(build_result(&root, &sidecar_root))
}

#[tauri::command(rename_all = "camelCase")]
pub fn migrate_sidecars_cmd(
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

    Ok(MigrateSidecarsResult {
        moved: result.moved,
        failed: result.failed,
        config,
    })
}
