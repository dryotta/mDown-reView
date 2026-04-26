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
        candidate
            .canonicalize()
            .map_err(|_| not_found_error(input, folder))?
    } else {
        let parent = candidate
            .parent()
            .ok_or_else(|| not_found_error(input, folder))?;
        let file_name = candidate
            .file_name()
            .ok_or_else(|| not_found_error(input, folder))?;
        let canonical_parent = parent
            .canonicalize()
            .map_err(|_| not_found_error(input, folder))?;
        canonical_parent.join(file_name)
    };

    if let Some(f) = folder {
        let canonical_folder = Path::new(f)
            .canonicalize()
            .map_err(|_| outside_root_error(input, f))?;
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
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    // ---- resolve_path --------------------------------------------------

    #[test]
    fn resolve_path_absolute_ignores_folder_and_cwd() {
        let abs = tempdir().unwrap();
        let abs_s = abs.path().to_string_lossy().to_string();
        let folder = tempdir().unwrap();
        let cwd = tempdir().unwrap();
        let r = resolve_path(&abs_s, Some(&folder.path().to_string_lossy()), cwd.path());
        assert_eq!(r, abs.path());
    }

    #[test]
    fn resolve_path_relative_uses_folder_when_present() {
        let folder = tempdir().unwrap();
        let cwd = tempdir().unwrap();
        let folder_s = folder.path().to_string_lossy().to_string();
        let r = resolve_path("foo.md", Some(&folder_s), cwd.path());
        assert_eq!(r, folder.path().join("foo.md"));
    }

    #[test]
    fn resolve_path_relative_falls_back_to_cwd() {
        let cwd = tempdir().unwrap();
        let r = resolve_path("foo.md", None, cwd.path());
        assert_eq!(r, cwd.path().join("foo.md"));
    }

    // ---- source_for_sidecar -------------------------------------------

    #[test]
    fn source_for_sidecar_strips_yaml_suffix() {
        assert_eq!(
            source_for_sidecar(Path::new("a/b/c.md.review.yaml")),
            Some(PathBuf::from("a/b/c.md")),
        );
    }

    #[test]
    fn source_for_sidecar_strips_json_suffix() {
        assert_eq!(
            source_for_sidecar(Path::new("c.md.review.json")),
            Some(PathBuf::from("c.md")),
        );
    }

    #[test]
    fn source_for_sidecar_returns_none_for_non_sidecar() {
        assert_eq!(source_for_sidecar(Path::new("c.md")), None);
    }

    // ---- resolve_sidecar ----------------------------------------------

    #[test]
    fn resolve_sidecar_finds_yaml_when_only_yaml_present() {
        let dir = tempdir().unwrap();
        let folder = dir.path();
        let yaml = folder.join("doc.md.review.yaml");
        fs::write(&yaml, "y").unwrap();
        let folder_s = folder.to_string_lossy().to_string();
        let r = resolve_sidecar("doc.md", Some(&folder_s), folder).unwrap();
        assert_eq!(r, yaml.canonicalize().unwrap());
    }

    #[test]
    fn resolve_sidecar_falls_back_to_json_when_only_json_present() {
        let dir = tempdir().unwrap();
        let folder = dir.path();
        let json = folder.join("doc.md.review.json");
        fs::write(&json, "j").unwrap();
        let folder_s = folder.to_string_lossy().to_string();
        let r = resolve_sidecar("doc.md", Some(&folder_s), folder).unwrap();
        assert_eq!(r, json.canonicalize().unwrap());
    }

    #[test]
    fn resolve_sidecar_prefers_yaml_when_both_present() {
        let dir = tempdir().unwrap();
        let folder = dir.path();
        let yaml = folder.join("doc.md.review.yaml");
        let json = folder.join("doc.md.review.json");
        fs::write(&yaml, "y").unwrap();
        fs::write(&json, "j").unwrap();
        let folder_s = folder.to_string_lossy().to_string();
        let r = resolve_sidecar("doc.md", Some(&folder_s), folder).unwrap();
        assert_eq!(r, yaml.canonicalize().unwrap());
    }

    #[test]
    fn resolve_sidecar_missing_errors_with_input_and_folder() {
        let dir = tempdir().unwrap();
        let folder = dir.path();
        let folder_s = folder.to_string_lossy().to_string();
        let err = resolve_sidecar("nope.md", Some(&folder_s), folder).unwrap_err();
        assert!(err.contains("nope.md"), "missing input in error: {err}");
        assert!(err.contains(&folder_s), "missing folder in error: {err}");
        assert!(err.contains("not found"), "unexpected error: {err}");
    }

    #[test]
    fn resolve_sidecar_rejects_dotdot_traversal() {
        let parent = tempdir().unwrap();
        let folder = parent.path().join("inner");
        fs::create_dir(&folder).unwrap();
        // sidecar lives outside `folder`, but inside `parent`
        let outside = parent.path().join("outside.md.review.yaml");
        fs::write(&outside, "x").unwrap();
        let folder_s = folder.to_string_lossy().to_string();
        let result = resolve_sidecar("../outside.md", Some(&folder_s), &folder);
        assert!(result.is_err(), "expected rejection, got {result:?}");
        let err = result.unwrap_err();
        assert!(
            err.contains("outside") || err.contains("not found"),
            "unexpected error message: {err}"
        );
    }

    #[test]
    fn resolve_sidecar_canonicalizes_parent_for_write_path() {
        let dir = tempdir().unwrap();
        let folder = dir.path();
        let folder_s = folder.to_string_lossy().to_string();
        // Sidecar does not yet exist; explicit suffix → write path.
        let r = resolve_sidecar("new.md.review.yaml", Some(&folder_s), folder).unwrap();
        let expected = folder.canonicalize().unwrap().join("new.md.review.yaml");
        assert_eq!(r, expected);
    }

    #[cfg(unix)]
    #[test]
    fn resolve_sidecar_rejects_symlink_escape_unix() {
        use std::os::unix::fs::symlink;
        let outside_dir = tempdir().unwrap();
        let outside_file = outside_dir.path().join("secret.md.review.yaml");
        fs::write(&outside_file, "secret").unwrap();
        let folder_dir = tempdir().unwrap();
        let folder = folder_dir.path();
        let link = folder.join("doc.md.review.yaml");
        symlink(&outside_file, &link).unwrap();
        let folder_s = folder.to_string_lossy().to_string();
        let err = resolve_sidecar("doc.md", Some(&folder_s), folder).unwrap_err();
        assert!(
            err.contains("outside") || err.contains("not found"),
            "unexpected error: {err}"
        );
    }

    #[cfg(windows)]
    #[test]
    fn resolve_sidecar_rejects_symlink_escape_windows() {
        use std::os::windows::fs::symlink_file;
        let outside_dir = tempdir().unwrap();
        let outside_file = outside_dir.path().join("secret.md.review.yaml");
        fs::write(&outside_file, "secret").unwrap();
        let folder_dir = tempdir().unwrap();
        let folder = folder_dir.path();
        let link = folder.join("doc.md.review.yaml");
        // Windows symlink creation requires SeCreateSymbolicLink (admin or
        // Developer Mode). If unavailable we skip — the unix variant
        // still exercises the security path on every CI run.
        if symlink_file(&outside_file, &link).is_err() {
            eprintln!("skipping: symlink_file requires Developer Mode / admin");
            return;
        }
        let folder_s = folder.to_string_lossy().to_string();
        let err = resolve_sidecar("doc.md", Some(&folder_s), folder).unwrap_err();
        assert!(
            err.contains("outside") || err.contains("not found"),
            "unexpected error: {err}"
        );
    }

    // ---- canonicalize_no_verbatim ------------------------------------

    #[test]
    fn canonicalize_no_verbatim_posix_passthrough() {
        // On any platform, canonicalizing a real tempdir succeeds and
        // returns an absolute path. On non-Windows this matches std
        // exactly; the assertion below is the cross-platform invariant.
        let dir = tempdir().unwrap();
        let canon = canonicalize_no_verbatim(dir.path()).unwrap();
        assert!(canon.is_absolute());
        assert!(canon.exists());
    }

    #[cfg(windows)]
    #[test]
    fn canonicalize_no_verbatim_strips_disk_verbatim_prefix() {
        // `dunce` rewrites `\\?\C:\…` to `C:\…` whenever the bare form
        // resolves to the same file. Synthesize the verbatim form by
        // calling std::fs first, then assert dunce strips it.
        let dir = tempdir().unwrap();
        let std_canon = std::fs::canonicalize(dir.path()).unwrap();
        let std_str = std_canon.to_string_lossy();
        // Sanity: std really did emit the verbatim form on this host.
        assert!(
            std_str.starts_with(r"\\?\"),
            "expected std::fs::canonicalize to produce verbatim form on Windows, got {std_str}"
        );
        let bare = canonicalize_no_verbatim(dir.path()).unwrap();
        let bare_str = bare.to_string_lossy();
        assert!(
            !bare_str.starts_with(r"\\?\"),
            "expected non-verbatim form, got {bare_str}"
        );
    }

    #[cfg(windows)]
    #[test]
    fn canonicalize_no_verbatim_strips_unc_verbatim_prefix() {
        // We can't reliably create `\\?\UNC\…` paths in a test (would need
        // a real UNC share), so feed dunce a synthetic `\\?\UNC\…` string
        // pointing at a real local dir via its disk form is impossible.
        // Instead, exercise the explicit string-rewrite contract: passing
        // a `\\?\UNC\` path must NOT emit a verbatim result when the bare
        // `\\srv\share` form would mean the same thing. dunce's contract
        // is documented: any UNC verbatim it can simplify, it does.
        // We assert the API surface: a string that already has `\\?\UNC\`
        // and points nowhere yields an Err (file-not-found) — i.e. we
        // never panic, and we never silently strip into a wrong path.
        let bogus = std::path::PathBuf::from(r"\\?\UNC\nonexistent-host\share\file");
        let res = canonicalize_no_verbatim(&bogus);
        assert!(res.is_err(), "expected Err on nonexistent UNC, got {res:?}");
    }

    #[cfg(windows)]
    #[test]
    fn canonicalize_no_verbatim_long_path_does_not_panic() {
        // A path long enough that no non-verbatim form is possible
        // (>260 chars). dunce's contract is that it falls back to the
        // verbatim form rather than panicking; we don't care which form
        // we get, only that the call succeeds without unwinding.
        let dir = tempdir().unwrap();
        let mut deep = dir.path().to_path_buf();
        // 30 segments of 10 chars each → ~300 chars beyond the tempdir root.
        for i in 0..30 {
            deep = deep.join(format!("seg-{:04}-x", i));
        }
        std::fs::create_dir_all(&deep).unwrap();
        // Must not panic. On hosts where the dir resolves to a path
        // shorter than MAX_PATH (rare with this many segments) dunce
        // returns the bare form; otherwise it returns the verbatim form.
        let _ = canonicalize_no_verbatim(&deep).expect("long-path canonicalize must succeed");
    }
}
