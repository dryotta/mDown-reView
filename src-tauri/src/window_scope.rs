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

use crate::registry::WindowKind;
use crate::watcher::WatcherState;
use std::path::PathBuf;
use tauri::{Manager, Runtime};

/// Extend per-window resource grants when a window is registered.
///
/// * `WindowKind::Folder(canonical)` — recursive asset-scope on the folder
///   plus one watcher-allowlist seed for that dir. This matches the
///   user's mental model: "I opened folder X, anything under X is fair
///   game".
/// * `WindowKind::FileOnly` — non-recursive asset-scope on each unique
///   parent dir of `files` plus a watcher-allowlist seed for the same
///   parents. Non-recursive on purpose: orphan-file windows MUST NOT
///   silently grant access to siblings beyond the requested files'
///   immediate directory level.
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
    kind: &WindowKind,
    files: &[PathBuf],
) {
    let asset_scope = handle.asset_protocol_scope();
    let watcher_state = handle.state::<WatcherState>();

    match kind {
        WindowKind::Folder(canonical) => {
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
            watcher_state.seed_window_workspace(window_label, vec![canonical.clone()]);
            tracing::debug!(
                target: "window-scope",
                "[window-scope] watcher seeded folder for {window_label}: {}",
                canonical.display()
            );
        }
        WindowKind::FileOnly => {
            // De-duplicated parent dirs only; non-recursive scope.
            let mut parents: Vec<PathBuf> = files
                .iter()
                .filter_map(|f| f.parent().map(PathBuf::from))
                .collect();
            parents.sort();
            parents.dedup();
            for parent in &parents {
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
            if !parents.is_empty() {
                let n = parents.len();
                watcher_state.seed_window_workspace(window_label, parents);
                tracing::debug!(
                    target: "window-scope",
                    "[window-scope] watcher seeded {n} parent(s) for {window_label}"
                );
            }
        }
    }
}
