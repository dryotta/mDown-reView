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


#[cfg(test)]
#[path = "paths_tests.rs"]
mod tests;
