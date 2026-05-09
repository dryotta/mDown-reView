//! Per-window resource registration (asset-protocol scope + watcher state).
//!
//! Single chokepoint called by every site that registers a window in the
//! [`crate::registry::WindowRegistry`]. Without this chokepoint the runtime
//! had several gaps where a window was identity-registered (so the registry
//! knew about it) but the watcher allowlist (`tree_watched_dirs`) and the
//! asset-protocol scope were left empty until the frontend's
//! `useTreeWatcher` round-tripped — leaving early IPC reads (drained
//! synchronously on `args-received`) to fail the workspace guard with
//! `"path not in workspace"` and inline images to fail asset-scope
//! resolution.
//!
//! Issue #338 / iter-1 forward-fix: see `docs/security.md` rule 17 for the
//! shipped pattern. Group B will consolidate further into the per-window
//! state stratification; for now this module is the chokepoint every
//! `WindowRegistry::register` site MUST go through.

use crate::watcher::WatcherState;
use std::path::PathBuf;
use tauri::{Manager, Runtime};

/// Verb-shaped grant describing what asset-scope + watcher seeding a
/// freshly-registered window needs. Carried as owned data (not borrowed
/// `&Path`) because every existing caller already produces owned
/// `PathBuf` values via `canonicalize_no_verbatim`, so the move is free.
///
/// Decoupled from `crate::registry::WindowKind` (the registry-identity
/// discriminator) so that future grant shapes — e.g. add-files-to-folder
/// in Group D — can extend this enum without warping the registry's
/// folder-claimed vs FileOnly orphan model.
///
/// * `Folder(canonical)` — recursive asset-scope on the folder plus one
///   watcher-allowlist seed for that dir. This matches the user's
///   mental model: "I opened folder X, anything under X is fair game".
/// * `FilesParents(files)` — non-recursive asset-scope on each unique
///   parent dir of `files` plus a watcher-allowlist seed for the same
///   parents. Non-recursive on purpose: orphan-file windows MUST NOT
///   silently grant access to siblings beyond the requested files'
///   immediate directory level.
pub enum ScopeGrant {
    Folder(PathBuf),
    FilesParents(Vec<PathBuf>),
}

/// Compute the canonical dirs that should be seeded into the watcher
/// `tree_watched_dirs` allowlist for a given grant. Pulled out of
/// `extend_window_scope` so integration tests can exercise the dispatch
/// (folder → recursive single dir, files-parents → deduped parents)
/// without needing a real `tauri::App` for `asset_protocol_scope` —
/// `tauri::test::mock_app()` is unusable on the dev Windows host (see
/// `src-tauri/tests/comments_emit_test.rs` precedent). The watcher seed
/// is the load-bearing observable here; asset-scope is verified by
/// the native E2E layer.
pub fn watcher_seed_dirs(grant: &ScopeGrant) -> Vec<PathBuf> {
    match grant {
        ScopeGrant::Folder(canonical) => vec![canonical.clone()],
        ScopeGrant::FilesParents(files) => {
            let mut parents: Vec<PathBuf> = files
                .iter()
                .filter_map(|f| f.parent().map(PathBuf::from))
                .collect();
            parents.sort();
            parents.dedup();
            parents
        }
    }
}

/// Extend per-window resource grants when a window is registered.
///
/// Single chokepoint (per `docs/architecture.md` rule 1) for asset-scope
/// + watcher tree-seed extension. Called by every site that registers a
/// window in [`crate::registry::WindowRegistry`] — without this, early
/// IPC reads (drained synchronously on `args-received`) would fail the
/// workspace guard and inline images would fail asset-scope resolution.
///
/// * [`ScopeGrant::Folder`] — recursive asset-scope on the folder plus
///   one watcher seed for the same dir.
/// * [`ScopeGrant::FilesParents`] — non-recursive asset-scope on each
///   unique parent dir plus watcher seeds for those parents.
///
/// Idempotent for asset-scope (`allow_directory` is additive on the
/// underlying `Scope` — calling twice for the same dir is a no-op). For
/// watcher seeds it appends to the per-window set (so calling for an
/// already-seeded label simply re-inserts the same canonical dirs).
///
/// Failures are LOGGED via `tracing` and never propagated. Reliable
/// pillar: failure to extend a grant must not abort window registration —
/// the user still gets a window; just fewer assets render until the
/// frontend's `useTreeWatcher` round-trips.
pub fn extend_window_scope<R: Runtime, M: Manager<R>>(
    handle: &M,
    window_label: &str,
    grant: ScopeGrant,
) {
    let asset_scope = handle.asset_protocol_scope();
    let watcher_state = handle.state::<WatcherState>();

    let seed_dirs = watcher_seed_dirs(&grant);

    match &grant {
        ScopeGrant::Folder(canonical) => {
            if let Err(e) = asset_scope.allow_directory(canonical, true) {
                tracing::warn!(
                    target: "window-scope",
                    "[window-scope] asset-scope folder {} failed: {e}",
                    canonical.display()
                );
            } else {
                tracing::debug!(
                    target: "window-scope",
                    "[window-scope] asset-scope folder allowed: {}",
                    canonical.display()
                );
            }
            watcher_state.seed_window_workspace(window_label, seed_dirs);
            tracing::debug!(
                target: "window-scope",
                "[window-scope] watcher seeded folder for {window_label}: {}",
                canonical.display()
            );
        }
        ScopeGrant::FilesParents(_files) => {
            for parent in &seed_dirs {
                if let Err(e) = asset_scope.allow_directory(parent, false) {
                    tracing::warn!(
                        target: "window-scope",
                        "[window-scope] asset-scope parent {} failed: {e}",
                        parent.display()
                    );
                } else {
                    tracing::debug!(
                        target: "window-scope",
                        "[window-scope] asset-scope parent allowed: {}",
                        parent.display()
                    );
                }
            }
            if !seed_dirs.is_empty() {
                let n = seed_dirs.len();
                watcher_state.seed_window_workspace(window_label, seed_dirs);
                tracing::debug!(
                    target: "window-scope",
                    "[window-scope] watcher seeded {n} parent(s) for {window_label}"
                );
            }
        }
    }
}

/// Test-only chokepoint that clears all per-window resource grants for
/// `window_label` so a native E2E spec starts with empty watcher
/// allowlist state. Used by `e2e/native/fixtures.ts`'s `nativePage`
/// fixture between specs.
///
/// Asset-protocol scope is intentionally NOT cleared — it is additive in
/// Tauri v2 (no public revoke). Subsequent `read_text_file` /
/// `read_binary_file` IPC calls still go through `is_path_allowed`
/// (`watcher.rs:130`) which gates the workspace guard.
///
/// Cite: docs/architecture.md rule 1 (chokepoint discipline);
///       docs/security.md rule 17 (asset-scope vs watcher-allowlist split).
pub fn reset_window_scope<R: Runtime, M: Manager<R>>(handle: &M, window_label: &str) {
    handle.state::<WatcherState>().reset_window_scope(window_label);
    tracing::debug!(
        target: "window-scope",
        "[window-scope] reset window scope for {window_label}"
    );
}
