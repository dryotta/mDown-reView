//! Launch-args routing chokepoint.
//!
//! Extracted from `lib.rs` (issue #338 / iter-1 forward-fix B) to keep
//! `lib.rs` under the file-size budget set by `docs/architecture.md` rule 23.
//! Shared by the single-instance callback, `setup()`, and `RunEvent::Opened`
//! (macOS file-open) — all three paths must funnel `LaunchArgs` through
//! exactly the same window-creation + scope-extension logic so that
//! `WindowRegistry::register` and `window_scope::extend_window_scope` cannot
//! drift between sites.
//!
//! The function is `pub(crate)` because the only callers live in `lib.rs`;
//! external consumers (CLI shim, tests) construct windows via the public
//! IPC surface, not this internal helper.
use tauri::{Emitter, Manager};

use crate::commands::LaunchArgs;
use crate::registry::{self, WindowRegistry};
use crate::window_scope;

/// Route incoming `LaunchArgs` through the `WindowRegistry`, creating new
/// windows for unknown folders and focusing existing ones.  Shared by the
/// single-instance callback, `setup()`, and `RunEvent::Opened`.
pub(crate) fn route_args_through_registry(
    handle: &tauri::AppHandle,
    args: &LaunchArgs,
    ctx: &str,
) {
    let Some(reg) = handle.try_state::<WindowRegistry>() else {
        return;
    };
    for folder in &args.folders {
        let canonical = crate::core::paths::canonicalize_no_verbatim(std::path::Path::new(folder))
            .unwrap_or_else(|_| std::path::PathBuf::from(folder));
        match reg.route_folder(&canonical) {
            registry::RouteDecision::FocusExisting(label) => {
                if let Some(win) = handle.get_webview_window(&label) {
                    crate::focus_window(&win);
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
        match reg.route_file(&canonical) {
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
