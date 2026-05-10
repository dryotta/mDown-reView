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

/// Reject a path component containing `:` (NTFS Alternate Data Stream).
///
/// On Windows the colon at index 1 of an absolute path is the drive
/// separator (e.g. `C:\…`), which is legitimate; any colon elsewhere
/// in any component is the ADS marker. The check is OS-agnostic so a
/// macOS / Linux user dropping a file named `report.md:hidden` (rare
/// but legal on those filesystems) is also rejected — the
/// canonicalisation that follows would normalise the bytes, but the
/// renderer's `read_text_file` chokepoint would happily read the ADS
/// stream on Windows. Symmetric with the write-side guard in
/// `commands::fs_write::ensure_writable` (rule 29(a) in `docs/security.md`).
///
/// Returns `true` when the path is safe to pass to `canonicalize` /
/// `metadata`; `false` when an ADS marker is present.
fn path_has_no_ads(s: &str) -> bool {
    // Strip a leading `<drive>:` (e.g. `C:`) — that single colon at
    // index 1 of an absolute Windows path is the drive separator,
    // not ADS.
    let rest = if cfg!(windows)
        && s.len() >= 2
        && s.as_bytes()[1] == b':'
        && s.as_bytes()[0].is_ascii_alphabetic()
    {
        &s[2..]
    } else {
        s
    };
    !rest.contains(':')
}

/// If `p` is a sidecar (`*.review.yaml` / `*.review.json`) and the
/// source file it annotates exists on disk, redirect to the source.
/// Otherwise return `p` unchanged. Drops of a sidecar file are a
/// common workflow gesture (agents place sidecars next to source files;
/// the user drops the sidecar to "open the review") — this redirect
/// surfaces the reviewed source instead of the raw YAML/JSON, with the
/// reviewed comments rendered via the standard MarkdownViewer/SourceView.
///
/// Falls through transparently for non-sidecar paths.
fn redirect_sidecar_to_source(p: std::path::PathBuf) -> std::path::PathBuf {
    if let Some(source) = crate::core::paths::source_for_sidecar(&p) {
        if source.exists() {
            return source;
        }
    }
    p
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
/// **Sidecar redirect** — any path that resolves to an existing
/// `*.review.yaml` / `*.review.json` is silently mapped to its source
/// file (when the source exists). Drag-drop, CLI launch, and OS
/// file-open all benefit. See [`redirect_sidecar_to_source`].
///
/// **NTFS Alternate Data Stream rejection** — any path containing a `:`
/// outside the Windows drive-letter prefix is silently dropped. Mirrors
/// the write-side guard in `commands::fs_write::ensure_writable` (rule
/// 29(a) in `docs/security.md`); review of PR #372 (security M1) flagged
/// the read/write asymmetry.
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
                if !path_has_no_ads(val) {
                    log::warn!("[launch] rejecting NTFS-ADS path: {val}");
                } else {
                    let resolved = crate::core::paths::resolve_path(val, None, cwd);
                    if let Ok(canon) = canonicalize_no_verbatim(&resolved) {
                        folders.push(canon.to_string_lossy().into_owned());
                    }
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
                if !path_has_no_ads(val) {
                    log::warn!("[launch] rejecting NTFS-ADS path: {val}");
                } else {
                    let resolved = crate::core::paths::resolve_path(val, folder_opt, cwd);
                    if let Ok(canon) = canonicalize_no_verbatim(&resolved) {
                        let final_path = redirect_sidecar_to_source(canon);
                        files.push(final_path.to_string_lossy().into_owned());
                    }
                }
            }
        } else if !arg.starts_with('-') {
            if !path_has_no_ads(arg) {
                log::warn!("[launch] rejecting NTFS-ADS path: {arg}");
            } else {
                let resolved = crate::core::paths::resolve_path(arg, folder_opt, cwd);
                if let Ok(canon) = canonicalize_no_verbatim(&resolved) {
                    match std::fs::metadata(&canon) {
                        Ok(meta) if meta.is_dir() => folders.push(canon.to_string_lossy().into_owned()),
                        Ok(_) => {
                            let final_path = redirect_sidecar_to_source(canon);
                            files.push(final_path.to_string_lossy().into_owned());
                        }
                        Err(_) => {}
                    }
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

    // Canonicalize BEFORE `path` is moved into `launch_args`. Issue #338 /
    // iter-1 forward-fix: extend the asset-protocol scope and seed the
    // watcher's tree-watched-dirs synchronously so the renderer's initial
    // `read_text_file` / `read_binary_file` IPC drained on `args-received`
    // passes the workspace guard. Without this, native E2E tests that rely
    // on `set_root_via_test` get rejected by `ensure_readable` before
    // `useTreeWatcher` round-trips. Failure to canonicalize is
    // logged-and-tolerated (Reliable pillar).
    let canonical_folder = crate::core::paths::canonicalize_no_verbatim(folder).map_err(|e| {
        tracing::warn!(
            target: "window-scope",
            "[window-scope] set_root_via_test canonicalize {} failed: {e}",
            folder.display()
        );
        e
    });

    let launch_args = LaunchArgs {
        files,
        folders: vec![path],
    };

    let reg = app.state::<crate::registry::WindowRegistry>();
    reg.push_args("main", launch_args);

    // Issue #338 / iter-1: extend asset-protocol scope and seed
    // watcher's tree-watched-dirs synchronously via the window_scope
    // chokepoint. Folder kind is recursive; logged-and-tolerated on
    // canonicalize failure.
    if let Ok(canonical) = canonical_folder {
        crate::window_scope::extend_window_scope(&app, "main", crate::window_scope::ScopeGrant::Folder(canonical));
    }

    // Rule multiwin-window-scoped-events: AppHandle::emit_to scopes
    // delivery to the "main" window without needing a window handle —
    // emit_to is a no-op if the target doesn't exist, no `if let
    // Some(window) = …` lookup needed.
    app.emit_to("main", "args-received", ())
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Test-only command: forward an outside-file open through the args-received
/// chokepoint so the renderer's `useLaunchArgsBootstrap` drains via
/// `getLaunchArgs()` and dispatches `store.openFile(path)`. This mirrors the
/// CLI / OS file-open path (`route_args_through_registry` AddToWindow arm
/// for FilesParents) that production uses for outside files; the native
/// E2E uses this debug-only IPC because it cannot spawn a second binary
/// instance from a Playwright test.
///
/// Differs from `set_root_via_test`:
///   - takes a single FILE path, not a folder
///   - does NOT extend asset-protocol scope (mirrors `register_window_file`'s
///     watcher-only contract — banner opt-in via `extend_window_scope_files`
///     remains the asset-scope chokepoint)
///   - does NOT call `extend_window_scope` (no scope grant — the renderer's
///     subsequent `register_window_file` IPC handles the watcher-allowlist
///     seed via `seed_window_file`)
///
/// Cite: docs/security.md rule 17 (asset-scope vs watcher-allowlist split);
///       docs/architecture.md rule 11 (launch args queue chokepoint).
#[cfg(debug_assertions)]
#[mdr_command]
pub fn open_file_via_test(path: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Emitter;

    let launch_args = LaunchArgs {
        files: vec![path],
        folders: vec![],
    };

    let reg = app.state::<crate::registry::WindowRegistry>();
    reg.push_args("main", launch_args);

    app.emit_to("main", "args-received", ())
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Test-only IPC clearing all per-window scope state for the calling
/// window. Used by `e2e/native/fixtures.ts`'s `nativePage` fixture so
/// each spec starts with an empty `tree_watched_dirs` precondition,
/// closing the cross-spec state-leak surface that produced #366.
///
/// `#[cfg(debug_assertions)]`-gated — release builds do not register
/// this command at all. Mirrors `set_root_via_test` (line 153-224).
///
/// Cite: docs/security.md rule 20 (debug-only IPC gate).
#[cfg(debug_assertions)]
#[mdr_command]
pub fn reset_window_scope_for_test(window: tauri::Window) -> Result<(), String> {
    use tauri::Manager;
    let app = window.app_handle();
    crate::window_scope::reset_window_scope(app, window.label());
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

    // ── PR #372 review fixes ──────────────────────────────────────────────

    /// D5 (product-expert) — dropping `foo.md.review.yaml` should open
    /// the SOURCE `foo.md`, not the raw YAML, when the source exists.
    #[test]
    fn parse_launch_args_redirects_yaml_sidecar_to_source() {
        let cwd = tempdir().unwrap();
        fs::write(cwd.path().join("foo.md"), "source").unwrap();
        fs::write(cwd.path().join("foo.md.review.yaml"), "y").unwrap();

        let out = parse_launch_args(&[s(cwd.path().join("foo.md.review.yaml").to_str().unwrap())], cwd.path());
        assert_eq!(out.files, vec![canon(cwd.path().join("foo.md"))]);
    }

    /// D5 — `.review.json` legacy sidecar form gets the same redirect.
    #[test]
    fn parse_launch_args_redirects_json_sidecar_to_source() {
        let cwd = tempdir().unwrap();
        fs::write(cwd.path().join("foo.md"), "source").unwrap();
        fs::write(cwd.path().join("foo.md.review.json"), "y").unwrap();

        let out = parse_launch_args(&[s(cwd.path().join("foo.md.review.json").to_str().unwrap())], cwd.path());
        assert_eq!(out.files, vec![canon(cwd.path().join("foo.md"))]);
    }

    /// D5 — orphan sidecar (source missing) opens as the sidecar
    /// itself; the user gets to see the YAML which is at least
    /// recoverable via Save As. Silent failure would be worse.
    #[test]
    fn parse_launch_args_keeps_orphan_sidecar() {
        let cwd = tempdir().unwrap();
        fs::write(cwd.path().join("foo.md.review.yaml"), "y").unwrap();
        // foo.md does NOT exist.

        let out = parse_launch_args(&[s(cwd.path().join("foo.md.review.yaml").to_str().unwrap())], cwd.path());
        assert_eq!(out.files, vec![canon(cwd.path().join("foo.md.review.yaml"))]);
    }

    /// D5 — non-sidecar paths pass through unchanged.
    #[test]
    fn parse_launch_args_non_sidecar_unchanged() {
        let cwd = tempdir().unwrap();
        fs::write(cwd.path().join("notes.md"), "x").unwrap();

        let out = parse_launch_args(&[s("notes.md")], cwd.path());
        assert_eq!(out.files, vec![canon(cwd.path().join("notes.md"))]);
    }

    /// S5 (security-expert) — NTFS Alternate Data Stream rejection.
    /// Symmetric with the write-side guard in
    /// `commands::fs_write::ensure_writable` (rule 29(a) in
    /// `docs/security.md`).
    #[test]
    #[cfg(windows)]
    fn parse_launch_args_rejects_ntfs_ads_path() {
        let cwd = tempdir().unwrap();
        fs::write(cwd.path().join("foo.md"), "x").unwrap();

        // The drive-letter colon at index 1 is NOT ADS; only colons
        // beyond it are. Constructing an actual ADS path on disk is
        // platform-/perm-dependent, but `parse_launch_args` rejects
        // BEFORE canonicalize so a string-only check is sufficient.
        let absolute = cwd.path().join("foo.md");
        let mut ads = absolute.to_string_lossy().into_owned();
        ads.push_str(":hidden");
        let out = parse_launch_args(&[ads.clone()], cwd.path());
        assert!(out.files.is_empty(), "ADS path {ads:?} should be rejected; got {out:?}");
    }

    /// S5 — drive-letter colon (e.g. `C:\foo`) MUST NOT be rejected as ADS.
    #[test]
    #[cfg(windows)]
    fn parse_launch_args_accepts_drive_letter_colon() {
        let cwd = tempdir().unwrap();
        fs::write(cwd.path().join("foo.md"), "x").unwrap();
        let absolute = cwd.path().join("foo.md").to_string_lossy().into_owned();
        let out = parse_launch_args(&[absolute], cwd.path());
        assert_eq!(out.files.len(), 1);
    }

    /// S5 — on POSIX, a colon in a filename is rare but legal; the
    /// guard rejects it for symmetry. Better to over-reject than to
    /// miss the Windows variant.
    #[test]
    #[cfg(not(windows))]
    fn parse_launch_args_rejects_colon_in_filename_posix() {
        let cwd = tempdir().unwrap();
        // We can't actually create a colon-named file on macOS HFS+,
        // but we can synthesize the string and verify the guard runs
        // before canonicalize so a hostile drag source can't bypass.
        let out = parse_launch_args(&[s("foo:hidden.md")], cwd.path());
        assert!(out.files.is_empty(), "POSIX colon-in-filename should be rejected");
    }

    // ── path_has_no_ads unit tests (S5) ───────────────────────────────────

    #[test]
    fn path_has_no_ads_accepts_normal_paths() {
        assert!(path_has_no_ads("foo.md"));
        assert!(path_has_no_ads("/usr/local/foo.md"));
        assert!(path_has_no_ads("./foo.md"));
        assert!(path_has_no_ads("../foo.md"));
    }

    #[test]
    #[cfg(windows)]
    fn path_has_no_ads_accepts_drive_letter() {
        assert!(path_has_no_ads("C:\\Users\\dev\\foo.md"));
        assert!(path_has_no_ads("D:/projects/foo.md"));
    }

    #[test]
    fn path_has_no_ads_rejects_ads_marker() {
        assert!(!path_has_no_ads("foo.md:hidden"));
        assert!(!path_has_no_ads("/usr/local/foo.md:secret"));
    }

    #[test]
    #[cfg(windows)]
    fn path_has_no_ads_rejects_ads_after_drive_letter() {
        // Drive letter is fine; subsequent colons are ADS.
        assert!(!path_has_no_ads("C:\\Users\\dev\\foo.md:hidden"));
    }
}
