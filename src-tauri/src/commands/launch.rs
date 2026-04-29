//! Launch-time and diagnostic commands (CLI args, log path, file scanner).

#[cfg(debug_assertions)]
use super::is_sidecar_file;
use crate::core::paths::canonicalize_no_verbatim;
use crate::core::types::LaunchArgs;
use std::path::Path;
use tauri::Manager;

/// Parse CLI-style launch arguments into a `LaunchArgs` struct.
///
/// Supports `--folder <path>`, `--file <path>`, and positional auto-detect
/// (positional dirs become folders, positional files become files). Two-pass:
///   1. Collect every `--folder` value, canonicalize against `cwd`.
///   2. Resolve `--file` and positional paths against the **first** collected
///      folder (if any) — otherwise against `cwd`. Absolute paths bypass this
///      base and are canonicalized as-is.
///
/// Non-existent paths are silently dropped (canonicalize fails). Unknown flags
/// (anything starting with `-` other than `--folder`/`--file`) are ignored.
pub fn parse_launch_args(args: &[String], cwd: &Path) -> LaunchArgs {
    let mut folders: Vec<String> = Vec::new();
    let mut files: Vec<String> = Vec::new();

    // ── Pass 1: collect --folder values ───────────────────────────────────
    let mut i = 0;
    while i < args.len() {
        if args[i] == "--folder" {
            i += 1;
            if let Some(val) = args.get(i) {
                let resolved = crate::core::paths::resolve_path(val, None, cwd);
                if let Ok(canon) = canonicalize_no_verbatim(&resolved) {
                    folders.push(canon.to_string_lossy().into_owned());
                }
            }
        }
        i += 1;
    }

    // Resolution base for relative --file / positional values: first --folder, else cwd.
    let folder_owned: Option<String> = folders.first().cloned();
    let folder_opt: Option<&str> = folder_owned.as_deref();

    // ── Pass 2: resolve --file and positionals against `folder_opt` ───────
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        if arg == "--folder" {
            i += 2; // already handled
            continue;
        }
        if arg == "--file" {
            i += 1;
            if let Some(val) = args.get(i) {
                let resolved = crate::core::paths::resolve_path(val, folder_opt, cwd);
                if let Ok(canon) = canonicalize_no_verbatim(&resolved) {
                    files.push(canon.to_string_lossy().into_owned());
                }
            }
        } else if !arg.starts_with('-') {
            let resolved = crate::core::paths::resolve_path(arg, folder_opt, cwd);
            if let Ok(canon) = canonicalize_no_verbatim(&resolved) {
                match std::fs::metadata(&canon) {
                    Ok(meta) if meta.is_dir() => folders.push(canon.to_string_lossy().into_owned()),
                    Ok(_) => files.push(canon.to_string_lossy().into_owned()),
                    Err(_) => {}
                }
            }
        }
        i += 1;
    }

    LaunchArgs { files, folders }
}

/// Get (and drain) launch args queued for the calling window.
#[tauri::command]
pub async fn get_launch_args(
    window: tauri::Window,
    registry: tauri::State<'_, crate::registry::WindowRegistry>,
) -> Result<LaunchArgs, String> {
    Ok(registry.drain_args(window.label()))
}

/// Get the log file path for display in the About dialog.
#[tauri::command]
pub fn get_log_path(app: tauri::AppHandle) -> Result<String, String> {
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    Ok(log_dir
        .join("mdownreview.log")
        .to_string_lossy()
        .into_owned())
}

/// Scan a directory tree for MRSF sidecar files (delegates to core::scanner).
///
/// Honours the workspace's `sidecar_root` redirect (if a `.mrsf.yaml`
/// has been registered for `root` via `SidecarConfigState`) so sidecars
/// stored under e.g. `.reviews/` are mapped back to their real source
/// location instead of being incorrectly flagged as ghosts.
#[tauri::command]
pub fn scan_review_files(
    root: String,
    config_state: tauri::State<'_, crate::watcher::SidecarConfigState>,
) -> Result<Vec<(String, String)>, String> {
    Ok(scan_review_files_inner(root, &config_state))
}

/// Inner implementation, decoupled from `tauri::State` so unit/integration
/// tests can construct a plain `SidecarConfigState` and call this directly.
pub fn scan_review_files_inner(
    root: String,
    config_state: &crate::watcher::SidecarConfigState,
) -> Vec<(String, String)> {
    let sidecar_root = config_state
        .resolve_for_file(std::path::Path::new(&root))
        .and_then(|(_, sr)| sr);
    crate::core::scanner::find_review_files_with_config(&root, 10_000, sidecar_root.as_deref())
}

/// Test-only command: open a folder and all its non-sidecar files via args-received.
#[cfg(debug_assertions)]
#[tauri::command]
pub fn set_root_via_test(path: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri::{Emitter, Manager};

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

    let launch_args = LaunchArgs {
        files,
        folders: vec![path],
    };

    let reg = app.state::<crate::registry::WindowRegistry>();
    reg.push_args("main", launch_args);

    if let Some(window) = app.get_webview_window("main") {
        window
            .emit("args-received", ())
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    /// Canonicalize via the shared no-verbatim helper so test expectations
    /// share form with what `parse_launch_args` itself emits.
    fn canon(p: impl AsRef<Path>) -> String {
        canonicalize_no_verbatim(p.as_ref())
            .unwrap()
            .to_string_lossy()
            .into_owned()
    }

    fn s(v: &str) -> String {
        v.to_string()
    }

    #[test]
    fn folder_then_relative_positional_resolves_under_folder() {
        let proj = tempdir().unwrap();
        let cwd = tempdir().unwrap();
        fs::create_dir_all(proj.path().join("relative")).unwrap();
        fs::write(proj.path().join("relative/file.md"), "x").unwrap();

        let args = vec![
            s("--folder"),
            s(proj.path().to_str().unwrap()),
            s("relative/file.md"),
        ];
        let out = parse_launch_args(&args, cwd.path());

        assert_eq!(out.folders, vec![canon(proj.path())]);
        assert_eq!(out.files, vec![canon(proj.path().join("relative/file.md"))]);
    }

    #[test]
    fn order_insensitive_positional_then_folder() {
        let proj = tempdir().unwrap();
        let cwd = tempdir().unwrap();
        fs::create_dir_all(proj.path().join("relative")).unwrap();
        fs::write(proj.path().join("relative/file.md"), "x").unwrap();

        let a = parse_launch_args(
            &[
                s("--folder"),
                s(proj.path().to_str().unwrap()),
                s("relative/file.md"),
            ],
            cwd.path(),
        );
        let b = parse_launch_args(
            &[
                s("relative/file.md"),
                s("--folder"),
                s(proj.path().to_str().unwrap()),
            ],
            cwd.path(),
        );
        assert_eq!(a.files, b.files);
        assert_eq!(a.folders, b.folders);
    }

    #[test]
    fn file_flag_with_folder_resolves_under_folder() {
        let proj = tempdir().unwrap();
        let cwd = tempdir().unwrap();
        fs::write(proj.path().join("doc.md"), "x").unwrap();

        let args = vec![
            s("--file"),
            s("doc.md"),
            s("--folder"),
            s(proj.path().to_str().unwrap()),
        ];
        let out = parse_launch_args(&args, cwd.path());
        assert_eq!(out.folders, vec![canon(proj.path())]);
        assert_eq!(out.files, vec![canon(proj.path().join("doc.md"))]);
    }

    #[test]
    fn absolute_positional_ignores_folder() {
        let proj = tempdir().unwrap();
        let other = tempdir().unwrap();
        let cwd = tempdir().unwrap();
        let abs_file = other.path().join("abs.md");
        fs::write(&abs_file, "x").unwrap();

        let args = vec![
            s("--folder"),
            s(proj.path().to_str().unwrap()),
            s(abs_file.to_str().unwrap()),
        ];
        let out = parse_launch_args(&args, cwd.path());
        assert_eq!(out.folders, vec![canon(proj.path())]);
        assert_eq!(out.files, vec![canon(&abs_file)]);
    }

    #[test]
    fn no_folder_resolves_against_cwd() {
        let cwd = tempdir().unwrap();
        fs::write(cwd.path().join("local.md"), "x").unwrap();

        let out = parse_launch_args(&[s("local.md")], cwd.path());
        assert!(out.folders.is_empty());
        assert_eq!(out.files, vec![canon(cwd.path().join("local.md"))]);
    }

    #[test]
    fn nonexistent_path_silently_dropped() {
        let cwd = tempdir().unwrap();
        let out = parse_launch_args(&[s("does-not-exist.md")], cwd.path());
        assert!(out.files.is_empty());
        assert!(out.folders.is_empty());
    }

    /// Verifies parse_launch_args delegates to core::paths::resolve_path for
    /// --file resolution: the resolved (canonical) path matches what the
    /// shared helper produces. Note: foo.md is created so canonicalize
    /// succeeds — resolve_path itself does not require existence, but the
    /// surrounding canonicalize step in parse_launch_args does.
    #[test]
    fn parse_launch_args_delegates_to_resolve_path() {
        let proj = tempdir().unwrap();
        let cwd = tempdir().unwrap();
        fs::write(proj.path().join("foo.md"), "x").unwrap();

        let args = vec![
            s("--file"),
            s("foo.md"),
            s("--folder"),
            s(proj.path().to_str().unwrap()),
        ];
        let out = parse_launch_args(&args, cwd.path());

        let folder_str = canon(proj.path());
        let expected =
            crate::core::paths::resolve_path("foo.md", Some(folder_str.as_str()), cwd.path());
        let expected_canon = canonicalize_no_verbatim(&expected)
            .unwrap()
            .to_string_lossy()
            .into_owned();

        assert_eq!(out.files, vec![expected_canon]);
    }

    #[test]
    fn parse_launch_args_handles_many_positional_files() {
        let cwd = tempdir().unwrap();
        let names = [
            "a.md", "b.md", "c.md", "d.md", "e.md", "f.md", "g.md", "h.md", "i.md", "j.md",
        ];
        for n in &names {
            fs::write(cwd.path().join(n), "x").unwrap();
        }
        let args: Vec<String> = names.iter().map(|n| s(n)).collect();
        let out = parse_launch_args(&args, cwd.path());

        let expected: Vec<String> = names.iter().map(|n| canon(cwd.path().join(n))).collect();
        assert_eq!(out.files.len(), 10);
        assert_eq!(out.files, expected);
    }
}
