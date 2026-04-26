//! Launch-time and diagnostic commands (CLI args, log path, file scanner).

#[cfg(debug_assertions)]
use super::is_sidecar_file;
use crate::core::types::LaunchArgs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};

/// FIFO queue of launch arg batches that arrived before the frontend asked for them.
///
/// Each `RunEvent::Opened` (macOS), single-instance callback, and the initial
/// `setup()` call pushes one batch. `get_launch_args` drains and merges them.
/// A queue (rather than `Option<LaunchArgs>`) prevents fast successive opens
/// from clobbering each other before the frontend has polled.
pub type PendingArgsState = Arc<Mutex<Vec<LaunchArgs>>>;

/// Append a batch of launch args to the pending queue.
pub fn push_pending(state: &PendingArgsState, args: LaunchArgs) {
    if let Ok(mut guard) = state.lock() {
        guard.push(args);
    } else {
        log::error!("[rust] push_pending: PendingArgsState lock poisoned");
    }
}

/// Drain the pending queue, returning a single merged `LaunchArgs`.
///
/// Concatenates `files` and `folders` from every queued batch in FIFO order,
/// deduplicating by string identity while preserving first-seen order. An
/// empty queue yields `LaunchArgs { files: vec![], folders: vec![] }`.
pub fn drain_pending(state: &PendingArgsState) -> LaunchArgs {
    let batches: Vec<LaunchArgs> = match state.lock() {
        Ok(mut guard) => std::mem::take(&mut *guard),
        Err(e) => {
            log::error!(
                "[rust] drain_pending: PendingArgsState lock poisoned: {}",
                e
            );
            return LaunchArgs::default();
        }
    };

    let mut files: Vec<String> = Vec::new();
    let mut folders: Vec<String> = Vec::new();
    for batch in batches {
        for f in batch.files {
            if !files.iter().any(|x| x == &f) {
                files.push(f);
            }
        }
        for d in batch.folders {
            if !folders.iter().any(|x| x == &d) {
                folders.push(d);
            }
        }
    }
    LaunchArgs { files, folders }
}

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
                if let Ok(canon) = std::fs::canonicalize(&resolved) {
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
                if let Ok(canon) = std::fs::canonicalize(&resolved) {
                    files.push(canon.to_string_lossy().into_owned());
                }
            }
        } else if !arg.starts_with('-') {
            let resolved = crate::core::paths::resolve_path(arg, folder_opt, cwd);
            if let Ok(canon) = std::fs::canonicalize(&resolved) {
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

/// Get (and drain) launch args queued since the last call.
#[tauri::command]
pub async fn get_launch_args(state: State<'_, PendingArgsState>) -> Result<LaunchArgs, String> {
    Ok(drain_pending(&state))
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

    let launch_args = LaunchArgs {
        files,
        folders: vec![path],
    };

    let pending = app.state::<PendingArgsState>();
    push_pending(&pending, launch_args);

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

    /// Canonicalize via std so test expectations match (handles Windows `\\?\` prefix).
    fn canon(p: impl AsRef<Path>) -> String {
        fs::canonicalize(p).unwrap().to_string_lossy().into_owned()
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

    #[test]
    fn queue_merges_and_dedupes_preserving_order() {
        let state: PendingArgsState = Arc::new(Mutex::new(Vec::new()));
        push_pending(
            &state,
            LaunchArgs {
                files: vec![s("/a"), s("/b")],
                folders: vec![s("/x")],
            },
        );
        push_pending(
            &state,
            LaunchArgs {
                files: vec![s("/b"), s("/c")],
                folders: vec![s("/x"), s("/y")],
            },
        );
        push_pending(
            &state,
            LaunchArgs {
                files: vec![s("/d")],
                folders: vec![],
            },
        );

        let merged = drain_pending(&state);
        assert_eq!(merged.files, vec![s("/a"), s("/b"), s("/c"), s("/d")]);
        assert_eq!(merged.folders, vec![s("/x"), s("/y")]);

        // Queue is empty after drain.
        let empty = drain_pending(&state);
        assert!(empty.files.is_empty() && empty.folders.is_empty());
    }

    #[test]
    fn drain_empty_queue_returns_empty_launch_args() {
        let state: PendingArgsState = Arc::new(Mutex::new(Vec::new()));
        let out = drain_pending(&state);
        assert!(out.files.is_empty());
        assert!(out.folders.is_empty());
    }

    /// Regression for lib.rs:310 clobber bug: two consecutive pushes must
    /// retain BOTH batches' files. Before the fix `RunEvent::Opened` did
    /// `*guard = Some(...)`, which dropped the prior pending batch.
    #[test]
    fn regression_two_pushes_both_retained() {
        let state: PendingArgsState = Arc::new(Mutex::new(Vec::new()));
        push_pending(
            &state,
            LaunchArgs {
                files: vec![s("/first.md")],
                folders: vec![],
            },
        );
        push_pending(
            &state,
            LaunchArgs {
                files: vec![s("/second.md")],
                folders: vec![],
            },
        );

        let merged = drain_pending(&state);
        assert!(
            merged.files.contains(&s("/first.md")),
            "first batch lost (clobber regression): {:?}",
            merged.files
        );
        assert!(
            merged.files.contains(&s("/second.md")),
            "second batch missing: {:?}",
            merged.files
        );
        assert_eq!(merged.files.len(), 2);
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
        let expected_canon = fs::canonicalize(&expected)
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
