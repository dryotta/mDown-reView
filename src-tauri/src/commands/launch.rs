//! Launch-time and diagnostic commands (CLI args, log path, file scanner).

use crate::mdr_command;
#[cfg(debug_assertions)]
use super::is_sidecar_file;
use crate::core::paths::canonicalize_no_verbatim;
use crate::core::types::LaunchArgs;
use std::path::Path;
use tauri::Manager;

/// Parse the process-global `--trace` flag out of the raw argv.
///
/// Recognized forms (the **only** flag this function inspects — every other
/// argument is ignored, since they are owned by the per-window
/// [`parse_launch_args`] parser):
///
/// * `--trace`        → `Some(true)` (presence implies on)
/// * `--trace=on`     → `Some(true)`   |  `--trace=off`   → `Some(false)`
/// * `--trace=true`   → `Some(true)`   |  `--trace=false` → `Some(false)`
/// * `--trace=1`      → `Some(true)`   |  `--trace=0`     → `Some(false)`
///
/// Returns `None` when the flag is absent. Caller applies the precedence
/// chain (CLI > env > cfg) — see `lib.rs::run`.
///
/// Per-launch only: a second-instance forward does **not** call this — the
/// running process keeps the gate state set at its own boot. This matches
/// the user mental model that `--trace` configures *how this launch boots*,
/// not "switch the running app's tracing." If live toggling is ever needed,
/// add a setter IPC backed by [`crate::startup_recorder::set_ipc_trace_enabled`].
///
/// Trace is process-global, so it intentionally does **not** live on
/// [`LaunchArgs`] (which is per-window).
pub fn parse_trace_flag(args: &[String]) -> Option<bool> {
    for arg in args {
        if arg == "--trace" {
            return Some(true);
        }
        if let Some(value) = arg.strip_prefix("--trace=") {
            return match value.to_ascii_lowercase().as_str() {
                "on" | "true" | "1" | "yes" => Some(true),
                "off" | "false" | "0" | "no" => Some(false),
                // Unknown value: treat as if the flag were absent so we
                // fall through to the env / cfg precedence rather than
                // silently picking the wrong default. A warning would
                // be ideal but we have no logger yet at this call site.
                _ => None,
            };
        }
    }
    None
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
/// (anything starting with `-` other than `--folder`/`--file`) are ignored —
/// in particular, the process-global `--trace[=…]` flag (parsed by
/// [`parse_trace_flag`]) is silently skipped here.
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
#[mdr_command]
pub async fn get_launch_args(
    window: tauri::Window,
    registry: tauri::State<'_, crate::registry::WindowRegistry>,
) -> Result<LaunchArgs, String> {
    Ok(registry.drain_args(window.label()))
}

/// Get the log file path for display in the About dialog.
#[mdr_command]
pub fn get_log_path(app: tauri::AppHandle) -> Result<String, String> {
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    Ok(log_dir
        .join("mdownreview.log")
        .to_string_lossy()
        .into_owned())
}

/// Scan a directory tree for MRSF sidecar files (delegates to core::scanner).
///
/// Honours the workspace's `.mrsf.yaml` redirect so sidecars stored
/// under e.g. `.reviews/` are mapped back to their real source location
/// instead of being incorrectly flagged as ghosts. Both the GUI IPC
/// and the CLI go through [`crate::core::scanner::scan_workspace`] for
/// identical `(sidecar, source)` output.
#[mdr_command]
pub fn scan_review_files(root: String) -> Result<Vec<(String, String)>, String> {
    Ok(crate::core::scanner::scan_workspace(&root, 10_000))
}

/// Test-only command: open a folder and all its non-sidecar files via args-received.
#[cfg(debug_assertions)]
#[mdr_command]
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

    // Rule multiwin-window-scoped-events: AppHandle::emit_to scopes
    // delivery to the "main" window without needing a window handle —
    // emit_to is a no-op if the target doesn't exist, no `if let
    // Some(window) = …` lookup needed.
    app.emit_to("main", "args-received", ())
        .map_err(|e| e.to_string())?;

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

    // ── parse_trace_flag tests ────────────────────────────────────────────

    #[test]
    fn trace_flag_absent_returns_none() {
        assert_eq!(parse_trace_flag(&[]), None);
        assert_eq!(parse_trace_flag(&[s("--folder"), s("/tmp")]), None);
        assert_eq!(parse_trace_flag(&[s("foo.md"), s("bar.md")]), None);
    }

    #[test]
    fn trace_flag_bare_implies_on() {
        assert_eq!(parse_trace_flag(&[s("--trace")]), Some(true));
        // Mixed with file / folder args, regardless of order.
        assert_eq!(
            parse_trace_flag(&[s("--folder"), s("/tmp"), s("--trace"), s("a.md")]),
            Some(true)
        );
    }

    #[test]
    fn trace_flag_kv_on_variants_are_true() {
        for v in ["on", "true", "1", "yes", "ON", "True", "YES"] {
            let arg = format!("--trace={v}");
            assert_eq!(parse_trace_flag(&[arg.clone()]), Some(true), "arg={arg}");
        }
    }

    #[test]
    fn trace_flag_kv_off_variants_are_false() {
        for v in ["off", "false", "0", "no", "OFF", "False", "NO"] {
            let arg = format!("--trace={v}");
            assert_eq!(parse_trace_flag(&[arg.clone()]), Some(false), "arg={arg}");
        }
    }

    /// An unrecognized value falls back to `None` so the caller's
    /// precedence chain (env / cfg) kicks in — better than guessing.
    #[test]
    fn trace_flag_unknown_value_returns_none() {
        assert_eq!(parse_trace_flag(&[s("--trace=maybe")]), None);
        assert_eq!(parse_trace_flag(&[s("--trace=")]), None);
    }

    /// First `--trace` wins. Catches accidental duplication in a wrapper
    /// script; the user's first-stated intent is kept.
    #[test]
    fn trace_flag_first_match_wins() {
        assert_eq!(
            parse_trace_flag(&[s("--trace=on"), s("--trace=off")]),
            Some(true)
        );
        assert_eq!(
            parse_trace_flag(&[s("--trace=off"), s("--trace=on")]),
            Some(false)
        );
    }

    /// `parse_launch_args` must continue to treat `--trace[=...]` as an
    /// unknown flag (silently skipped). Regression guard for the
    /// "trace flag pollutes file/folder parsing" failure mode.
    #[test]
    fn launch_args_ignore_trace_flag() {
        let cwd = tempdir().unwrap();
        fs::write(cwd.path().join("foo.md"), "x").unwrap();

        let with_trace = parse_launch_args(
            &[s("--trace=on"), s("foo.md"), s("--trace")],
            cwd.path(),
        );
        let without_trace = parse_launch_args(&[s("foo.md")], cwd.path());

        assert_eq!(with_trace.files, without_trace.files);
        assert_eq!(with_trace.folders, without_trace.folders);
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
