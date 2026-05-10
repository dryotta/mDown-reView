//! Drag-drop file/folder open handler.
//!
//! Extracted from `src/lib.rs::on_window_event` (review of PR #372 by
//! `architect-expert` finding M1 — `lib.rs` was already over its
//! 500-line shared-chokepoint budget) so the body is unit-testable and
//! the file-size budget can recover. The lib.rs window-event arm is
//! now a one-liner that delegates here.
//!
//! Two responsibilities:
//!   1. [`handle_dropped_paths`] — pure routing entry point: takes the
//!      raw `Vec<PathBuf>` from `WindowEvent::DragDrop`, classifies via
//!      `parse_launch_args` (so file-vs-folder + sidecar redirect +
//!      NTFS-ADS guard rules cannot drift between CLI and drag-drop),
//!      and forwards through [`launch_routing::route_args_to_window`]
//!      which honours the dropped-on window's identity.
//!   2. [`spawn_drag_drop_task`] — wraps `handle_dropped_paths` in
//!      `tauri::async_runtime::spawn_blocking` so canonicalize +
//!      metadata syscalls (potentially blocking on slow filesystems
//!      or network shares) never stall the main GUI event loop. This
//!      addresses architect/security/bug expert review of PR #372
//!      (synchronous I/O on the window-event thread = UI freeze on
//!      large/slow drops).
//!
//! Related rules:
//!   - `docs/architecture.md` rule 1 (single chokepoint for IPC /
//!     window-routing).
//!   - `docs/security.md` rule 17 (asset-protocol scope chokepoint —
//!     handled by `route_args_to_window`'s extend_window_scope calls).
//!   - `docs/best-practices-common/tauri/macos-platform.md`
//!     `mac-webview-drag-drop` rule (Rust-side handling avoids
//!     WKWebView's unreliable HTML5 drop-event propagation).

use std::path::PathBuf;
use tauri::Emitter;

/// Cap the number of paths a single drop can carry, before the
/// expensive per-path canonicalize / metadata work runs. A drop of
/// thousands of paths from a corrupted shell extension or runaway
/// script could otherwise pin a `spawn_blocking` worker for seconds.
/// 1000 is well above any realistic user gesture (Explorer / Finder
/// caps multi-select at a few hundred in practice).
///
/// `pub` so `lib.rs` can short-circuit BEFORE cloning the unbounded
/// `paths` Vec onto the spawn-blocking worker — the cap-before-clone
/// ordering is the perf-expert fix; without it a pathological drop
/// would still allocate N PathBufs on the GUI event-loop thread.
pub const MAX_DROP_PATHS: usize = 1000;

/// Reason a drop was rejected, surfaced to the renderer via
/// `drag-drop-rejected`. Pure data — no Tauri runtime work — so
/// [`classify_drop`] can be unit-tested without an `AppHandle`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DropOutcome {
    /// Empty drop — silently ignored upstream (lib.rs has its own
    /// short-circuit; this variant only appears if classify_drop is
    /// called directly with an empty slice).
    Empty,
    /// Over the [`MAX_DROP_PATHS`] cap. `count` is the original drop
    /// size so the toast can show what the user attempted.
    OverCap { count: usize },
    /// Some paths were dropped successfully but others could not be
    /// classified (broken symlinks, NTFS-ADS rejections, deleted files,
    /// etc.). `args` carries what survived; `failed` is the count that
    /// did not. UX surfaces "Opened K, skipped N" via the same
    /// `drag-drop-rejected` event with a partial-shape reason string.
    Partial { args: crate::core::types::LaunchArgs, failed: usize },
    /// All dropped paths failed classification — overlay would
    /// otherwise hide silently.
    AllFailed { count: usize },
    /// Every dropped path classified cleanly.
    Ok(crate::core::types::LaunchArgs),
}

/// Pure classifier: takes the dropped path slice and returns a
/// [`DropOutcome`]. Performs `parse_launch_args` (which canonicalizes
/// + applies sidecar redirect + NTFS-ADS guard) and decides whether
/// the drop is empty / over-cap / fully classified / partially
/// classified / all-failed.
///
/// **Pure** — no Tauri runtime work, no `AppHandle`, no logging side
/// effects. Test directly.
///
/// `cwd` is forwarded to `parse_launch_args` so non-absolute paths
/// resolve consistently with CLI launch.
pub fn classify_drop(paths: &[PathBuf], cwd: &std::path::Path) -> DropOutcome {
    if paths.is_empty() {
        return DropOutcome::Empty;
    }
    if paths.len() > MAX_DROP_PATHS {
        return DropOutcome::OverCap { count: paths.len() };
    }
    let argv: Vec<String> = paths
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    let args = crate::commands::parse_launch_args(&argv, cwd);

    let classified = args.files.len() + args.folders.len();
    if classified == 0 {
        return DropOutcome::AllFailed { count: paths.len() };
    }
    if classified < paths.len() {
        let failed = paths.len() - classified;
        return DropOutcome::Partial { args, failed };
    }
    DropOutcome::Ok(args)
}

/// Reason string for a [`DropOutcome::OverCap`] rejection — kept here
/// so the toast wording lives next to the cap constant and the test
/// can pin the exact phrasing without duplication.
fn over_cap_reason() -> String {
    format!("too many paths (cap {MAX_DROP_PATHS})")
}

/// Classify dropped paths and route them through the multi-window
/// registry, biasing decisions toward the dropped-on window. Thin
/// emit/route wrapper around the pure [`classify_drop`].
///
/// `target_label` MUST be the label of the window the user dropped
/// onto so files / folders route to that window when the user's
/// gesture is the deciding factor.
///
/// Returns the parsed `LaunchArgs` for caller-side diagnostics
/// (logging the dropped count). The renderer is notified of every
/// non-success outcome via the `drag-drop-rejected` event so the
/// overlay never silently hides — Empty/OverCap/AllFailed/Partial all
/// surface a toast.
pub fn handle_dropped_paths(
    handle: &tauri::AppHandle,
    target_label: &str,
    paths: &[PathBuf],
) -> crate::core::types::LaunchArgs {
    let cwd = std::env::current_dir().unwrap_or_default();
    match classify_drop(paths, &cwd) {
        DropOutcome::Empty => crate::core::types::LaunchArgs::default(),
        DropOutcome::OverCap { count } => {
            log::warn!(
                "[drag-drop] {target_label}: rejecting drop of {count} paths (cap is {MAX_DROP_PATHS})"
            );
            // Rule `multiwin-window-scoped-events`: AppHandle::emit_to
            // scopes delivery; WebviewWindow::emit is a global broadcast.
            let _ = handle.emit_to(
                target_label,
                "drag-drop-rejected",
                serde_json::json!({
                    "count": count,
                    "reason": over_cap_reason(),
                }),
            );
            crate::core::types::LaunchArgs::default()
        }
        DropOutcome::AllFailed { count } => {
            log::warn!(
                "[drag-drop] {target_label}: dropped {count} path(s) but none classified as file or folder"
            );
            let _ = handle.emit_to(
                target_label,
                "drag-drop-rejected",
                serde_json::json!({
                    "count": count,
                    "reason": "no usable file or folder",
                }),
            );
            crate::core::types::LaunchArgs::default()
        }
        DropOutcome::Partial { args, failed } => {
            let opened = args.files.len() + args.folders.len();
            log::info!(
                "[drag-drop] {target_label}: opened {opened}, skipped {failed} ({} folder(s) + {} file(s))",
                args.folders.len(),
                args.files.len(),
            );
            // Reuse the same event/schema. Toast renders the partial
            // copy because `count` (failed) is non-zero and `reason`
            // explains the opened/skipped split.
            let _ = handle.emit_to(
                target_label,
                "drag-drop-rejected",
                serde_json::json!({
                    "count": failed,
                    "reason": format!("opened {opened}, skipped {failed} (broken or unsupported)"),
                }),
            );
            crate::launch_routing::route_args_to_window(handle, &args, "drag-drop", target_label);
            args
        }
        DropOutcome::Ok(args) => {
            log::info!(
                "[drag-drop] {target_label}: {} folder(s) + {} file(s)",
                args.folders.len(),
                args.files.len()
            );
            crate::launch_routing::route_args_to_window(handle, &args, "drag-drop", target_label);
            args
        }
    }
}

/// Schedule [`handle_dropped_paths`] on a blocking-tolerant worker
/// thread so the synchronous `canonicalize` + `metadata` syscalls
/// never stall the main GUI event loop. The drop event handler in
/// `lib.rs::on_window_event` should call this and return immediately.
///
/// `paths` is moved into the task. `target_label` is owned (cloned)
/// before the spawn so the task does not borrow caller state.
///
/// Panics inside the worker are caught and logged so a malformed
/// path or unexpected `parse_launch_args` failure does not leave the
/// worker pool with a poisoned task.
pub fn spawn_drag_drop_task(
    handle: tauri::AppHandle,
    target_label: String,
    paths: Vec<PathBuf>,
) {
    tauri::async_runtime::spawn_blocking(move || {
        let label_for_log = target_label.clone();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            handle_dropped_paths(&handle, &target_label, &paths);
        }));
        if result.is_err() {
            log::error!(
                "[drag-drop] {label_for_log}: panic in worker (paths.len={}); drop ignored",
                paths.len()
            );
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn max_drop_paths_constant_is_reasonable() {
        // Sanity bound — far above any realistic user gesture
        // (Explorer multi-select), well below DoS territory.
        assert!(MAX_DROP_PATHS >= 100);
        assert!(MAX_DROP_PATHS <= 10_000);
    }

    #[test]
    fn classify_drop_empty_returns_empty() {
        let cwd = tempdir().unwrap();
        assert_eq!(classify_drop(&[], cwd.path()), DropOutcome::Empty);
    }

    #[test]
    fn classify_drop_over_cap_returns_overcap_with_count() {
        let cwd = tempdir().unwrap();
        let many: Vec<PathBuf> = (0..MAX_DROP_PATHS + 5)
            .map(|i| PathBuf::from(format!("/no/such/file{i}.md")))
            .collect();
        assert_eq!(
            classify_drop(&many, cwd.path()),
            DropOutcome::OverCap { count: MAX_DROP_PATHS + 5 }
        );
    }

    #[test]
    fn classify_drop_all_invalid_returns_all_failed() {
        let cwd = tempdir().unwrap();
        let bogus = vec![
            PathBuf::from("/does/not/exist/a.md"),
            PathBuf::from("/also/missing/b.md"),
        ];
        assert_eq!(
            classify_drop(&bogus, cwd.path()),
            DropOutcome::AllFailed { count: 2 }
        );
    }

    #[test]
    fn classify_drop_all_valid_returns_ok() {
        let cwd = tempdir().unwrap();
        std::fs::write(cwd.path().join("a.md"), "x").unwrap();
        std::fs::write(cwd.path().join("b.md"), "x").unwrap();

        let paths = vec![cwd.path().join("a.md"), cwd.path().join("b.md")];
        match classify_drop(&paths, cwd.path()) {
            DropOutcome::Ok(args) => {
                assert_eq!(args.files.len(), 2);
                assert!(args.folders.is_empty());
            }
            other => panic!("expected Ok, got {other:?}"),
        }
    }

    #[test]
    fn classify_drop_partial_when_some_valid_some_missing() {
        // Mixed-drop UX gap (H3): 1 valid + 1 missing must report
        // failed=1 so the toast can say "opened 1, skipped 1".
        let cwd = tempdir().unwrap();
        std::fs::write(cwd.path().join("good.md"), "x").unwrap();
        let paths = vec![
            cwd.path().join("good.md"),
            PathBuf::from("/does/not/exist/missing.md"),
        ];
        match classify_drop(&paths, cwd.path()) {
            DropOutcome::Partial { args, failed } => {
                assert_eq!(failed, 1);
                assert_eq!(args.files.len(), 1);
            }
            other => panic!("expected Partial, got {other:?}"),
        }
    }

    #[test]
    fn classify_drop_folder_plus_file_classifies_both() {
        let cwd = tempdir().unwrap();
        std::fs::create_dir_all(cwd.path().join("subdir")).unwrap();
        std::fs::write(cwd.path().join("note.md"), "x").unwrap();

        let paths = vec![cwd.path().join("subdir"), cwd.path().join("note.md")];
        match classify_drop(&paths, cwd.path()) {
            DropOutcome::Ok(args) => {
                assert_eq!(args.folders.len(), 1);
                assert_eq!(args.files.len(), 1);
            }
            other => panic!("expected Ok with folder+file, got {other:?}"),
        }
    }

    #[test]
    fn over_cap_reason_mentions_the_cap_value() {
        // Wording is part of the user-visible toast contract; pin it.
        let r = over_cap_reason();
        assert!(r.contains(&MAX_DROP_PATHS.to_string()), "reason missing cap: {r}");
        assert!(r.contains("too many"), "reason missing 'too many': {r}");
    }
}
