//! Comment thread mutation commands (sidecar reads, writes, anchor hashing).

use crate::core::types::{CommentAnchor, CommentThread, MrsfSidecar, MRSF_VERSION_WRITE};
use tauri::Emitter;

/// Payload emitted to the frontend after a mutation command modifies a sidecar.
#[derive(Clone, serde::Serialize)]
pub struct CommentsChangedEvent {
    pub file_path: String,
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
            mrsf_version: MRSF_VERSION_WRITE.to_string(),
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
#[tauri::command]
pub fn get_file_comments(file_path: String) -> Result<Vec<CommentThread>, String> {
    // Load sidecar
    let sidecar = crate::core::sidecar::load_sidecar(&file_path).map_err(|e| e.to_string())?;
    let comments = match sidecar {
        Some(s) => s.comments,
        None => return Ok(vec![]),
    };
    if comments.is_empty() {
        return Ok(vec![]);
    }

    // Read file content for matching (empty string for deleted/unreadable files → comments become orphans)
    let content = match std::fs::read_to_string(&file_path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => {
            tracing::warn!("Could not read {file_path} for comment matching: {e}");
            String::new()
        }
    };
    let lines: Vec<&str> = content.lines().collect();

    // Match comments to lines
    let matched = crate::core::matching::match_comments(&comments, &lines);

    // Build threads
    Ok(crate::core::threads::group_into_threads(&matched))
}

/// Create a new comment, save to sidecar.
#[tauri::command]
pub fn add_comment(
    app: tauri::AppHandle,
    file_path: String,
    author: String,
    text: String,
    anchor: Option<CommentAnchor>,
    comment_type: Option<String>,
    severity: Option<String>,
    document: Option<String>,
) -> Result<(), String> {
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

/// Create a reply to an existing comment, save to sidecar.
#[tauri::command]
pub fn add_reply(
    app: tauri::AppHandle,
    file_path: String,
    parent_id: String,
    author: String,
    text: String,
) -> Result<(), String> {
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
    file_path: String,
    comment_id: String,
    text: String,
) -> Result<(), String> {
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
    file_path: String,
    comment_id: String,
) -> Result<(), String> {
    with_sidecar_mut(&app, &file_path, |sidecar| {
        sidecar.comments = crate::core::comments::delete_comment(&sidecar.comments, &comment_id);
        Ok(())
    })
}

/// Resolve or unresolve a comment, save to sidecar.
#[tauri::command]
pub fn set_comment_resolved(
    app: tauri::AppHandle,
    file_path: String,
    comment_id: String,
    resolved: bool,
) -> Result<(), String> {
    with_sidecar_mut(&app, &file_path, |sidecar| {
        let comment = sidecar
            .comments
            .iter_mut()
            .find(|c| c.id == comment_id)
            .ok_or_else(|| format!("comment {} not found", comment_id))?;
        comment.resolved = resolved;
        Ok(())
    })
}

/// Compute SHA-256 hash for selected text anchor.
#[tauri::command]
pub fn compute_anchor_hash(text: String) -> String {
    crate::core::anchors::compute_selected_text_hash(&text)
}

/// Batch: count unresolved comments for each file path.
/// Returns a map of file_path → unresolved count. Skips files without sidecars.
#[tauri::command]
pub fn get_unresolved_counts(
    file_paths: Vec<String>,
) -> Result<std::collections::HashMap<String, u32>, String> {
    let mut counts = std::collections::HashMap::new();
    for file_path in file_paths {
        match crate::core::sidecar::load_sidecar(&file_path) {
            Ok(Some(sidecar)) => {
                let unresolved = sidecar.comments.iter().filter(|c| !c.resolved).count() as u32;
                if unresolved > 0 {
                    counts.insert(file_path, unresolved);
                }
            }
            Ok(None) => {} // No sidecar
            Err(e) => {
                tracing::warn!("Could not load sidecar for {file_path}: {e}");
            }
        }
    }
    Ok(counts)
}
