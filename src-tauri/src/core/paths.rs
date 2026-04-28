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
// .mrsf.yaml config loading lives in core/sidecar/config.rs.
// Re-export for backward compatibility with existing callers.
// ---------------------------------------------------------------------------

pub use crate::core::sidecar::config::load_mrsf_config;

// ---------------------------------------------------------------------------
// Sidecar-root path resolution
// ---------------------------------------------------------------------------

/// Verify that `path` is contained within `workspace_root` after
/// canonicalization. Returns canonical `path` on success.
fn check_containment(path: &Path, canonical_ws: &Path) -> Result<PathBuf, String> {
    let canon = canonicalize_no_verbatim(path).map_err(|e| {
        format!("cannot canonicalize '{}': {e}", path.display())
    })?;
    if !canon.starts_with(canonical_ws) {
        return Err(format!(
            "'{}' resolves outside workspace root",
            path.display()
        ));
    }
    Ok(canon)
}

/// Single chokepoint for all sidecar path resolution.
///
/// When `sidecar_root` is `None` the sidecar is co-located with the
/// source file (current/default behaviour). When `Some(root)` the
/// sidecar is placed under `workspace_root/root/<relative-file-path>.review.yaml`.
///
/// `workspace_root` **must** already be canonical (callers canonicalize
/// at the IPC boundary). `file_path` is canonicalized internally to
/// handle 8.3 short-name mismatches on Windows.
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
            // Best-effort canonicalization of file_path to handle 8.3
            // short-name mismatches on Windows CI (RUNNER~1 vs runneradmin).
            // Falls back to the raw path when the file doesn't exist yet.
            let effective_file = canonicalize_no_verbatim(file_path)
                .unwrap_or_else(|_| file_path.to_path_buf());
            let relative = effective_file.strip_prefix(workspace_root).map_err(|_| {
                format!(
                    "file '{}' is not under workspace root '{}'",
                    effective_file.display(),
                    workspace_root.display()
                )
            })?;

            let sidecar_dir = workspace_root.join(root);
            let sidecar_path = sidecar_dir.join(format!("{}.review.yaml", relative.display()));
            let json_sidecar_path =
                sidecar_dir.join(format!("{}.review.json", relative.display()));

            // TOCTOU defence: canonicalize whatever already exists and
            // verify containment inside workspace_root (already canonical).

            // Check YAML first, then JSON fallback
            if sidecar_path.exists() {
                return check_containment(&sidecar_path, workspace_root);
            } else if json_sidecar_path.exists() {
                return check_containment(&json_sidecar_path, workspace_root);
            }

            // Sidecar doesn't exist yet — try canonicalizing its parent.
            if let Some(parent) = sidecar_path.parent() {
                if parent.exists() {
                    let canon_parent = check_containment(parent, workspace_root)?;
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
    // Uses remove_dir (non-recursive) to avoid following symlinks and
    // deleting content outside the workspace.
    let parent_existed = parent.exists();

    std::fs::create_dir_all(parent)
        .map_err(|e| format!("failed to create sidecar dir '{}': {e}", parent.display()))?;

    let canonical_parent = match canonicalize_no_verbatim(parent) {
        Ok(p) => p,
        Err(e) => {
            if !parent_existed {
                let _ = std::fs::remove_dir(parent);
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
                let _ = std::fs::remove_dir(parent);
            }
            return Err(format!(
                "cannot canonicalize workspace root '{}': {e}",
                workspace_root.display()
            ));
        }
    };

    if !canonical_parent.starts_with(&canonical_ws) {
        if !parent_existed {
            let _ = std::fs::remove_dir(parent);
        }
        return Err(format!(
            "created dir '{}' resolves outside workspace root",
            parent.display()
        ));
    }

    Ok(())
}

/// Resolve the YAML and JSON sidecar paths for a source file, consulting
/// a workspace config. Routes through [`resolve_sidecar_for_file`] for
/// TOCTOU-safe canonicalization + containment checking.
///
/// Returns `(yaml_path, json_path, Option<workspace_root>)`. The third
/// element is `Some` when a redirected config is active — callers use it
/// to call [`ensure_sidecar_parent`] before writing.
pub fn resolve_sidecar_pair(
    file_path: &Path,
    config: Option<(&Path, &Option<PathBuf>)>,
) -> (String, String, Option<PathBuf>) {
    if let Some((ws_root, sidecar_root)) = config {
        match resolve_sidecar_for_file(ws_root, file_path, sidecar_root) {
            Ok(resolved) => {
                let resolved_str = resolved.to_string_lossy().into_owned();
                if resolved_str.ends_with(".review.json") {
                    let yaml = resolved_str.replace(".review.json", ".review.yaml");
                    return (yaml, resolved_str, Some(ws_root.to_path_buf()));
                }
                let json = resolved_str.replace(".review.yaml", ".review.json");
                return (resolved_str, json, Some(ws_root.to_path_buf()));
            }
            Err(e) => {
                tracing::warn!("[sidecar-config] path resolution failed, falling back to co-located: {e}");
            }
        }
    }
    let fp = file_path.to_string_lossy();
    (
        format!("{}.review.yaml", fp),
        format!("{}.review.json", fp),
        None,
    )
}

#[cfg(test)]
#[path = "paths_tests.rs"]
mod tests;
