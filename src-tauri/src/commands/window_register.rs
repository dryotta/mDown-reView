//! Per-window folder claim/release IPC chokepoint.
//!
//! This module owns every `register_window_*` / `unregister_window_*`
//! IPC command. Each handler routes asset-protocol scope and watcher
//! tree-seed grants through the single `crate::window_scope::extend_window_scope`
//! chokepoint (see `docs/architecture.md` rule 1 — single chokepoints
//! for IPC and watcher state) so that no command site ever pokes
//! `WatcherState` or `asset_protocol_scope` directly.
//!
//! Extracted from `lib.rs` (issue #359 / Group A) to keep `lib.rs`
//! under the file-size budget set by `docs/architecture.md` rule 23
//! and to give Group B a clean module to add `register_window_file`
//! into without further bloating `lib.rs`.

use crate::mdr_command;
use crate::registry;
use crate::window_scope::{self, ScopeGrant};
use tauri::Manager;

#[mdr_command]
pub fn register_window_folder(
    window: tauri::Window,
    folder: String,
    registry: tauri::State<'_, registry::WindowRegistry>,
) -> Result<(), String> {
    let canonical = crate::core::paths::canonicalize_no_verbatim(std::path::Path::new(&folder))
        .map_err(|e| format!("invalid folder: {}", e))?;
    let display = crate::folder_display_name(&canonical);
    match registry.try_claim_folder(window.label(), canonical.clone()) {
        Ok(()) => {
            let _ = window.set_title(&format!("mdownreview — {display}"));
            // #338 iter-1 forward-fix: chokepoint asset-scope + watcher seed.
            window_scope::extend_window_scope(
                window.app_handle(),
                window.label(),
                ScopeGrant::Folder(canonical.clone()),
            );
            log::info!("[window] {} registered folder: {display}", window.label());
            Ok(())
        }
        Err(existing_label) => {
            // Focus the window that already owns this folder
            if let Some(existing_win) = window.app_handle().get_webview_window(&existing_label) {
                crate::focus_window(&existing_win);
            }
            log::info!(
                "[window] {} tried to claim folder {display} already owned by {existing_label}",
                window.label()
            );
            Err(format!("folder already open in window '{existing_label}'"))
        }
    }
}

#[mdr_command]
pub fn unregister_window_folder(
    window: tauri::Window,
    registry: tauri::State<'_, registry::WindowRegistry>,
) -> Result<(), String> {
    registry.update_kind(window.label(), registry::WindowKind::FileOnly);
    let _ = window.set_title("mdownreview");
    log::info!("[window] {} unregistered folder", window.label());
    Ok(())
}
