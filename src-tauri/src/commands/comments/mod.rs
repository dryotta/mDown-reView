//! Comment thread mutation commands (sidecar reads, writes, anchor hashing).
//!
//! Split into 5 submodules for the 400-LOC budget (architecture rule 23):
//! - `mod.rs` — workspace guard + CRUD entry points
//! - `badges.rs` — `get_file_badges`
//! - `export.rs` — `export_review_summary`
//! - `get.rs` — `get_file_comments` (typed-anchor dispatch + matching)
//! - `update.rs` — `update_comment` + `CommentPatch`

use crate::core::mrsf_version::MRSF_VERSION_DEFAULT;
use crate::core::types::{
    Anchor, CommentAnchor, CsvCellAnchor, HtmlElementAnchor, HtmlRangeAnchor, ImageRectAnchor,
    JsonPathAnchor, MrsfSidecar, WordRangePayload,
};
use serde::Deserialize;
use std::path::Path;
use tauri::{AppHandle, Emitter, Runtime, State};

use crate::watcher::WatcherState;

pub mod badges;
pub mod export;
pub mod get;
pub mod update;

pub use badges::{get_file_badges, get_file_badges_inner, FileBadge};
pub use export::{export_review_summary, export_review_summary_inner};
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
        tracing::warn!("[comments] rejected: path outside workspace: {file_path}");
        Err("path not in workspace".to_string())
    }
}

/// Test seam over the renderer-event channel. Production calls go through
/// `Emitter::emit_to(self, "main", …)` per `docs/design-patterns.md` rule 4
/// (Rust emits window-scoped events, never app-wide broadcasts). The trait
/// exists *only* so integration tests can substitute a counter-backed mock —
/// `tauri::test::mock_app()` cannot run on the Windows dev host (the test
/// feature pulls webview2/wry GUI DLLs that fail with
/// STATUS_ENTRYPOINT_NOT_FOUND), so a real-runtime emit is not reachable
/// from a `cargo test` binary.
pub trait CommentsEmitter {
    fn emit_comments_changed(&self, file_path: &str);
}

impl<R: Runtime> CommentsEmitter for AppHandle<R> {
    fn emit_comments_changed(&self, file_path: &str) {
        // Window-scoped emit per docs/design-patterns.md rule 4. The renderer
        // subscribes via `listen("comments-changed", …)` on the "main" window,
        // which receives both window-scoped and app-wide events.
        if let Err(e) = Emitter::emit_to(
            self,
            "main",
            "comments-changed",
            CommentsChangedEvent {
                file_path: file_path.to_string(),
            },
        ) {
            tracing::warn!(error = ?e, "failed to emit comments-changed");
        }
    }
}

/// Load a sidecar, apply a mutation, save, and emit `comments-changed`.
fn with_sidecar_mut<E: CommentsEmitter>(
    emitter: &E,
    file_path: &str,
    mutate: impl FnOnce(&mut MrsfSidecar) -> Result<(), String>,
) -> Result<(), String> {
    let mut sidecar = crate::core::sidecar::load_sidecar(file_path)
        .map_err(|e| e.to_string())?
        .ok_or("sidecar not found")?;
    mutate(&mut sidecar)?;
    crate::core::sidecar::save_sidecar(file_path, &sidecar.document, &sidecar.comments)
        .map_err(|e| e.to_string())?;
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
    mutate: impl FnOnce(&mut MrsfSidecar) -> Result<(), String>,
) -> Result<(), String> {
    let mut sidecar = crate::core::sidecar::load_sidecar(file_path)
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| MrsfSidecar {
            mrsf_version: MRSF_VERSION_DEFAULT.to_string(),
            document: document_default.unwrap_or_else(|| {
                std::path::Path::new(file_path)
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default()
            }),
            comments: vec![],
        });
    mutate(&mut sidecar)?;
    crate::core::sidecar::save_sidecar(file_path, &sidecar.document, &sidecar.comments)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Like `with_sidecar_mut` but creates an empty default sidecar if none exists.
/// Use for "create" operations (e.g. adding the first comment to a file).
fn with_sidecar_or_create<E: CommentsEmitter>(
    emitter: &E,
    file_path: &str,
    document_default: Option<String>,
    mutate: impl FnOnce(&mut MrsfSidecar) -> Result<(), String>,
) -> Result<(), String> {
    mutate_sidecar_or_create(file_path, document_default, mutate)?;
    emitter.emit_comments_changed(file_path);
    Ok(())
}

// `get_file_comments` lives in [`get`] (split out to keep this file under
// the architecture rule 23 LOC budget). Re-exported above so the IPC
// registration in `lib.rs` stays unchanged.

/// Wire-format anchor for `add_comment`. Accepts BOTH the legacy flat
/// `{ line, ... }` shape used by line-anchored composers and the tagged
/// `{ kind: "...", ... }` shape introduced for file-level + typed
/// anchors (Group A/B). Untagged so the JS chokepoint (`addComment` in
/// `lib/tauri-commands.ts`) does not have to convert.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum NewCommentAnchor {
    Tagged(TaggedNewAnchor),
    Legacy(CommentAnchor),
}

/// Tagged variant of [`NewCommentAnchor`]. Mirrors the TS `Anchor` union
/// in `src/types/comments.ts` — discriminator is `kind`, payload fields
/// are flattened alongside it (internally tagged).
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TaggedNewAnchor {
    Line {
        line: u32,
        #[serde(default)]
        end_line: Option<u32>,
        #[serde(default)]
        start_column: Option<u32>,
        #[serde(default)]
        end_column: Option<u32>,
        #[serde(default)]
        selected_text: Option<String>,
        #[serde(default)]
        selected_text_hash: Option<String>,
    },
    File,
    ImageRect(ImageRectAnchor),
    CsvCell(CsvCellAnchor),
    JsonPath(JsonPathAnchor),
    HtmlRange(HtmlRangeAnchor),
    HtmlElement(HtmlElementAnchor),
    WordRange(WordRangePayload),
}

impl NewCommentAnchor {
    /// Convert into the canonical in-memory [`Anchor`] enum + a legacy
    /// flat [`CommentAnchor`] (used by `create_comment` to populate the
    /// MrsfComment's flat line fields). For non-Line variants, the flat
    /// fields are left as the default — callers must not rely on them.
    /// Exposed `pub` for integration tests of `add_comment`'s anchor
    /// dispatch (the `#[tauri::command]` itself can't be invoked outside
    /// a Tauri runtime).
    pub fn into_anchor_pair(self) -> (Anchor, Option<CommentAnchor>) {
        match self {
            NewCommentAnchor::Legacy(c) => {
                let anchor = Anchor::Line {
                    line: c.line,
                    end_line: c.end_line,
                    start_column: c.start_column,
                    end_column: c.end_column,
                    selected_text: c.selected_text.clone(),
                    selected_text_hash: c.selected_text_hash.clone(),
                };
                (anchor, Some(c))
            }
            NewCommentAnchor::Tagged(TaggedNewAnchor::Line {
                line,
                end_line,
                start_column,
                end_column,
                selected_text,
                selected_text_hash,
            }) => {
                let flat = CommentAnchor {
                    line,
                    end_line,
                    start_column,
                    end_column,
                    selected_text: selected_text.clone(),
                    selected_text_hash: selected_text_hash.clone(),
                };
                let anchor = Anchor::Line {
                    line,
                    end_line,
                    start_column,
                    end_column,
                    selected_text,
                    selected_text_hash,
                };
                (anchor, Some(flat))
            }
            NewCommentAnchor::Tagged(TaggedNewAnchor::File) => (Anchor::File, None),
            NewCommentAnchor::Tagged(TaggedNewAnchor::ImageRect(p)) => (Anchor::ImageRect(p), None),
            NewCommentAnchor::Tagged(TaggedNewAnchor::CsvCell(p)) => (Anchor::CsvCell(p), None),
            NewCommentAnchor::Tagged(TaggedNewAnchor::JsonPath(p)) => (Anchor::JsonPath(p), None),
            NewCommentAnchor::Tagged(TaggedNewAnchor::HtmlRange(p)) => (Anchor::HtmlRange(p), None),
            NewCommentAnchor::Tagged(TaggedNewAnchor::HtmlElement(p)) => {
                (Anchor::HtmlElement(p), None)
            }
            NewCommentAnchor::Tagged(TaggedNewAnchor::WordRange(p)) => (Anchor::WordRange(p), None),
        }
    }
}

/// Create a new comment, save to sidecar.
///
/// `clippy::too_many_arguments` is intentionally permitted here: this is a
/// `#[tauri::command]`, so its parameter list is the IPC wire shape consumed
/// by `invoke("add_comment", { ... })` on the JS side. Grouping arguments
/// into a struct would change the wire contract.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn add_comment<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, WatcherState>,
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
    file_path: String,
    author: String,
    text: String,
    anchor: Option<NewCommentAnchor>,
    comment_type: Option<String>,
    severity: Option<String>,
    document: Option<String>,
) -> Result<(), String> {
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
    with_sidecar_or_create(emitter, &file_path, document, |sidecar| {
        sidecar.comments.push(comment);
        Ok(())
    })
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
#[tauri::command]
pub fn add_reply<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, WatcherState>,
    file_path: String,
    parent_id: String,
    author: String,
    text: String,
) -> Result<(), String> {
    add_reply_inner(&app, &state, file_path, parent_id, author, text)
}

/// Test seam for [`add_reply`]. See [`add_comment_inner`] for rationale.
pub fn add_reply_inner<E: CommentsEmitter>(
    emitter: &E,
    state: &WatcherState,
    file_path: String,
    parent_id: String,
    author: String,
    text: String,
) -> Result<(), String> {
    enforce_workspace_path(state, &file_path)?;
    with_sidecar_mut(emitter, &file_path, |sidecar| {
        let parent = sidecar
            .comments
            .iter()
            .find(|c| c.id == parent_id)
            .ok_or_else(|| format!("parent comment {} not found", parent_id))?
            .clone();
        let reply = crate::core::comments::create_reply(&author, &text, &parent);
        sidecar.comments.push(reply);
        Ok(())
    })
}

/// Edit a comment's text, save to sidecar.
#[tauri::command]
pub fn edit_comment<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, WatcherState>,
    file_path: String,
    comment_id: String,
    text: String,
) -> Result<(), String> {
    edit_comment_inner(&app, &state, file_path, comment_id, text)
}

/// Test seam for [`edit_comment`]. See [`add_comment_inner`] for rationale.
pub fn edit_comment_inner<E: CommentsEmitter>(
    emitter: &E,
    state: &WatcherState,
    file_path: String,
    comment_id: String,
    text: String,
) -> Result<(), String> {
    enforce_workspace_path(state, &file_path)?;
    with_sidecar_mut(emitter, &file_path, |sidecar| {
        let comment = sidecar
            .comments
            .iter_mut()
            .find(|c| c.id == comment_id)
            .ok_or_else(|| format!("comment {} not found", comment_id))?;
        comment.text = text;
        Ok(())
    })
}

/// Delete a comment (with reply reparenting per MRSF §9.1), save to sidecar.
#[tauri::command]
pub fn delete_comment<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, WatcherState>,
    file_path: String,
    comment_id: String,
) -> Result<(), String> {
    delete_comment_inner(&app, &state, file_path, comment_id)
}

/// Test seam for [`delete_comment`]. See [`add_comment_inner`] for rationale.
pub fn delete_comment_inner<E: CommentsEmitter>(
    emitter: &E,
    state: &WatcherState,
    file_path: String,
    comment_id: String,
) -> Result<(), String> {
    enforce_workspace_path(state, &file_path)?;
    with_sidecar_mut(emitter, &file_path, |sidecar| {
        sidecar.comments = crate::core::comments::delete_comment(&sidecar.comments, &comment_id);
        Ok(())
    })
}

/// Compute SHA-256 hash for selected text anchor.
#[tauri::command]
pub fn compute_anchor_hash(text: String) -> String {
    crate::core::anchors::compute_selected_text_hash(&text)
}

// Note: `set_resolved` and `move_anchor` are exposed via `update_comment` patch
// kinds (see `update.rs::CommentPatch`). The frontend uses
// `updateComment(...)` with `{ kind: "set_resolved" | "move_anchor", ... }`
// rather than dedicated IPC commands.
