//! Comment thread mutation commands (sidecar reads, writes, anchor hashing).
//!
//! Split into 6 submodules for the 400-LOC budget (architecture rule 23):
//! - `mod.rs` — workspace guard + CRUD entry points
//! - `anchor_input.rs` — `NewCommentAnchor` / `TaggedNewAnchor` wire types
//! - `badges.rs` — `get_file_badges`
//! - `badge_cache.rs` — per-file badge cache with mtime invalidation
//! - `get.rs` — `get_file_comments` (typed-anchor dispatch + matching)
//! - `update.rs` — `update_comment` + `CommentPatch`

use crate::core::mrsf_version::MRSF_VERSION_DEFAULT;
use crate::core::types::{Anchor, MrsfSidecar};
use std::path::Path;
use tauri::{AppHandle, Emitter, Runtime, State};

use crate::watcher::{SidecarConfigState, WatcherState};
use crate::mdr_command;

pub mod anchor_input;
pub mod badge_cache;
pub mod badges;
pub mod get;
pub mod update;

pub use anchor_input::{NewCommentAnchor, TaggedNewAnchor};

pub use badge_cache::BadgeCache;
pub use badges::{get_file_badges, get_file_badges_inner, FileBadge};
pub use get::{get_file_comments, get_file_comments_inner, GetFileCommentsResult};
pub use update::{update_comment, update_comment_apply, update_comment_inner, CommentPatch};

/// Payload emitted to the frontend after a mutation command modifies a sidecar.
#[derive(Clone, serde::Serialize)]
pub struct CommentsChangedEvent {
    pub file_path: String,
}

/// Workspace-path containment guard shared by every mutation/aggregator
/// command. Mirrors the convention from `stat_file_inner` (advisory #5):
/// rejects paths the user has not opened (a workspace dir or active tab).
///
/// Uses [`WatcherState::is_path_or_parent_allowed`] (not the strict
/// `is_path_allowed`) so mutations against deleted, renamed, or
/// editor-swapped files still succeed — these are routine for the orphan
/// comment / DeletedFileViewer flow and OneDrive/iCloud sync. The parent
/// directory must still canonicalize inside the workspace, so a symlink
/// trick cannot smuggle through.
///
/// Returns `"path not in workspace"` on rejection so callers can match the
/// same string the rest of the FS surface emits.
pub(crate) fn enforce_workspace_path(state: &WatcherState, file_path: &str) -> Result<(), String> {
    if state.is_path_or_parent_allowed(Path::new(file_path)) {
        Ok(())
    } else {
        // Critical for debugging "comment didn't save" reports: include the
        // canonical form (so reviewers can spot path-normalisation drift)
        // and the watched workspace dirs (so reviewers can spot scope
        // mismatches — e.g. file is in a *different* open folder, OR the
        // tab arrived before the watcher's `update_watched_files` /
        // `update_tree_watched_dirs` IPCs landed).
        let canonical = crate::core::paths::canonicalize_no_verbatim(Path::new(file_path))
            .map(|p| p.display().to_string())
            .unwrap_or_else(|e| format!("<canonicalize error: {e}>"));
        let watched_dirs = state.snapshot_watched_dirs_for_diagnostics();
        let watched_files = state.snapshot_watched_files_for_diagnostics();
        log::warn!(
            target: "mdownreview::comments",
            "[comments] rejected: path outside workspace file_path={} canonical={} watched_dirs={:?} watched_files={:?}",
            file_path, canonical, watched_dirs, watched_files
        );
        Err("path not in workspace".to_string())
    }
}

/// Test seam over the renderer-event channel. Production calls go through
/// `Emitter::emit(self, …)` — app-wide emit so all windows receive comment
/// updates. The trait exists *only* so integration tests can substitute a
/// counter-backed mock —
/// `tauri::test::mock_app()` cannot run on the Windows dev host (the test
/// feature pulls webview2/wry GUI DLLs that fail with
/// STATUS_ENTRYPOINT_NOT_FOUND), so a real-runtime emit is not reachable
/// from a `cargo test` binary.
pub trait CommentsEmitter {
    fn emit_comments_changed(&self, file_path: &str);
}

impl<R: Runtime> CommentsEmitter for AppHandle<R> {
    fn emit_comments_changed(&self, file_path: &str) {
        // App-wide emit so all windows receive comment updates.
        if let Err(e) = Emitter::emit(
            self,
            "comments-changed",
            CommentsChangedEvent {
                file_path: file_path.to_string(),
            },
        ) {
            tracing::warn!(error = ?e, "failed to emit comments-changed");
        }
    }
}

/// Thin wrapper around [`crate::core::paths::resolve_sidecar_pair`] that
/// extracts the workspace config from managed state.
pub(crate) fn resolve_sidecar_pair(
    file_path: &str,
    config_state: &SidecarConfigState,
) -> (String, String, Option<std::path::PathBuf>) {
    let file = Path::new(file_path);
    let config_data = config_state.resolve_for_file(file);
    let config = config_data.as_ref().map(|(ws, sr)| (ws.as_path(), sr));
    crate::core::paths::resolve_sidecar_pair(file, config)
}

/// Save a sidecar to a resolved path, creating parent dirs if needed.
pub(super) fn save_with_parent_creation(
    yaml_path: &str,
    ws_root: Option<&std::path::Path>,
    document: &str,
    comments: &[crate::core::types::MrsfComment],
) -> Result<(), String> {
    let save_path = std::path::PathBuf::from(yaml_path);
    if let Some(root) = ws_root {
        crate::core::paths::ensure_sidecar_parent(root, &save_path)
            .map_err(|e| e.to_string())?;
    }
    crate::core::sidecar::save_sidecar_at(&save_path, document, comments)
        .map_err(|e| e.to_string())
}

/// Load a sidecar, apply a mutation, save, and emit `comments-changed`.
fn with_sidecar_mut<E: CommentsEmitter>(
    emitter: &E,
    file_path: &str,
    config_state: &SidecarConfigState,
    mutate: impl FnOnce(&mut MrsfSidecar) -> Result<(), String>,
) -> Result<(), String> {
    let (yaml, json, ws_root) = resolve_sidecar_pair(file_path, config_state);
    log::debug!(
        target: "mdownreview::comments",
        "with_sidecar_mut: resolved file_path={} yaml={} json={} ws_root={:?}",
        file_path, yaml, json, ws_root
    );
    let mut sidecar = crate::core::sidecar::load_sidecar_at(&yaml, &json)
        .map_err(|e| {
            log::warn!(
                target: "mdownreview::comments",
                "with_sidecar_mut: load_sidecar_at failed file_path={} yaml={} error={}",
                file_path, yaml, e
            );
            e.to_string()
        })?
        .ok_or_else(|| {
            log::warn!(
                target: "mdownreview::comments",
                "with_sidecar_mut: sidecar not found  mutation rejected file_path={} yaml={} json={}",
                file_path, yaml, json
            );
            "sidecar not found".to_string()
        })?;
    mutate(&mut sidecar)?;
    save_with_parent_creation(&yaml, ws_root.as_deref(), &sidecar.document, &sidecar.comments)?;
    log::info!(
        target: "mdownreview::comments",
        "with_sidecar_mut: saved sidecar file_path={} yaml={} comment_count={}",
        file_path, yaml, sidecar.comments.len()
    );
    emitter.emit_comments_changed(file_path);
    Ok(())
}

/// Pure helper: load an existing sidecar OR create an empty default,
/// apply a mutation, then save. **Does NOT emit `comments-changed`** —
/// only call from a wrapper that does (e.g. `with_sidecar_or_create`).
/// Kept `pub` for integration tests that exercise the create-or-update
/// path without bringing up a Tauri runtime.
pub fn mutate_sidecar_or_create(
    file_path: &str,
    document_default: Option<String>,
    config_state: &SidecarConfigState,
    mutate: impl FnOnce(&mut MrsfSidecar) -> Result<(), String>,
) -> Result<(), String> {
    let (yaml, json, ws_root) = resolve_sidecar_pair(file_path, config_state);
    log::debug!(
        target: "mdownreview::comments",
        "mutate_sidecar_or_create: resolved file_path={} yaml={} json={} ws_root={:?}",
        file_path, yaml, json, ws_root
    );
    let mut sidecar = crate::core::sidecar::load_sidecar_at(&yaml, &json)
        .map_err(|e| {
            log::warn!(
                target: "mdownreview::comments",
                "mutate_sidecar_or_create: load_sidecar_at failed file_path={} yaml={} error={}",
                file_path, yaml, e
            );
            e.to_string()
        })?
        .unwrap_or_else(|| {
            log::debug!(
                target: "mdownreview::comments",
                "mutate_sidecar_or_create: no existing sidecar  creating empty default file_path={}",
                file_path
            );
            MrsfSidecar {
                mrsf_version: MRSF_VERSION_DEFAULT.to_string(),
                document: document_default.unwrap_or_else(|| {
                    std::path::Path::new(file_path)
                        .file_name()
                        .map(|n| n.to_string_lossy().into_owned())
                        .unwrap_or_default()
                }),
                comments: vec![],
            }
        });
    mutate(&mut sidecar)?;
    save_with_parent_creation(&yaml, ws_root.as_deref(), &sidecar.document, &sidecar.comments)?;
    log::info!(
        target: "mdownreview::comments",
        "mutate_sidecar_or_create: saved sidecar file_path={} yaml={} comment_count={}",
        file_path, yaml, sidecar.comments.len()
    );
    Ok(())
}

/// Like `with_sidecar_mut` but creates an empty default sidecar if none exists.
/// Use for "create" operations (e.g. adding the first comment to a file).
fn with_sidecar_or_create<E: CommentsEmitter>(
    emitter: &E,
    file_path: &str,
    document_default: Option<String>,
    config_state: &SidecarConfigState,
    mutate: impl FnOnce(&mut MrsfSidecar) -> Result<(), String>,
) -> Result<(), String> {
    mutate_sidecar_or_create(file_path, document_default, config_state, mutate)?;
    emitter.emit_comments_changed(file_path);
    Ok(())
}

// `get_file_comments` lives in [`get`] (split out to keep this file under
// the architecture rule 23 LOC budget). Re-exported above so the IPC
// registration in `lib.rs` stays unchanged.

/// Create a new comment, save to sidecar.
///
/// `clippy::too_many_arguments` is intentionally permitted here: this is a
/// `#[tauri::command]`, so its parameter list is the IPC wire shape consumed
/// by `invoke("add_comment", { ... })` on the JS side. Grouping arguments
/// into a struct would change the wire contract.
#[allow(clippy::too_many_arguments)]
#[mdr_command]
pub fn add_comment<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, WatcherState>,
    config_state: State<'_, SidecarConfigState>,
    file_path: String,
    author: String,
    text: String,
    anchor: Option<NewCommentAnchor>,
    comment_type: Option<String>,
    severity: Option<String>,
    document: Option<String>,
) -> Result<(), String> {
    add_comment_inner(
        &app,
        &state,
        &config_state,
        file_path,
        author,
        text,
        anchor,
        comment_type,
        severity,
        document,
    )
}

/// Test seam for [`add_comment`]. Production code should never call this
/// directly — it exists so the integration tests in
/// `tests/comments_emit_test.rs` can exercise the full mutation +
/// emit pipeline without bringing up a Tauri runtime (which on Windows
/// pulls in a heavier-than-test-binary set of GUI DLLs via tauri's
/// `test` feature). Mirrors the public signature 1:1.
#[allow(clippy::too_many_arguments)]
pub fn add_comment_inner<E: CommentsEmitter>(
    emitter: &E,
    state: &WatcherState,
    config_state: &SidecarConfigState,
    file_path: String,
    author: String,
    text: String,
    anchor: Option<NewCommentAnchor>,
    comment_type: Option<String>,
    severity: Option<String>,
    document: Option<String>,
) -> Result<(), String> {
    // Entry trace: every comment-mutation call lands here, so this is the
    // single chokepoint for "is the IPC even arriving and with what?"
    // questions. Logging at info level so it surfaces in default logs
    // without enabling debug. `anchor_kind` is the most useful single
    // discriminator for tracking down file-anchor-vs-line-anchor issues.
    let anchor_kind = match &anchor {
        None => "none".to_string(),
        Some(NewCommentAnchor::Legacy(_)) => "legacy_line".to_string(),
        Some(NewCommentAnchor::Tagged(t)) => match t {
            TaggedNewAnchor::Line { .. } => "line".to_string(),
            TaggedNewAnchor::File => "file".to_string(),
            TaggedNewAnchor::WordRange(_) => "word_range".to_string(),
        },
    };
    log::info!(
        target: "mdownreview::comments",
        "add_comment_inner: entry file_path={} author={} text_len={} anchor_kind={} comment_type={:?} severity={:?} document={:?}",
        file_path, author, text.len(), anchor_kind, comment_type, severity, document
    );
    enforce_workspace_path(state, &file_path)?;
    // Convert wire anchor → (canonical Anchor, optional flat legacy fields).
    // For Line/Legacy we pass the flat shape into `create_comment` so the
    // MrsfComment's legacy `line`/`selected_text` fields stay populated.
    // For File/typed anchors we override `comment.anchor` after the fact —
    // the flat fields stay None so downstream readers don't mistake a
    // file-anchored comment for a line-1 one.
    let (canonical, flat) = match anchor {
        Some(a) => {
            let (anc, flat) = a.into_anchor_pair();
            (Some(anc), flat)
        }
        None => (None, None),
    };
    let mut comment = crate::core::comments::create_comment(
        &author,
        &text,
        flat,
        comment_type.as_deref(),
        severity.as_deref(),
    );
    if let Some(canonical) = canonical {
        // Non-Line canonical anchors override the create_comment default.
        // For file/typed variants, also clear the flat line shadow so the
        // resulting MrsfComment is internally consistent.
        if !matches!(canonical, Anchor::Line { .. }) {
            comment.line = None;
            comment.end_line = None;
            comment.start_column = None;
            comment.end_column = None;
            comment.selected_text = None;
            comment.selected_text_hash = None;
        }
        comment.anchor = canonical;
    }
    let comment_id = comment.id.clone();
    let result = with_sidecar_or_create(emitter, &file_path, document, config_state, |sidecar| {
        sidecar.comments.push(comment);
        Ok(())
    });
    match &result {
        Ok(()) => log::info!(
            target: "mdownreview::comments",
            "add_comment_inner: ok file_path={} comment_id={}",
            file_path, comment_id
        ),
        Err(e) => log::warn!(
            target: "mdownreview::comments",
            "add_comment_inner: failed file_path={} error={}",
            file_path, e
        ),
    }
    result
}

/// Test seam: calls `enforce_workspace_path` for each retrofitted command so
/// integration tests can verify the guard is wired without bringing up a
/// Tauri runtime. Not registered at the IPC layer; only the
/// `#[tauri::command]` handlers above are.
pub fn check_workspace_for(
    command: &str,
    state: &WatcherState,
    file_path: &str,
) -> Result<(), String> {
    let _ = command;
    enforce_workspace_path(state, file_path)
}

/// Create a reply to an existing comment, save to sidecar.
#[mdr_command]
pub fn add_reply<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, WatcherState>,
    config_state: State<'_, SidecarConfigState>,
    file_path: String,
    parent_id: String,
    author: String,
    text: String,
) -> Result<(), String> {
    add_reply_inner(&app, &state, &config_state, file_path, parent_id, author, text)
}

/// Test seam for [`add_reply`]. See [`add_comment_inner`] for rationale.
pub fn add_reply_inner<E: CommentsEmitter>(
    emitter: &E,
    state: &WatcherState,
    config_state: &SidecarConfigState,
    file_path: String,
    parent_id: String,
    author: String,
    text: String,
) -> Result<(), String> {
    log::info!(
        target: "mdownreview::comments",
        "add_reply_inner: entry file_path={} parent_id={} author={} text_len={}",
        file_path, parent_id, author, text.len()
    );
    enforce_workspace_path(state, &file_path)?;
    let result = with_sidecar_mut(emitter, &file_path, config_state, |sidecar| {
        let parent = sidecar
            .comments
            .iter()
            .find(|c| c.id == parent_id)
            .ok_or_else(|| format!("parent comment {} not found", parent_id))?
            .clone();
        let reply = crate::core::comments::create_reply(&author, &text, &parent);
        sidecar.comments.push(reply);
        Ok(())
    });
    if let Err(ref e) = result {
        log::warn!(
            target: "mdownreview::comments",
            "add_reply_inner: failed file_path={} parent_id={} error={}",
            file_path, parent_id, e
        );
    }
    result
}

/// Edit a comment's text, save to sidecar.
#[mdr_command]
pub fn edit_comment<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, WatcherState>,
    config_state: State<'_, SidecarConfigState>,
    file_path: String,
    comment_id: String,
    text: String,
) -> Result<(), String> {
    edit_comment_inner(&app, &state, &config_state, file_path, comment_id, text)
}

/// Test seam for [`edit_comment`]. See [`add_comment_inner`] for rationale.
pub fn edit_comment_inner<E: CommentsEmitter>(
    emitter: &E,
    state: &WatcherState,
    config_state: &SidecarConfigState,
    file_path: String,
    comment_id: String,
    text: String,
) -> Result<(), String> {
    log::info!(
        target: "mdownreview::comments",
        "edit_comment_inner: entry file_path={} comment_id={} text_len={}",
        file_path, comment_id, text.len()
    );
    enforce_workspace_path(state, &file_path)?;
    let result = with_sidecar_mut(emitter, &file_path, config_state, |sidecar| {
        let comment = sidecar
            .comments
            .iter_mut()
            .find(|c| c.id == comment_id)
            .ok_or_else(|| format!("comment {} not found", comment_id))?;
        comment.text = crate::core::comments::clamp_comment_text(&text);
        Ok(())
    });
    if let Err(ref e) = result {
        log::warn!(
            target: "mdownreview::comments",
            "edit_comment_inner: failed file_path={} comment_id={} error={}",
            file_path, comment_id, e
        );
    }
    result
}

/// Delete a comment (with reply reparenting per MRSF §9.1), save to sidecar.
#[mdr_command]
pub fn delete_comment<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, WatcherState>,
    config_state: State<'_, SidecarConfigState>,
    file_path: String,
    comment_id: String,
) -> Result<(), String> {
    delete_comment_inner(&app, &state, &config_state, file_path, comment_id)
}

/// Test seam for [`delete_comment`]. See [`add_comment_inner`] for rationale.
pub fn delete_comment_inner<E: CommentsEmitter>(
    emitter: &E,
    state: &WatcherState,
    config_state: &SidecarConfigState,
    file_path: String,
    comment_id: String,
) -> Result<(), String> {
    log::info!(
        target: "mdownreview::comments",
        "delete_comment_inner: entry file_path={} comment_id={}",
        file_path, comment_id
    );
    enforce_workspace_path(state, &file_path)?;
    let result = with_sidecar_mut(emitter, &file_path, config_state, |sidecar| {
        sidecar.comments = crate::core::comments::delete_comment(&sidecar.comments, &comment_id);
        Ok(())
    });
    if let Err(ref e) = result {
        log::warn!(
            target: "mdownreview::comments",
            "delete_comment_inner: failed file_path={} comment_id={} error={}",
            file_path, comment_id, e
        );
    }
    result
}

/// Compute SHA-256 hash for selected text anchor.
#[mdr_command]
pub fn compute_anchor_hash(text: String) -> String {
    crate::core::anchors::compute_selected_text_hash(&text)
}

// Note: `set_resolved` is exposed via the `update_comment` patch kind
// (see `update.rs::CommentPatch`). The frontend uses
// `updateComment(...)` with `{ kind: "set_resolved", ... }`
// rather than a dedicated IPC command.

#[cfg(test)]
mod event_payload_tests {
    use super::*;

    /// Pins the JSON wire shape of `CommentsChangedEvent`. Mirror of the
    /// `ipc_event_payloads_serialize_to_frontend_contract` test in
    /// `src-tauri/src/watcher_tests.rs`. See `EventPayloads["comments-changed"]`
    /// in `src/lib/tauri-events.ts` and the `commentsChanged` fixture in
    /// `src/__tests__/fixtures/ipc-event-fixtures.ts`.
    #[test]
    fn comments_changed_event_serializes_to_frontend_contract() {
        use serde_json::json;
        assert_eq!(
            serde_json::to_value(CommentsChangedEvent {
                file_path: "/workspace/notes.md".to_string(),
            })
            .unwrap(),
            json!({ "file_path": "/workspace/notes.md" }),
            "CommentsChangedEvent wire shape drifted (note snake_case file_path)"
        );
    }
}