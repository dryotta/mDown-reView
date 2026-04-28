//! Path resolution helpers shared by the CLI and Tauri commands.
//!
//! Centralizes the rules for:
//! - converting user-supplied path strings (absolute, relative, with or
//!   without a `--folder` root) into [`PathBuf`]s;
//! - locating a sidecar file from a source path (preferring `.review.yaml`
//!   over `.review.json`);
//! - canonicalizing the resolved sidecar path and rejecting any result that
//!   escapes the configured folder root (defends against `..` traversal and
//!   symlink escape — TOCTOU defense lives here, not in callers).
//!
//! Rust-First / MVVM: callers pass raw user input + a folder root and
//! receive either a validated canonical [`PathBuf`] or a stable error
//! string. No path validation logic should live in the TypeScript or CLI
//! layers above this module.

use std::path::{Path, PathBuf};

/// Canonicalize `p` without leaking Windows `\\?\` verbatim prefixes across
/// the IPC boundary.
///
/// This is the canonical-form chokepoint for every Tauri command, the
/// watcher, the scanner, and the CLI. Why a dedicated helper instead of
/// calling [`std::fs::canonicalize`] directly:
///
/// - On Windows, [`std::fs::canonicalize`] always returns the verbatim
///   form (`\\?\C:\…` or `\\?\UNC\srv\share\…`). When that string crosses
///   into TypeScript it desynchronises from the bare-form paths that the
///   frontend already holds (workspace `root`, persisted tabs, dialog
///   results, [`std::fs::read_dir`] output) and breaks string-equality
///   matching — the root cause of issue #89's ghost duplicates and the
///   "Other files" mis-attribution.
/// - On non-Windows targets the call is identical to
///   [`std::fs::canonicalize`]; `dunce::canonicalize` is a thin wrapper.
/// - For paths that exceed the legacy `MAX_PATH` (260 bytes) on Windows,
///   no non-verbatim form exists; in that case `dunce` falls back to the
///   verbatim form rather than failing — callers must not assume the
///   result never contains `\\?\`, only that it never contains it
///   *unnecessarily*.
///
/// Errors mirror [`std::fs::canonicalize`] (returns the underlying
/// [`std::io::Error`] on missing file, permission denied, etc.).
pub fn canonicalize_no_verbatim(p: &Path) -> std::io::Result<PathBuf> {
    dunce::canonicalize(p)
}

/// Resolve a CLI-style path argument.
///
/// Rules:
/// - absolute `input` → returned verbatim (folder & cwd ignored)
/// - relative `input` + `Some(folder)` → joined under folder
/// - relative `input` + `None` → joined under cwd
pub fn resolve_path(input: &str, folder: Option<&str>, cwd: &Path) -> PathBuf {
    let p = Path::new(input);
    if p.is_absolute() {
        return p.to_path_buf();
    }
    match folder {
        Some(f) => Path::new(f).join(p),
        None => cwd.join(p),
    }
}

/// If `p` looks like a sidecar (`*.review.yaml` or `*.review.json`),
/// return the source path it annotates (suffix stripped). Returns `None`
/// for any other path or for paths that are not valid UTF-8.
pub fn source_for_sidecar(p: &Path) -> Option<PathBuf> {
    let s = p.to_str()?;
    if let Some(stripped) = s.strip_suffix(".review.yaml") {
        return Some(PathBuf::from(stripped));
    }
    if let Some(stripped) = s.strip_suffix(".review.json") {
        return Some(PathBuf::from(stripped));
    }
    None
}

/// Resolve a sidecar path from CLI input,canonicalize it, and verify it
/// stays inside `folder` if one was supplied.
///
/// Auto-detect:
/// - `input` ending in `.review.yaml`/`.review.json` → used verbatim
///   (write-friendly: file may not yet exist; parent is canonicalized)
/// - otherwise probe `<input>.review.yaml` then `<input>.review.json`;
///   yaml wins if both exist; missing both → error
///
/// Always returns a canonical [`PathBuf`] (TOCTOU defense). When `folder`
/// is provided, the canonical result must start with the canonical folder
/// — symlinks pointing outside the folder are rejected.
pub fn resolve_sidecar(input: &str, folder: Option<&str>, cwd: &Path) -> Result<PathBuf, String> {
    let resolved = resolve_path(input, folder, cwd);

    let candidate = if input.ends_with(".review.yaml") || input.ends_with(".review.json") {
        resolved
    } else {
        let mut yaml = resolved.clone().into_os_string();
        yaml.push(".review.yaml");
        let yaml = PathBuf::from(yaml);
        let mut json = resolved.into_os_string();
        json.push(".review.json");
        let json = PathBuf::from(json);
        if yaml.exists() {
            yaml
        } else if json.exists() {
            json
        } else {
            return Err(not_found_error(input, folder));
        }
    };

    // Canonicalize the candidate. For write paths (file does not yet
    // exist) canonicalize the parent directory and re-attach the file
    // name so the returned path is still fully canonical.
    let canonical = if candidate.exists() {
        canonicalize_no_verbatim(&candidate).map_err(|_| not_found_error(input, folder))?
    } else {
        let parent = candidate
            .parent()
            .ok_or_else(|| not_found_error(input, folder))?;
        let file_name = candidate
            .file_name()
            .ok_or_else(|| not_found_error(input, folder))?;
        let canonical_parent =
            canonicalize_no_verbatim(parent).map_err(|_| not_found_error(input, folder))?;
        canonical_parent.join(file_name)
    };

    if let Some(f) = folder {
        let canonical_folder =
            canonicalize_no_verbatim(Path::new(f)).map_err(|_| outside_root_error(input, f))?;
        if !canonical.starts_with(&canonical_folder) {
            return Err(outside_root_error(input, f));
        }
    }

    Ok(canonical)
}

fn not_found_error(input: &str, folder: Option<&str>) -> String {
    format!(
        "error: sidecar not found for '{}' under folder '{}'",
        input,
        folder.unwrap_or("(none)")
    )
}

fn outside_root_error(input: &str, folder: &str) -> String {
    format!(
        "error: sidecar path outside root for '{}' under folder '{}'",
        input, folder
    )
}

// ---------------------------------------------------------------------------
// .mrsf.yaml config loading + sidecar-root path resolution
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

/// Single chokepoint for all sidecar path resolution.
///
/// When `sidecar_root` is `None` the sidecar is co-located with the
/// source file (current/default behaviour). When `Some(root)` the
/// sidecar is placed under `workspace_root/root/<relative-file-path>.review.yaml`.
///
/// Per-call canonicalization (TOCTOU defence) is performed whenever
/// the resolved path or its nearest existing ancestor can be
/// canonicalized; callers must not weaken this check.
pub fn resolve_sidecar_for_file(
    workspace_root: &Path,
    file_path: &Path,
    sidecar_root: &Option<PathBuf>,
) -> Result<PathBuf, String> {
    match sidecar_root {
        None => {
            // Co-located sidecar — maintains existing behaviour.
            Ok(PathBuf::from(format!(
                "{}.review.yaml",
                file_path.display()
            )))
        }
        Some(root) => {
            let relative = file_path.strip_prefix(workspace_root).map_err(|_| {
                format!(
                    "file '{}' is not under workspace root '{}'",
                    file_path.display(),
                    workspace_root.display()
                )
            })?;

            let sidecar_dir = workspace_root.join(root);
            let sidecar_path = sidecar_dir.join(format!("{}.review.yaml", relative.display()));
            let json_sidecar_path =
                sidecar_dir.join(format!("{}.review.json", relative.display()));

            // TOCTOU defence: canonicalize whatever already exists and
            // verify containment inside workspace_root.
            let canonical_ws = canonicalize_no_verbatim(workspace_root).map_err(|e| {
                format!(
                    "cannot canonicalize workspace root '{}': {e}",
                    workspace_root.display()
                )
            })?;

            // Check YAML first, then JSON fallback
            if sidecar_path.exists() {
                let canon = canonicalize_no_verbatim(&sidecar_path).map_err(|e| {
                    format!(
                        "cannot canonicalize sidecar '{}': {e}",
                        sidecar_path.display()
                    )
                })?;
                if !canon.starts_with(&canonical_ws) {
                    return Err(format!(
                        "sidecar '{}' resolves outside workspace root",
                        sidecar_path.display()
                    ));
                }
                return Ok(canon);
            } else if json_sidecar_path.exists() {
                let canon = canonicalize_no_verbatim(&json_sidecar_path).map_err(|e| {
                    format!(
                        "cannot canonicalize sidecar '{}': {e}",
                        json_sidecar_path.display()
                    )
                })?;
                if !canon.starts_with(&canonical_ws) {
                    return Err(format!(
                        "sidecar '{}' resolves outside workspace root",
                        json_sidecar_path.display()
                    ));
                }
                return Ok(canon);
            }

            // Sidecar doesn't exist yet — try canonicalizing its parent.
            if let Some(parent) = sidecar_path.parent() {
                if parent.exists() {
                    let canon_parent =
                        canonicalize_no_verbatim(parent).map_err(|e| {
                            format!(
                                "cannot canonicalize parent '{}': {e}",
                                parent.display()
                            )
                        })?;
                    if !canon_parent.starts_with(&canonical_ws) {
                        return Err(format!(
                            "sidecar parent '{}' resolves outside workspace root",
                            parent.display()
                        ));
                    }
                    // Return canonical parent + file name.
                    if let Some(name) = sidecar_path.file_name() {
                        return Ok(canon_parent.join(name));
                    }
                }
            }

            // Neither the sidecar nor its parent exist yet — auto-create
            // will happen at write time via `ensure_sidecar_parent`.
            Ok(sidecar_path)
        }
    }
}

/// Auto-create parent directories for a sidecar and verify the
/// canonical result stays inside `workspace_root`.
///
/// This is the write-path companion to [`resolve_sidecar_for_file`].
/// Callers invoke it just before writing a new sidecar whose parent
/// directories may not yet exist.
pub fn ensure_sidecar_parent(workspace_root: &Path, sidecar_path: &Path) -> Result<(), String> {
    let parent = sidecar_path
        .parent()
        .ok_or_else(|| format!("sidecar path '{}' has no parent", sidecar_path.display()))?;

    // Track whether the parent already existed so error-path cleanup
    // only removes directories we actually created (security rule 4:
    // a failed write must never destroy existing data).
    let parent_existed = parent.exists();

    std::fs::create_dir_all(parent)
        .map_err(|e| format!("failed to create sidecar dir '{}': {e}", parent.display()))?;

    let canonical_parent = match canonicalize_no_verbatim(parent) {
        Ok(p) => p,
        Err(e) => {
            if !parent_existed {
                let _ = std::fs::remove_dir_all(parent);
            }
            return Err(format!(
                "cannot canonicalize created dir '{}': {e}",
                parent.display()
            ));
        }
    };

    let canonical_ws = match canonicalize_no_verbatim(workspace_root) {
        Ok(p) => p,
        Err(e) => {
            if !parent_existed {
                let _ = std::fs::remove_dir_all(parent);
            }
            return Err(format!(
                "cannot canonicalize workspace root '{}': {e}",
                workspace_root.display()
            ));
        }
    };

    if !canonical_parent.starts_with(&canonical_ws) {
        if !parent_existed {
            let _ = std::fs::remove_dir_all(parent);
        }
        return Err(format!(
            "created dir '{}' resolves outside workspace root",
            parent.display()
        ));
    }

    Ok(())
}

#[cfg(test)]
#[path = "paths_tests.rs"]
mod tests;
