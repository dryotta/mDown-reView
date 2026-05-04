//! Multi-window file singleton (issue #352 / iter-15).
//!
//! Pre-iter-15 limitation: opening the same file in two windows could
//! silently overwrite a user's edits — the second window's auto-save
//! clobbered the first window's in-flight scene
//! (`docs/features/excalidraw.md` Known Limitations). The carve-out
//! ("comments are indestructible" extended to file content) demanded
//! a real fix, not a documented foot-gun.
//!
//! This module owns the **singleton-per-file invariant**: a canonical
//! file path is open in at most ONE window at a time. The product
//! decision was *focus-existing* (rubber-duck refined): when window B
//! tries to open file X already in window A, focus window A, select
//! its tab on X, and bail in window B.
//!
//! ## Lifecycle
//!
//! - **Claim** (`claim_open_file`): renderer's `openFile` action
//!   awaits this BEFORE adding the tab. Returns `Claimed` for unowned
//!   paths or same-window re-claims (idempotent). Returns
//!   `OwnedElsewhere { window_label }` if another live window owns
//!   the path; in that case the Rust handler also raises the owner
//!   window via `focus_window` (un-minimize → show → set-focus) and
//!   emits `focus-tab` to the owner so its renderer selects the tab.
//! - **Release** (`release_open_file`, `release_open_files`):
//!   renderer fires from `closeTab` / `closeAllTabs` / LRU-evict.
//!   Only the owning window's release succeeds (idempotent for
//!   non-owners). If the file has been deleted between tab-close and
//!   the IPC, canonicalisation fails; we fall back to matching the
//!   raw path string against stored keys — the window-destroy sweep
//!   is the final safety net.
//! - **Window destroy sweep** (`purge_window`): called from the
//!   `WindowEvent::Destroyed` handler in `lib.rs`. Removes every
//!   entry owned by the dying window's label, defending against
//!   leaks if the renderer crashed before releasing.
//! - **Stale-owner reap**: at every claim, if the existing owner's
//!   label is not in `app.webview_windows()` (window force-killed,
//!   never destroyed cleanly), drop the stale entry inline so the
//!   new claimant wins.
//!
//! ## Why a separate primitive
//!
//! `WatcherState::watched_paths` (`watcher.rs:17-34`) is per-window
//! file-change subscriptions, not ownership. Different lifecycle —
//! tabs are added/removed by the renderer; watched paths sync from
//! the merged tree-watched dirs + per-tab file paths. Don't merge.
//! This is also a generic primitive — future per-file singletons
//! (Mermaid editor, CSV cell-edit) reuse the same module.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, Emitter, Manager};

use crate::core::paths::canonicalize_no_verbatim;
use crate::focus_window;
use crate::mdr_command;

/// Per-app singleton tracking which window owns each canonical file
/// path. Wrapped in a `Mutex<HashMap>` because contention is
/// negligible (one mutation per tab open/close, well under 10 Hz
/// even during heavy editing) and the hot read path —
/// `claim_open_file` — is bounded by a single hash lookup.
#[derive(Default)]
pub struct OpenFileRegistry {
    inner: Mutex<HashMap<PathBuf, String>>,
}

impl OpenFileRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Pure-logic claim that takes a `is_window_alive` predicate so
    /// unit tests don't need an `AppHandle`. The IPC wrapper
    /// (`claim_open_file`) supplies the predicate via
    /// `app.webview_windows()`.
    pub(crate) fn try_claim(
        &self,
        canonical: PathBuf,
        caller_label: &str,
        is_window_alive: impl Fn(&str) -> bool,
    ) -> ClaimResult {
        let mut map = match self.inner.lock() {
            Ok(m) => m,
            // Lock poisoned — fail open (don't permanently block
            // opens). The next successful claim re-establishes
            // ownership; cross-window safety degrades to pre-iter-15
            // behaviour, never worse.
            Err(_) => return ClaimResult::Claimed,
        };
        // Stale-owner reap.
        if let Some(owner) = map.get(&canonical) {
            if !is_window_alive(owner) {
                map.remove(&canonical);
            }
        }
        if let Some(owner) = map.get(&canonical) {
            if owner == caller_label {
                // Same-window re-claim is a no-op success.
                return ClaimResult::Claimed;
            }
            return ClaimResult::OwnedElsewhere {
                window_label: owner.clone(),
            };
        }
        map.insert(canonical, caller_label.to_string());
        ClaimResult::Claimed
    }

    /// Release a single canonical key if `caller_label` owns it.
    /// Idempotent — non-owner releases are a no-op (no error).
    pub(crate) fn try_release(&self, canonical: &Path, caller_label: &str) {
        if let Ok(mut map) = self.inner.lock() {
            if let Some(owner) = map.get(canonical) {
                if owner == caller_label {
                    map.remove(canonical);
                }
            }
        }
    }

    /// Remove every entry owned by `label`. Called from the
    /// `WindowEvent::Destroyed` handler so a force-killed renderer
    /// (or any unclean close path) doesn't leak claims.
    pub fn purge_window(&self, label: &str) {
        if let Ok(mut map) = self.inner.lock() {
            map.retain(|_, owner| owner != label);
        }
    }

    /// Snapshot for tests + diagnostics. Returns a clone so callers
    /// don't hold the lock.
    #[cfg(test)]
    pub fn snapshot(&self) -> HashMap<PathBuf, String> {
        self.inner
            .lock()
            .map(|m| m.clone())
            .unwrap_or_default()
    }
}

/// Wire-shape for the claim result. Kebab-case discriminator, same
/// pattern as `WorkspaceWriteError` in `commands/fs_write.rs`.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ClaimResult {
    /// Caller now owns the path (or already did — idempotent).
    Claimed,
    /// Another live window owns the path. Renderer should NOT add a
    /// tab; the Rust handler has already raised the owner window and
    /// emitted `focus-tab` to it. The label is exposed so the
    /// renderer can log / surface diagnostics; callers don't need it
    /// for the main flow.
    OwnedElsewhere { window_label: String },
}

/// Renderer-side `openFile` action awaits this before adding a tab.
/// Returns `Claimed` for unowned paths or same-window re-claims.
/// Returns `OwnedElsewhere` when another live window owns the path,
/// in which case Rust ALSO focuses the owner window and emits
/// `focus-tab` to it — the renderer just needs to bail.
#[mdr_command]
pub fn claim_open_file(
    path: String,
    window: tauri::Window,
    app: AppHandle,
    state: tauri::State<'_, OpenFileRegistry>,
) -> Result<ClaimResult, String> {
    let canonical = canonicalize_no_verbatim(Path::new(&path))
        .map_err(|e| format!("canonicalize failed for {path}: {e}"))?;
    let caller_label = window.label().to_string();
    let app_for_check = app.clone();
    let result = state.try_claim(canonical, &caller_label, move |lbl| {
        app_for_check.webview_windows().contains_key(lbl)
    });
    if let ClaimResult::OwnedElsewhere { ref window_label } = result {
        // Focus the owner via the existing helper (un-minimize → show
        // → set-focus). On macOS where the last visible window is
        // hidden instead of destroyed (`lib.rs:820-839`), `show()`
        // un-hides; renderer-only `setFocus` would be insufficient.
        if let Some(owner_win) = app.get_webview_window(window_label) {
            focus_window(&owner_win);
        }
        // Emit `focus-tab` window-scoped to the owner so its
        // renderer selects the tab via `setActiveTab(path)`.
        let _ = app.emit_to(window_label.as_str(), "focus-tab", &path);
    }
    Ok(result)
}

/// Renderer fires this from `closeTab` / single-tab eviction. Only
/// the owner releases. Idempotent — non-owners and missing entries
/// are no-ops. If the file has been deleted between tab-close and
/// the IPC, canonicalisation fails; we still attempt a path-string
/// match against stored keys, and the destroy-window sweep is the
/// final safety net.
#[mdr_command]
pub fn release_open_file(
    path: String,
    window: tauri::Window,
    state: tauri::State<'_, OpenFileRegistry>,
) -> Result<(), String> {
    let label = window.label().to_string();
    let target = Path::new(&path);
    if let Ok(canonical) = canonicalize_no_verbatim(target) {
        state.try_release(&canonical, &label);
    }
    // Belt-and-braces — release by raw input path too in case the
    // stored key matches verbatim (rare, but defends the corner
    // where a file was opened then deleted before close).
    state.try_release(target, &label);
    Ok(())
}

/// Bulk release for `closeAllTabs` / multi-tab eviction. Same
/// semantics as `release_open_file` per path.
#[mdr_command]
pub fn release_open_files(
    paths: Vec<String>,
    window: tauri::Window,
    state: tauri::State<'_, OpenFileRegistry>,
) -> Result<(), String> {
    let label = window.label().to_string();
    for path in &paths {
        let target = Path::new(path);
        if let Ok(canonical) = canonicalize_no_verbatim(target) {
            state.try_release(&canonical, &label);
        }
        state.try_release(target, &label);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn alive_set<'a>(labels: &'a [&'a str]) -> impl Fn(&str) -> bool + 'a {
        move |lbl: &str| labels.iter().any(|l| *l == lbl)
    }

    #[test]
    fn claim_unowned_returns_claimed_and_records_owner() {
        let reg = OpenFileRegistry::new();
        let canonical = PathBuf::from("/ws/a.excalidraw");
        let result = reg.try_claim(canonical.clone(), "win-a", alive_set(&["win-a"]));
        assert!(matches!(result, ClaimResult::Claimed));
        let snap = reg.snapshot();
        assert_eq!(snap.get(&canonical), Some(&"win-a".to_string()));
    }

    #[test]
    fn claim_same_window_is_idempotent_no_op_success() {
        let reg = OpenFileRegistry::new();
        let canonical = PathBuf::from("/ws/a.excalidraw");
        reg.try_claim(canonical.clone(), "win-a", alive_set(&["win-a"]));
        let result = reg.try_claim(canonical.clone(), "win-a", alive_set(&["win-a"]));
        assert!(matches!(result, ClaimResult::Claimed));
        assert_eq!(reg.snapshot().len(), 1);
    }

    #[test]
    fn claim_other_live_window_returns_owned_elsewhere() {
        let reg = OpenFileRegistry::new();
        let canonical = PathBuf::from("/ws/a.excalidraw");
        reg.try_claim(canonical.clone(), "win-a", alive_set(&["win-a", "win-1"]));
        let result = reg.try_claim(canonical, "win-1", alive_set(&["win-a", "win-1"]));
        match result {
            ClaimResult::OwnedElsewhere { window_label } => {
                assert_eq!(window_label, "win-a");
            }
            other => panic!("expected OwnedElsewhere, got {other:?}"),
        }
    }

    #[test]
    fn claim_reaps_stale_owner_when_window_no_longer_alive() {
        // Window "win-a" claimed, then died without a clean release.
        // A subsequent claim from "win-1" should reap and succeed.
        let reg = OpenFileRegistry::new();
        let canonical = PathBuf::from("/ws/a.excalidraw");
        reg.try_claim(canonical.clone(), "win-a", alive_set(&["win-a", "win-1"]));
        // Now "win-a" is gone (force-killed, no clean Destroyed).
        let result = reg.try_claim(canonical.clone(), "win-1", alive_set(&["win-1"]));
        assert!(
            matches!(result, ClaimResult::Claimed),
            "expected Claimed (stale main reaped), got {result:?}"
        );
        assert_eq!(
            reg.snapshot().get(&canonical),
            Some(&"win-1".to_string()),
            "win-1 should be the new owner",
        );
    }

    #[test]
    fn release_by_owner_removes_entry() {
        let reg = OpenFileRegistry::new();
        let canonical = PathBuf::from("/ws/a.excalidraw");
        reg.try_claim(canonical.clone(), "win-a", alive_set(&["win-a"]));
        reg.try_release(&canonical, "win-a");
        assert!(reg.snapshot().is_empty());
    }

    #[test]
    fn release_by_non_owner_is_no_op() {
        let reg = OpenFileRegistry::new();
        let canonical = PathBuf::from("/ws/a.excalidraw");
        reg.try_claim(canonical.clone(), "win-a", alive_set(&["win-a"]));
        reg.try_release(&canonical, "win-1");
        assert_eq!(
            reg.snapshot().get(&canonical),
            Some(&"win-a".to_string()),
            "non-owner release must NOT remove entry",
        );
    }

    #[test]
    fn release_unknown_path_is_no_op() {
        let reg = OpenFileRegistry::new();
        let canonical = PathBuf::from("/ws/never-claimed.excalidraw");
        reg.try_release(&canonical, "win-a");
        assert!(reg.snapshot().is_empty());
    }

    #[test]
    fn purge_window_removes_all_entries_for_label() {
        let reg = OpenFileRegistry::new();
        reg.try_claim(
            PathBuf::from("/ws/a.excalidraw"),
            "win-a",
            alive_set(&["win-a", "win-1"]),
        );
        reg.try_claim(
            PathBuf::from("/ws/b.excalidraw"),
            "win-a",
            alive_set(&["win-a", "win-1"]),
        );
        reg.try_claim(
            PathBuf::from("/ws/c.excalidraw"),
            "win-1",
            alive_set(&["win-a", "win-1"]),
        );
        reg.purge_window("win-a");
        let snap = reg.snapshot();
        assert_eq!(snap.len(), 1);
        assert_eq!(
            snap.get(&PathBuf::from("/ws/c.excalidraw")),
            Some(&"win-1".to_string()),
        );
    }
}

