//! `.mrsf.yaml` workspace config: loading, validation, and per-workspace cache.
//!
//! Centralizes all sidecar-root configuration logic:
//! - [`MrsfConfigFile`] — on-disk shape of `.mrsf.yaml`
//! - [`load_mrsf_config`] — load + validate (absolute path, `..` rejection, symlink escape)
//! - [`SidecarConfigState`] — per-workspace config cache (Tauri managed state)

use crate::core::paths::canonicalize_no_verbatim;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

// ---------------------------------------------------------------------------
// .mrsf.yaml loading + validation
// ---------------------------------------------------------------------------

/// On-disk shape of `.mrsf.yaml`. Only the fields we consume;
/// `deny_unknown_fields` ensures we reject typos early.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct MrsfConfigFile {
    sidecar_root: Option<String>,
}

/// Load `.mrsf.yaml` from `workspace_root` and return the validated
/// `sidecar_root` relative path (if configured).
///
/// Returns `Ok(None)` when the file is absent or when it exists but
/// omits the `sidecar_root` key. All load-time validation lives here
/// (absolute path rejection, `..` component rejection, empty-string
/// rejection, symlink-escape check if the dir already exists).
pub fn load_mrsf_config(workspace_root: &Path) -> Result<Option<PathBuf>, String> {
    use crate::core::sidecar::{read_capped, reject_yaml_anchors};

    let config_path = workspace_root.join(".mrsf.yaml");
    let config_str = config_path
        .to_str()
        .ok_or_else(|| ".mrsf.yaml: path is not valid UTF-8".to_string())?;

    // Read with the same 10 MB cap used for sidecars.
    let content = match read_capped(config_str) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!(".mrsf.yaml: {e}")),
    };

    // Reject YAML anchors/aliases (billion-laughs defense).
    reject_yaml_anchors(&content).map_err(|e| format!(".mrsf.yaml: {e}"))?;

    let cfg: MrsfConfigFile =
        serde_yaml_ng::from_str(&content).map_err(|e| format!(".mrsf.yaml: {e}"))?;

    let val = match cfg.sidecar_root {
        Some(v) => v,
        None => return Ok(None),
    };

    // --- load-time validation (doesn't require the dir to exist) ---

    if val.is_empty() {
        return Err(".mrsf.yaml: sidecar_root must not be empty".into());
    }

    let sr = Path::new(&val);
    if sr.is_absolute() {
        return Err(format!(
            ".mrsf.yaml: sidecar_root must be relative, got '{val}'"
        ));
    }

    use std::path::Component;
    if sr.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(format!(
            ".mrsf.yaml: sidecar_root must not contain '..', got '{val}'"
        ));
    }

    // --- runtime checks when the target dir already exists ---
    // Note: when the target dir does NOT exist at load time, the symlink
    // check is deferred to write time via `ensure_sidecar_parent`.

    let target = workspace_root.join(&val);
    if target.exists() {
        if !target.is_dir() {
            return Err(format!(
                ".mrsf.yaml: sidecar_root '{val}' exists but is not a directory"
            ));
        }
        let canonical_target =
            canonicalize_no_verbatim(&target).map_err(|e| format!(".mrsf.yaml: {e}"))?;
        let canonical_root =
            canonicalize_no_verbatim(workspace_root).map_err(|e| format!(".mrsf.yaml: {e}"))?;
        if !canonical_target.starts_with(&canonical_root) {
            return Err(format!(
                ".mrsf.yaml: sidecar_root '{val}' resolves outside workspace"
            ));
        }
    }

    Ok(Some(PathBuf::from(val)))
}

// ---------------------------------------------------------------------------
// Per-workspace config cache (Tauri managed state)
// ---------------------------------------------------------------------------

/// Per-workspace `.mrsf.yaml` configuration cache.
/// Maps canonical workspace root → `Option<PathBuf>` (the `sidecar_root` value).
/// `None` value means either no `.mrsf.yaml` exists or it has no `sidecar_root`.
pub struct SidecarConfigState {
    configs: Arc<Mutex<HashMap<PathBuf, Option<PathBuf>>>>,
    /// Cached result of [`extra_watched_dirs`]. Invalidated on
    /// [`set_config`]/[`remove_config`] to avoid recomputing on every
    /// watcher sync cycle.
    cached_dirs: Arc<Mutex<Option<HashSet<PathBuf>>>>,
}

impl SidecarConfigState {
    pub fn new() -> Self {
        Self {
            configs: Arc::new(Mutex::new(HashMap::new())),
            cached_dirs: Arc::new(Mutex::new(None)),
        }
    }

    /// Look up the sidecar config for a file path by finding which workspace root it belongs to.
    /// Returns `(workspace_root, sidecar_root)` if a workspace matches.
    /// When multiple workspace roots match (nested workspaces), the longest
    /// (most specific) root wins.
    pub fn resolve_for_file(&self, file_path: &Path) -> Option<(PathBuf, Option<PathBuf>)> {
        let guard = self.configs.lock().ok()?;
        let canonical = canonicalize_no_verbatim(file_path).ok()?;
        guard
            .iter()
            .filter(|(root, _)| canonical.starts_with(root))
            .max_by_key(|(root, _)| root.components().count())
            .map(|(root, config)| (root.clone(), config.clone()))
    }

    /// Register or update the config for a workspace root.
    pub fn set_config(&self, workspace_root: PathBuf, sidecar_root: Option<PathBuf>) {
        if let Ok(mut guard) = self.configs.lock() {
            guard.insert(workspace_root, sidecar_root);
        }
        // Invalidate cached dirs
        if let Ok(mut cache) = self.cached_dirs.lock() {
            *cache = None;
        }
    }

    /// Remove config for a workspace root.
    pub fn remove_config(&self, workspace_root: &Path) {
        if let Ok(mut guard) = self.configs.lock() {
            guard.remove(workspace_root);
        }
        // Invalidate cached dirs
        if let Ok(mut cache) = self.cached_dirs.lock() {
            *cache = None;
        }
    }

    /// Return all directories the watcher should monitor for sidecar-root
    /// related changes: each workspace root (for `.mrsf.yaml` detection)
    /// plus each resolved `sidecar_root` directory.
    ///
    /// Results are cached and only recomputed when [`set_config`] or
    /// [`remove_config`] invalidates the cache.
    pub fn extra_watched_dirs(&self) -> HashSet<PathBuf> {
        // Return cached if valid
        if let Ok(cache) = self.cached_dirs.lock() {
            if let Some(ref dirs) = *cache {
                return dirs.clone();
            }
        }

        // Compute fresh
        let mut dirs = HashSet::new();
        if let Ok(guard) = self.configs.lock() {
            for (ws_root, sr) in guard.iter() {
                dirs.insert(ws_root.clone());
                if let Some(sr_path) = sr {
                    let target = ws_root.join(sr_path);
                    if let Ok(c) = canonicalize_no_verbatim(&target) {
                        if c.is_dir() && c.starts_with(ws_root) {
                            dirs.insert(c);
                        }
                    }
                }
            }
        }

        // Store in cache
        if let Ok(mut cache) = self.cached_dirs.lock() {
            *cache = Some(dirs.clone());
        }

        dirs
    }
}
