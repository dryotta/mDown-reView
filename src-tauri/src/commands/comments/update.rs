//! `update_comment` — consolidated patch surface for per-comment mutations.

use super::{enforce_workspace_path, CommentError, CommentsEmitter};
use crate::core::types::Reaction;
use crate::watcher::{SidecarConfigState, WatcherState};
use tauri::{AppHandle, Runtime, State};
use crate::mdr_command;

/// Patch payloads for `update_comment`. Discriminated enum (serde adjacent
/// `kind`/`data` tags) so the TS side can branch cleanly. Every per-comment
/// mutation flows through this enum so the IPC surface stays a single
/// chokepoint.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum CommentPatch {
    /// Append a reaction. Idempotent on (`user`, `kind`) — adding the same
    /// reaction twice from the same user is a no-op so renderer-side
    /// double-clicks don't pollute the sidecar.
    AddReaction {
        user: String,
        kind: String,
        ts: String,
    },
    /// Toggle resolved state. Canonical resolve/unresolve path — the
    /// legacy `set_comment_resolved` IPC command was removed in iter 2 to
    /// keep `update_comment` as the single per-comment mutation entry.
    SetResolved { resolved: bool },
}

/// Apply a [`CommentPatch`] to a single comment.
#[mdr_command]
pub fn update_comment<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, WatcherState>,
    config_state: State<'_, SidecarConfigState>,
    file_path: String,
    comment_id: String,
    patch: CommentPatch,
) -> Result<(), CommentError> {
    update_comment_inner(&app, &state, &config_state, file_path, comment_id, patch)
}

/// Test seam for [`update_comment`]. See `add_comment_inner` for rationale.
/// Calls [`update_comment_apply`] and emits `comments-changed` only when
/// the apply layer reports a real mutation.
pub fn update_comment_inner<E: CommentsEmitter>(
    emitter: &E,
    state: &WatcherState,
    config_state: &SidecarConfigState,
    file_path: String,
    comment_id: String,
    patch: CommentPatch,
) -> Result<(), CommentError> {
    enforce_workspace_path(state, &file_path)?;
    let changed = update_comment_apply(&file_path, &comment_id, patch, config_state)?;
    if changed {
        emitter.emit_comments_changed(&file_path);
    }
    Ok(())
}

/// Pure helper for [`update_comment`] — no `AppHandle`, no event emission.
/// **Does NOT emit `comments-changed`** — only call from a wrapper that
/// does (e.g. `update_comment`, `resolve_comment`).
/// Returns `true` if the sidecar was actually mutated, `false` for no-ops
/// (e.g. `SetResolved { resolved }` matching the comment's current state)
/// so the IPC entry point can skip both the save and the event emission.
/// Kept `pub` for integration tests that exercise the patch dispatch
/// without bringing up a Tauri runtime.
pub fn update_comment_apply(
    file_path: &str,
    comment_id: &str,
    patch: CommentPatch,
    config_state: &SidecarConfigState,
) -> Result<bool, String> {
    let (yaml, json, ws_root) = super::resolve_sidecar_pair(file_path, config_state);
    let mut sidecar = crate::core::sidecar::load_sidecar_at(&yaml, &json)
        .map_err(|e| e.to_string())?
        .ok_or("sidecar not found")?;
    let comment = sidecar
        .comments
        .iter_mut()
        .find(|c| c.id == comment_id)
        .ok_or_else(|| format!("comment {} not found", comment_id))?;
    let mutated = match patch {
        CommentPatch::AddReaction { user, kind, ts } => {
            let list = comment.reactions.get_or_insert_with(Vec::new);
            if list.iter().any(|r| r.user == user && r.kind == kind) {
                false
            } else {
                list.push(Reaction { user, kind, ts });
                true
            }
        }
        CommentPatch::SetResolved { resolved } => {
            // Compare-then-write: skip the save+emit cycle entirely if the
            // resolved bit isn't actually changing. Prevents the renderer
            // from getting an "events storm" of `comments-changed` for
            // no-op resolves (bug-hunter #9).
            if comment.resolved == resolved {
                false
            } else {
                comment.resolved = resolved;
                true
            }
        }
    };
    if mutated {
        super::save_with_parent_creation(&yaml, ws_root.as_deref(), &sidecar.document, &sidecar.comments)?;
    }
    Ok(mutated)
}
