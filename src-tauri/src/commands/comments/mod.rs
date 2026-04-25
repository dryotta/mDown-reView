//! Comment thread mutation commands (sidecar reads, writes, anchor hashing).
//!
//! Split into 4 submodules for the 400-LOC budget (architecture rule 23):
//! - `mod.rs` — workspace guard + CRUD entry points
//! - `badges.rs` — `get_file_badges`
//! - `export.rs` — `export_review_summary`
//! - `update.rs` — `update_comment` + `CommentPatch`

use crate::core::mrsf_version::MRSF_VERSION_DEFAULT;
use crate::core::types::{CommentAnchor, CommentThread, MrsfComment, MrsfSidecar};
use std::path::Path;
use tauri::{Emitter, State};

use crate::watcher::WatcherState;

pub mod badges;
pub mod export;
pub mod update;

pub use badges::{get_file_badges, get_file_badges_inner, FileBadge};
pub use export::{export_review_summary, export_review_summary_inner};
pub use update::{update_comment, update_comment_apply, CommentPatch};

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

/// Load a sidecar, apply a mutation, save, and emit `comments-changed`.
fn with_sidecar_mut(
    app: &tauri::AppHandle,
    file_path: &str,
    mutate: impl FnOnce(&mut MrsfSidecar) -> Result<(), String>,
) -> Result<(), String> {
    let mut sidecar = crate::core::sidecar::load_sidecar(file_path)
        .map_err(|e| e.to_string())?
        .ok_or("sidecar not found")?;
    mutate(&mut sidecar)?;
    crate::core::sidecar::save_sidecar(file_path, &sidecar.document, &sidecar.comments)
        .map_err(|e| e.to_string())?;
    let _ = app.emit_to(
        "main",
        "comments-changed",
        CommentsChangedEvent { file_path: file_path.to_string() },
    );
    Ok(())
}

/// Pure helper: load an existing sidecar OR create an empty default,
/// apply a mutation, then save. Does NOT emit (so it can be unit-tested
/// without a Tauri AppHandle). Used by `with_sidecar_or_create`.
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
fn with_sidecar_or_create(
    app: &tauri::AppHandle,
    file_path: &str,
    document_default: Option<String>,
    mutate: impl FnOnce(&mut MrsfSidecar) -> Result<(), String>,
) -> Result<(), String> {
    mutate_sidecar_or_create(file_path, document_default, mutate)?;
    let _ = app.emit_to(
        "main",
        "comments-changed",
        CommentsChangedEvent { file_path: file_path.to_string() },
    );
    Ok(())
}

/// Combined hot-path: load sidecar → match to file lines → build threads.
/// Single IPC call for the GUI's most common operation.
///
/// Comments are partitioned by anchor variant: `Line`/`File` go through the
/// existing `match_comments` batch algorithm (line-targeting heuristics);
/// typed anchors (CSV cell, JSON path, HTML range/element, image rect,
/// word range) are dispatched through [`crate::core::anchors::resolve_anchor`]
/// against a single shared [`crate::core::anchors::LazyParsedDoc`] so the
/// file is parsed at most once per call (lazily, only for the
/// representations the present anchors actually need).
#[tauri::command]
pub fn get_file_comments(file_path: String) -> Result<Vec<CommentThread>, String> {
    use crate::core::anchors::{resolve_anchor, LazyParsedDoc, MatchOutcome};
    use crate::core::types::{Anchor, MatchedComment};

    let sidecar = crate::core::sidecar::load_sidecar(&file_path).map_err(|e| e.to_string())?;
    let comments = match sidecar {
        Some(s) => s.comments,
        None => return Ok(vec![]),
    };
    if comments.is_empty() {
        return Ok(vec![]);
    }

    // Read raw bytes once. NotFound (deleted/renamed) silently degrades to
    // empty bytes so all comments orphan; other errors are logged.
    let bytes = match std::fs::read(&file_path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => {
            tracing::warn!("Could not read {file_path} for comment matching: {e}");
            Vec::new()
        }
    };
    let doc = LazyParsedDoc::new(bytes);

    let mut line_or_file: Vec<MrsfComment> = Vec::new();
    let mut typed: Vec<MrsfComment> = Vec::new();
    for c in comments {
        match c.anchor {
            Anchor::Line { .. } | Anchor::File => line_or_file.push(c),
            _ => typed.push(c),
        }
    }

    // Line/File: existing line-targeting heuristics.
    let lines_str: Vec<&str> = doc.lines().iter().map(String::as_str).collect();
    let mut matched = crate::core::matching::match_comments(&line_or_file, &lines_str);

    // Typed anchors: per-comment dispatch with lazily-cached file parses.
    for c in typed {
        let outcome = resolve_anchor(&c.anchor, &doc);
        matched.push(MatchedComment {
            comment: c,
            matched_line_number: 0,
            is_orphaned: matches!(outcome, MatchOutcome::Orphan),
            anchored_text: None,
        });
    }

    Ok(crate::core::threads::group_into_threads(&matched))
}

/// Create a new comment, save to sidecar.
#[tauri::command]
pub fn add_comment(
    app: tauri::AppHandle,
    state: State<'_, WatcherState>,
    file_path: String,
    author: String,
    text: String,
    anchor: Option<CommentAnchor>,
    comment_type: Option<String>,
    severity: Option<String>,
    document: Option<String>,
) -> Result<(), String> {
    enforce_workspace_path(&state, &file_path)?;
    let comment = crate::core::comments::create_comment(
        &author,
        &text,
        anchor,
        comment_type.as_deref(),
        severity.as_deref(),
    );
    with_sidecar_or_create(&app, &file_path, document, |sidecar| {
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
pub fn add_reply(
    app: tauri::AppHandle,
    state: State<'_, WatcherState>,
    file_path: String,
    parent_id: String,
    author: String,
    text: String,
) -> Result<(), String> {
    enforce_workspace_path(&state, &file_path)?;
    with_sidecar_mut(&app, &file_path, |sidecar| {
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
pub fn edit_comment(
    app: tauri::AppHandle,
    state: State<'_, WatcherState>,
    file_path: String,
    comment_id: String,
    text: String,
) -> Result<(), String> {
    enforce_workspace_path(&state, &file_path)?;
    with_sidecar_mut(&app, &file_path, |sidecar| {
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
pub fn delete_comment(
    app: tauri::AppHandle,
    state: State<'_, WatcherState>,
    file_path: String,
    comment_id: String,
) -> Result<(), String> {
    enforce_workspace_path(&state, &file_path)?;
    with_sidecar_mut(&app, &file_path, |sidecar| {
        sidecar.comments = crate::core::comments::delete_comment(&sidecar.comments, &comment_id);
        Ok(())
    })
}

/// Compute SHA-256 hash for selected text anchor.
#[tauri::command]
pub fn compute_anchor_hash(text: String) -> String {
    crate::core::anchors::compute_selected_text_hash(&text)
}
