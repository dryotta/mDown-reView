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

// ── Group B (issue #359 AC1/AC2/AC3/AC7) ──────────────────────────────────
//
// `register_window_file` — chokepoint called by the renderer's tab-open
// path BEFORE dispatching `read_text_file`. Seeds the watcher allowlist
// (so `ensure_readable` accepts the path) and returns the canonical path
// + tier classification so the renderer can derive `readOnly` atomically
// with the tab insert (closes the AC7 race that motivated removing
// `classifyAndMarkReadOnly`).
//
// `extend_window_scope_files` — the banner-opt-in path (AC3): grants
// BOTH asset-protocol scope AND watcher seed for the supplied files'
// canonical parents via the existing `ScopeGrant::FilesParents`
// chokepoint.

#[derive(serde::Serialize, Debug, specta::Type)]
pub struct RegisterWindowFileResult {
    pub canonical: String,
    pub classification: crate::core::types::wire::PathClassification,
}

/// Register a user-initiated file open with the per-window scope.
///
/// Called by the renderer's tab-open chokepoint BEFORE dispatching
/// `read_text_file` so that `ensure_readable`'s `is_path_allowed` check
/// passes. Adds the file's canonical-parent to the per-window
/// `tree_watched_dirs` allowlist (watcher-seed only — does NOT widen
/// asset-scope; that's the banner opt-in via `extend_window_scope_files`).
///
/// Security:
/// - Canonicalises the input via `canonicalize_no_verbatim` (rejects `..`,
///   relative, verbatim).
/// - Classifies the canonical path via
///   `core::security::system_locations::classify` and rejects `Tier::System`
///   with the sentinel "system path blocked" matching
///   `commands::fs::mod::ensure_readable`'s vocabulary.
/// - Returns the canonical path plus a `PathClassification` so the renderer
///   can derive `readOnly` atomically with the tab insert (AC7 — eliminates
///   the `classifyAndMarkReadOnly` race).
///
/// Cite: docs/architecture.md rule 1 (chokepoint discipline) +
/// docs/security.md rule 17 (asset-scope vs watcher-allowlist split).
#[mdr_command]
pub fn register_window_file(
    window: tauri::Window,
    path: String,
    state: tauri::State<'_, crate::watcher::WatcherState>,
    registry: tauri::State<'_, crate::registry::WindowRegistry>,
) -> Result<RegisterWindowFileResult, String> {
    let kind = registry.get_kind(window.label());
    register_window_file_inner(window.label(), &path, &state, kind.as_ref())
}

/// Test-seam: extracted body so unit/integration tests can drive without
/// a full `tauri::App`. Mirrors the `_inner` pattern at
/// `commands/fs/read.rs:read_text_file_inner`.
pub fn register_window_file_inner(
    window_label: &str,
    path_str: &str,
    state: &crate::watcher::WatcherState,
    kind: Option<&crate::registry::WindowKind>,
) -> Result<RegisterWindowFileResult, String> {
    use crate::core::security::system_locations::{classify, tier_to_wire, Tier};

    let raw = std::path::Path::new(path_str);
    let canonical = crate::core::paths::canonicalize_no_verbatim(raw).map_err(|e| {
        tracing::warn!(
            target: "fs-guard",
            "[fs-guard] register_window_file canonicalize failed for {}: {e}",
            path_str
        );
        "canonicalize failed".to_string()
    })?;
    let parent = canonical
        .parent()
        .ok_or_else(|| "path has no parent".to_string())?
        .to_path_buf();

    // AC7 — classify BEFORE seeding the watcher allowlist. Resolution rule
    // (corrected in iter 3 to fix the multi-file no-folder window bug):
    //
    //   * `WindowKind::Folder(root)` — classify against the folder root.
    //     Files outside the folder return Tier::Outside, surfacing the
    //     read-only badge in the renderer.
    //   * `WindowKind::FileOnly` — every user-opened file classifies as
    //     Inside. There is no semantically-meaningful "workspace" to
    //     compare against in a no-folder window; the user explicitly
    //     picked the file via the OS dialog and should get full
    //     editing/commenting rights.
    //   * `None` (window not registered) — fall back to canonical-as-root
    //     for backward compatibility (collapses to Inside).
    //
    // Order matters: the kind lookup happens BEFORE seed_window_workspace
    // below, so the second-and-later file opened in a FileOnly window does
    // NOT get classified against the first file's parent dir (the iter-2
    // bug surfaced by user testing).
    use crate::registry::WindowKind;
    let workspace_root: std::path::PathBuf = match kind {
        Some(WindowKind::Folder(root)) => root.clone(),
        Some(WindowKind::FileOnly) | None => canonical.clone(),
    };
    let classification = match classify(&canonical, &workspace_root) {
        Ok(Tier::System { .. }) => {
            tracing::warn!(
                target: "fs-guard",
                "[fs-guard] register_window_file system path blocked: {}",
                canonical.display()
            );
            return Err("system path blocked".into());
        }
        Ok(tier) => tier_to_wire(&tier, &canonical),
        Err(e) => {
            tracing::warn!(
                target: "fs-guard",
                "[fs-guard] register_window_file non-canonical: {} reason={:?}",
                canonical.display(),
                e
            );
            return Err("path not canonicalizable".into());
        }
    };

    // Watcher seed only — NOT asset scope. Asset scope is the banner opt-in
    // (extend_window_scope_files) per AC3.
    state.seed_window_workspace(window_label, vec![parent]);

    Ok(RegisterWindowFileResult {
        canonical: canonical.to_string_lossy().into_owned(),
        classification,
    })
}

/// Extend per-window scope (BOTH asset-protocol scope AND watcher allowlist)
/// for the given paths' canonical parents. Used by:
///   1. The "Allow for this session" banner click in the markdown viewer
///      (AC3) — grants asset scope to embedded image directories.
///   2. Future single-window deferred grants. Idempotent.
///
/// Each path is canonicalized and classified. `Tier::System` paths are
/// rejected with the "system path blocked" sentinel; non-canonical paths
/// with "path not canonicalizable". On any per-path rejection, the IPC
/// returns Err and no partial mutation occurs (atomic — collect all
/// canonicals first, then call `extend_window_scope` once).
///
/// Cite: docs/security.md rule 17 (asset-scope chokepoint, banner opt-in).
#[mdr_command]
pub fn extend_window_scope_files(
    window: tauri::Window,
    paths: Vec<String>,
) -> Result<(), String> {
    let canonicals = collect_canonicals_for_extend(&paths)?;
    window_scope::extend_window_scope(
        window.app_handle(),
        window.label(),
        ScopeGrant::FilesParents(canonicals),
    );
    Ok(())
}

/// Helper: canonicalize + classify each input path, returning the vec of
/// canonicals on success. On any rejection (system path / non-canonical),
/// returns Err with the first sentinel encountered — atomic, no partial
/// mutation. Exposed as `pub` so integration tests in `src-tauri/tests/`
/// (a separate crate) can drive without a `tauri::App` (the `mock_app()`
/// harness is unreliable on Windows hosts — precedent:
/// `comments_emit_test.rs:19-23`).
pub fn collect_canonicals_for_extend(
    paths: &[String],
) -> Result<Vec<std::path::PathBuf>, String> {
    use crate::core::security::system_locations::{classify, Tier};

    let mut canonicals: Vec<std::path::PathBuf> = Vec::with_capacity(paths.len());
    for path_str in paths {
        let raw = std::path::Path::new(path_str);
        let canonical = crate::core::paths::canonicalize_no_verbatim(raw).map_err(|e| {
            tracing::warn!(
                target: "fs-guard",
                "[fs-guard] extend_window_scope_files canonicalize failed for {}: {e}",
                path_str
            );
            "canonicalize failed".to_string()
        })?;
        match classify(&canonical, &canonical) {
            Ok(Tier::System { .. }) => {
                tracing::warn!(
                    target: "fs-guard",
                    "[fs-guard] extend_window_scope_files system path blocked: {}",
                    canonical.display()
                );
                return Err("system path blocked".into());
            }
            Ok(_) => canonicals.push(canonical),
            Err(_) => return Err("path not canonicalizable".into()),
        }
    }
    Ok(canonicals)
}

#[cfg(test)]
mod regression {
    use super::*;
    use crate::core::paths::canonicalize_no_verbatim;
    use crate::watcher::WatcherState;
    use std::sync::mpsc::sync_channel;

    fn make_state() -> WatcherState {
        let (tx, _rx) = sync_channel(1);
        WatcherState::new(tx)
    }

    /// Issue #366 regression: with `tree_watched_dirs["main"]` already
    /// populated by a prior spec, calling `register_window_file_inner`
    /// for an outside-the-existing-set file MUST seed the new parent so
    /// `is_path_allowed(file)` returns true afterward.
    ///
    /// If this test PASSES with no fix in this PR: #366's CI flake is
    /// environmental (canonicalize race / Windows fs flush) and the
    /// fixture-level reset is a test-isolation improvement, not a code
    /// fix. If it FAILS today: the reset masks a real defect that needs
    /// addressing at a deeper layer.
    ///
    /// Cite: docs/test-strategy.md rule 24 (failing-then-passing
    /// regression for every confirmed bug under Zero Bug Policy).
    #[test]
    fn register_window_file_seeds_parent_with_pre_populated_state() {
        let state = make_state();

        // Anchor tempdirs under repo-local target/ to avoid Windows AppData
        // (which classify() flags as Tier::System regardless of workspace_root,
        // see core::security::system_locations:221).
        use std::path::PathBuf;
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let temp_root = manifest_dir.join("target").join("test-tmp-window-register");
        std::fs::create_dir_all(&temp_root).expect("temp_root mkdir");

        // Pre-populate: simulate prior specs leaving a stale folder in main's allowlist.
        let stale_dir = tempfile::Builder::new()
            .prefix("mdr-366-stale-")
            .tempdir_in(&temp_root)
            .unwrap();
        let canonical_stale = canonicalize_no_verbatim(stale_dir.path()).unwrap();
        state.seed_window_workspace("test-main", vec![canonical_stale.clone()]);

        // Test setup: create a separate "outside" folder + file (mirrors 09-outside-file-open's repro-1).
        let outside_dir = tempfile::Builder::new()
            .prefix("mdr-366-outside-")
            .tempdir_in(&temp_root)
            .unwrap();
        let outside_file = outside_dir.path().join("outside.md");
        std::fs::write(&outside_file, "# Outside\n").unwrap();
        let outside_file_str = outside_file.to_string_lossy().to_string();

        // Pre-condition: outside_file is NOT yet allowed.
        assert!(
            !state.is_path_allowed(&outside_file),
            "precondition: outside file rejected before register"
        );

        // Action: register the outside file (mirrors store/tabs.ts:openFile chokepoint).
        let result = register_window_file_inner("test-main", &outside_file_str, &state, None);
        assert!(result.is_ok(), "register_window_file_inner should succeed: {result:?}");

        // Post-condition: outside_file IS now allowed.
        assert!(
            state.is_path_allowed(&outside_file),
            "post-register: outside file should be allowed (#366 regression)"
        );
    }
}
