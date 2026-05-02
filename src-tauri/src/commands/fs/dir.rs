//! Directory listing: `read_dir` / `read_dir_inner`, with sidecar +
//! sidecar_root filtering.

use crate::core::paths::canonicalize_no_verbatim;
use crate::core::types::DirEntry;
use crate::mdr_command;

const DEFAULT_READ_DIR_LIMIT: usize = 250;

/// Capped directory listing: entries + total count + overflow flag.
#[derive(serde::Serialize, Debug, specta::Type)]
pub struct ReadDirResult {
    pub entries: Vec<DirEntry>,
    pub total: usize,
    pub has_more: bool,
}

/// Read directory entries, rejecting path traversal.
/// Returns at most `limit` entries (default 250) with total count so the
/// frontend can offer a "Show all N items…" affordance.
/// Hides `.review.yaml`/`.review.json` sidecar files, and also hides the
/// `sidecar_root` directory when listing a workspace root with an active
/// redirect (AC10: prevents users from seeing the internal sidecar store).
#[mdr_command]
pub fn read_dir(
    path: String,
    limit: Option<usize>,
    show_sidecars: Option<bool>,
    config_state: tauri::State<'_, crate::watcher::SidecarConfigState>,
) -> Result<ReadDirResult, String> {
    read_dir_inner(path, limit, show_sidecars, &config_state)
}

/// Inner implementation, decoupled from `tauri::State` so unit/integration
/// tests can construct a plain `SidecarConfigState` and call this directly
/// without spinning up a full `tauri::App`.
pub fn read_dir_inner(
    path: String,
    limit: Option<usize>,
    show_sidecars: Option<bool>,
    config_state: &crate::watcher::SidecarConfigState,
) -> Result<ReadDirResult, String> {
    // Canonicalize to resolve symlinks and reject traversal
    let canonical = canonicalize_no_verbatim(std::path::Path::new(&path)).map_err(|e| {
        tracing::error!("[rust] command error: {}", e);
        e.to_string()
    })?;
    // Ensure the canonical path matches the requested one (no breakout)
    let requested = std::path::Path::new(&path);
    if requested.is_absolute() {
        let req_canonical = canonicalize_no_verbatim(requested).map_err(|e| e.to_string())?;
        if req_canonical != canonical {
            return Err("path traversal not allowed".into());
        }
    }

    // Determine if we should hide a sidecar_root directory.
    // Only applies when we're listing a workspace root that has sidecar_root configured.
    let hide_dir_name: Option<String> = config_state
        .resolve_for_file(&canonical)
        .and_then(|(ws_root, sr)| {
            if canonical == ws_root {
                // We're listing the workspace root — hide the first component of sidecar_root
                sr.and_then(|p| {
                    p.components()
                        .next()
                        .map(|c| c.as_os_str().to_string_lossy().into_owned())
                })
            } else {
                None
            }
        });

    let entries = std::fs::read_dir(&canonical).map_err(|e| {
        tracing::error!("[rust] command error: {}", e);
        e.to_string()
    })?;

    let mut result = Vec::new();
    let show = show_sidecars.unwrap_or(false);
    for entry in entries {
        let entry = entry.map_err(|e| {
            tracing::error!("[rust] command error: {}", e);
            e.to_string()
        })?;
        let meta = entry.metadata().map_err(|e| {
            tracing::error!("[rust] command error: {}", e);
            e.to_string()
        })?;
        let name = entry.file_name().to_string_lossy().into_owned();
        // Sidecar file filter — gate on is_file so a directory whose name
        // ends in `.review.yaml` (legal on every FS) is never mistaken
        // for a sidecar file.
        if !show && !meta.is_dir() && crate::commands::is_sidecar_file(&name) {
            continue;
        }
        // The "Show sidecar files in folder pane" toggle controls every
        // sidecar artifact uniformly: when OFF (default) we hide both
        // the inline `.review.{yaml,json}` files AND the `sidecar_root`
        // directory configured by `.mrsf.yaml`. When ON, both surface so
        // users can browse `.reviews/` and inspect the raw metadata.
        if !show {
            if let Some(ref hide) = hide_dir_name {
                if name == *hide && meta.is_dir() {
                    continue;
                }
            }
        }

        let path = entry.path().to_string_lossy().into_owned();
        result.push(DirEntry {
            name,
            path,
            is_dir: meta.is_dir(),
        });
    }
    result.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    let total = result.len();
    let cap = limit.unwrap_or(DEFAULT_READ_DIR_LIMIT);
    let has_more = total > cap;
    result.truncate(cap);
    Ok(ReadDirResult { entries: result, total, has_more })
}
