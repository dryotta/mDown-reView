//! Launch-args routing chokepoint.
//!
//! Extracted from `lib.rs` (issue #338 / iter-1 forward-fix B) to keep
//! `lib.rs` under the file-size budget set by `docs/architecture.md` rule 23.
//! Shared by the single-instance callback, `setup()`, `RunEvent::Opened`
//! (macOS file-open), and drag-drop (`commands::drag_drop`) — all four
//! paths must funnel `LaunchArgs` through exactly the same window-creation +
//! scope-extension logic so that `WindowRegistry::register` and
//! `window_scope::extend_window_scope` cannot drift between sites.
//!
//! Two entry points:
//!   - [`route_args_through_registry`] — un-targeted (CLI / single-instance /
//!     macOS Open). The registry picks the best window via
//!     `route_folder` / `route_file`.
//!   - [`route_args_to_window`] — drag-drop. Biases the routing decision
//!     toward the dropped-on window's label so a drop on window B does
//!     not end up routed to a different `FileOnly` window A just because
//!     A appears first in the registry (architect-expert review of
//!     PR #372, finding H1).
//!
//! The functions are `pub(crate)` because the only callers live in
//! `lib.rs` / `commands/drag_drop.rs`; external consumers (CLI shim,
//! tests) construct windows via the public IPC surface, not these
//! internal helpers.
use tauri::{Emitter, Manager};

use crate::commands::LaunchArgs;
use crate::registry::{self, WindowRegistry};
use crate::window_scope;

/// Route incoming `LaunchArgs` through the `WindowRegistry`, creating new
/// windows for unknown folders and focusing existing ones.  Shared by the
/// single-instance callback, `setup()`, and `RunEvent::Opened`.
///
/// Drag-drop uses [`route_args_to_window`] instead — that variant biases
/// the routing decision toward the dropped-on window so a user's
/// explicit gesture is respected.
pub(crate) fn route_args_through_registry(
    handle: &tauri::AppHandle,
    args: &LaunchArgs,
    ctx: &str,
) {
    route_args_inner(handle, args, ctx, None)
}

/// Drag-drop variant — routes `LaunchArgs` with awareness of the
/// dropped-on window. The target-aware decision tables in
/// [`registry::WindowRegistry::route_folder_for_target`] and
/// [`registry::WindowRegistry::route_file_for_target`] honour the
/// user's gesture without breaking the "files under an open folder
/// belong in that folder's window" rule.
///
/// Falls back to the un-targeted routing (`route_args_through_registry`)
/// for paths whose decision is unaffected by the target (e.g. files
/// under a different open folder, folders already open elsewhere).
pub(crate) fn route_args_to_window(
    handle: &tauri::AppHandle,
    args: &LaunchArgs,
    ctx: &str,
    target_label: &str,
) {
    route_args_inner(handle, args, ctx, Some(target_label))
}

fn route_args_inner(
    handle: &tauri::AppHandle,
    args: &LaunchArgs,
    ctx: &str,
    target_label: Option<&str>,
) {
    let Some(reg) = handle.try_state::<WindowRegistry>() else {
        return;
    };
    for folder in &args.folders {
        let canonical = crate::core::paths::canonicalize_no_verbatim(std::path::Path::new(folder))
            .unwrap_or_else(|_| std::path::PathBuf::from(folder));
        let decision = match target_label {
            Some(t) => reg.route_folder_for_target(&canonical, t),
            None => reg.route_folder(&canonical),
        };
        match decision {
            registry::RouteDecision::FocusExisting(label) => {
                if let Some(win) = handle.get_webview_window(&label) {
                    crate::focus_window(&win);
                }
            }
            registry::RouteDecision::ClaimForTarget { target_label: t, path } => {
                // Drag-drop only: the dropped-on window is FileOnly and
                // the dropped folder is unclaimed. Claim atomically;
                // race-loss falls back to spawning a new window so the
                // user is never left without their folder.
                match reg.try_claim_folder(&t, path.clone()) {
                    Ok(()) => {
                        let display = crate::folder_display_name(&path);
                        if let Some(win) = handle.get_webview_window(&t) {
                            let _ = win.set_title(&format!("mdownreview — {display}"));
                            crate::focus_window(&win);
                        }
                        // Asset-protocol scope + watcher seed before emit
                        // (mirrors register_window_folder).
                        window_scope::extend_window_scope(
                            handle,
                            &t,
                            window_scope::ScopeGrant::Folder(path.clone()),
                        );
                        reg.push_args(
                            &t,
                            LaunchArgs {
                                folders: vec![path.to_string_lossy().into_owned()],
                                files: vec![],
                            },
                        );
                        let _ = handle.emit_to(t.as_str(), "args-received", ());
                        log::info!(
                            "[window] {ctx}: claimed folder for target {t}: {}",
                            path.display()
                        );
                    }
                    Err(existing_label) => {
                        log::info!(
                            "[window] {ctx}: claim race lost on target {t} to {existing_label}; \
                             falling back to focus-existing"
                        );
                        if let Some(win) = handle.get_webview_window(&existing_label) {
                            crate::focus_window(&win);
                        }
                    }
                }
            }
            registry::RouteDecision::CreateFolder { path } => {
                // Rule multiwin-atomic-registry-mutations: pre-register a
                // FileOnly slot for the new label, then `try_claim_folder`
                // atomically. This collapses the previous read-then-register
                // race where two concurrent CLI launches both saw `route_folder`
                // return `CreateFolder` for the same canonical path and both
                // proceeded to `register`, breaking one-folder-one-window.
                let label = reg.next_label();
                reg.register(label.clone(), registry::WindowKind::FileOnly);
                match reg.try_claim_folder(&label, path.clone()) {
                    Ok(()) => {
                        let display = crate::folder_display_name(&path);
                        match crate::create_app_window(
                            handle,
                            &label,
                            &format!("mdownreview — {display}"),
                        ) {
                            Ok(_new_win) => {
                                // Issue #338 / iter-1 forward-fix: chokepoint
                                // asset-scope + watcher seed for windows
                                // created via single-instance forwarding /
                                // OS file-open / second-instance launch.
                                window_scope::extend_window_scope(
                                    handle,
                                    &label,
                                    window_scope::ScopeGrant::Folder(path.clone()),
                                );
                                reg.push_args(
                                    &label,
                                    LaunchArgs {
                                        folders: vec![path.to_string_lossy().into_owned()],
                                        files: vec![],
                                    },
                                );
                                // Rule multiwin-args-delivery: signal the new window to re-drain
                                // in case its initial mount drain fired before push_args.
                                // Rule multiwin-window-scoped-events: emit_to scopes delivery to
                                // exactly this label; WebviewWindow::emit is a global broadcast
                                // (see tauri-2.10.3/src/manager/mod.rs::emit).
                                let _ = handle.emit_to(label.as_str(), "args-received", ());
                                log::info!("[window] {ctx}: created {label}");
                            }
                            Err(e) => {
                                // Window build failed after we claimed the folder —
                                // unregister so a subsequent launch can claim it.
                                reg.unregister(&label);
                                log::error!("[window] {ctx}: folder window failed: {e}");
                            }
                        }
                    }
                    Err(existing_label) => {
                        // Race lost: another concurrent launch claimed the
                        // folder first. Drop the pre-registered FileOnly slot
                        // and focus the winning window instead.
                        reg.unregister(&label);
                        if let Some(win) = handle.get_webview_window(&existing_label) {
                            crate::focus_window(&win);
                        }
                        log::info!(
                            "[window] {ctx}: folder claim race lost to {existing_label}, focusing existing"
                        );
                    }
                }
            }
            _ => {}
        }
    }
    for file in &args.files {
        let canonical = crate::core::paths::canonicalize_no_verbatim(std::path::Path::new(file))
            .unwrap_or_else(|_| std::path::PathBuf::from(file));
        let decision = match target_label {
            Some(t) => reg.route_file_for_target(&canonical, t),
            None => reg.route_file(&canonical),
        };
        match decision {
            registry::RouteDecision::AddToWindow { label, files } => {
                if let Some(win) = handle.get_webview_window(&label) {
                    crate::focus_window(&win);
                    // Issue #359 / AC4: forwarding a file to an existing window
                    // must extend that window's asset-scope + watcher seed to
                    // cover the new file's parent dir BEFORE emitting
                    // `open-file-tab` — otherwise the renderer drains the new
                    // tab and fires reads that fail the workspace guard with
                    // "path not in workspace" and inline images fail asset
                    // resolution. See `docs/security.md` rule 17 (asset-scope
                    // chokepoint, banner-vs-direct-grant split): direct-grant
                    // path mirrors the `CreateFileOnly` arm above.
                    window_scope::extend_window_scope(
                        handle,
                        &label,
                        window_scope::ScopeGrant::FilesParents(files.clone()),
                    );
                    // Bug-expert review of PR #372 (#3): also push_args so a
                    // dropped file is recoverable if the target window's
                    // listener has been torn down (close-flush in flight,
                    // HMR module replacement, etc.). Symmetric with
                    // `CreateFolder` / `CreateFileOnly` arms below — every
                    // path that emits a renderer signal also persists via
                    // the registry queue. Without this, a drop on a
                    // closing window vanishes silently.
                    let file_strs: Vec<String> = files
                        .iter()
                        .map(|f| f.to_string_lossy().into_owned())
                        .collect();
                    reg.push_args(
                        &label,
                        LaunchArgs {
                            files: file_strs,
                            folders: vec![],
                        },
                    );
                    // Rule multiwin-window-scoped-events: emit_to(label, ...) scopes delivery;
                    // WebviewWindow::emit is a global broadcast.
                    let _ = handle.emit_to(label.as_str(), "open-file-tab", &files);
                }
            }
            registry::RouteDecision::CreateFileOnly { files } => {
                let label = reg.next_label();
                match crate::create_app_window(handle, &label, "mdownreview — Files") {
                    Ok(_new_win) => {
                        reg.register(label.clone(), registry::WindowKind::FileOnly);
                        // Issue #338 / iter-1 forward-fix: chokepoint
                        // asset-scope + watcher seed for file-only windows
                        // created via single-instance / OS file-open.
                        window_scope::extend_window_scope(
                            handle,
                            &label,
                            window_scope::ScopeGrant::FilesParents(files.clone()),
                        );
                        let file_strs: Vec<String> =
                            files.iter().map(|f| f.to_string_lossy().into_owned()).collect();
                        reg.push_args(
                            &label,
                            LaunchArgs {
                                files: file_strs,
                                folders: vec![],
                            },
                        );
                        // Rule multiwin-args-delivery: signal the new window to re-drain.
                        // Rule multiwin-window-scoped-events: emit_to(label, ...) scopes delivery.
                        let _ = handle.emit_to(label.as_str(), "args-received", ());
                        log::info!("[window] {ctx}: created file-only window {label}");
                    }
                    Err(e) => log::error!("[window] {ctx}: file-only window failed: {e}"),
                }
            }
            registry::RouteDecision::FocusExisting(label) => {
                if let Some(win) = handle.get_webview_window(&label) {
                    crate::focus_window(&win);
                }
            }
            _ => {}
        }
    }
}
