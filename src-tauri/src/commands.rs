use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State};

// Re-export core types so existing code (lib.rs, tests) still compiles
pub use crate::core::types::{CommentAnchor, CommentThread, DirEntry, LaunchArgs, MatchedComment, MrsfComment, MrsfSidecar};

/// Check if a path exists and whether it is a directory or file.
/// Returns "file", "dir", or "missing".
#[tauri::command]
pub fn check_path_exists(path: String) -> String {
    match std::fs::metadata(&path) {
        Ok(meta) if meta.is_dir() => "dir".to_string(),
        Ok(_) => "file".to_string(),
        Err(_) => "missing".to_string(),
    }
}

// Types are re-exported from core::types above

pub type LaunchArgsState = Arc<Mutex<Option<LaunchArgs>>>;

/// Payload emitted to the frontend after a mutation command modifies a sidecar.
#[derive(Clone, serde::Serialize)]
pub struct CommentsChangedEvent {
    pub file_path: String,
}

fn is_sidecar_file(name: &str) -> bool {
    name.ends_with(".review.yaml") || name.ends_with(".review.json")
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

// ── Commands ───────────────────────────────────────────────────────────────

/// Read directory entries, rejecting path traversal.
#[tauri::command]
pub fn read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    // Canonicalize to resolve symlinks and reject traversal
    let canonical = std::fs::canonicalize(&path).map_err(|e| {
        tracing::error!("[rust] command error: {}", e);
        e.to_string()
    })?;
    // Ensure the canonical path matches the requested one (no breakout)
    let requested = std::path::Path::new(&path);
    if requested.is_absolute() {
        let req_canonical = std::fs::canonicalize(requested).map_err(|e| e.to_string())?;
        if req_canonical != canonical {
            return Err("path traversal not allowed".into());
        }
    }
    let entries = std::fs::read_dir(&canonical).map_err(|e| {
        tracing::error!("[rust] command error: {}", e);
        e.to_string()
    })?;

    let mut result = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| {
            tracing::error!("[rust] command error: {}", e);
            e.to_string()
        })?;
        let meta = entry.metadata().map_err(|e| {
            tracing::error!("[rust] command error: {}", e);
            e.to_string()
        })?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_sidecar_file(&name) {
            continue;
        }
        
        let path = entry.path().to_string_lossy().into_owned();
        result.push(DirEntry {
            name,
            path,
            is_dir: meta.is_dir(),
        });
    }
    result.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(result)
}

/// Read a text file, rejecting binary files and files >10 MB.
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    // Read first, then check size (eliminates TOCTOU race between metadata + read)
    let bytes = std::fs::read(&path).map_err(|e| {
        tracing::error!("[rust] command error: {}", e);
        e.to_string()
    })?;

    const MAX_SIZE: usize = 10 * 1024 * 1024;
    if bytes.len() > MAX_SIZE {
        return Err("file_too_large".into());
    }

    // Detect binary by scanning first 512 bytes for null bytes
    let scan_len = bytes.len().min(512);
    if bytes[..scan_len].contains(&0u8) {
        return Err("binary_file".into());
    }

    String::from_utf8(bytes).map_err(|e| {
        tracing::error!("[rust] command error: {}", e);
        "binary_file".into()
    })
}

/// Read a binary file, returning base64-encoded content. Rejects files >10 MB.
#[tauri::command]
pub fn read_binary_file(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| {
        tracing::error!("[rust] command error: {}", e);
        e.to_string()
    })?;

    const MAX_SIZE: usize = 10 * 1024 * 1024;
    if bytes.len() > MAX_SIZE {
        return Err("file_too_large".into());
    }

    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

/// Get (and clear) launch args stored during setup.
#[tauri::command]
pub fn get_launch_args(state: State<LaunchArgsState>) -> Result<LaunchArgs, String> {
    let mut guard = state.lock().map_err(|e| format!("lock poisoned: {}", e))?;
    Ok(guard.take().unwrap_or_default())
}

/// Get the log file path for display in the About dialog.
#[tauri::command]
pub fn get_log_path(app: tauri::AppHandle) -> Result<String, String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| e.to_string())?;
    Ok(log_dir.join("mdownreview.log").to_string_lossy().into_owned())
}

/// Scan a directory tree for MRSF sidecar files (delegates to core::scanner).
#[tauri::command]
pub fn scan_review_files(root: String) -> Result<Vec<(String, String)>, String> {
    Ok(crate::core::scanner::find_review_files(&root, 10_000))
}

/// Test-only command: open a folder and all its non-sidecar files via args-received.
#[cfg(debug_assertions)]
#[tauri::command]
pub fn set_root_via_test(path: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Emitter;

    let folder = std::path::Path::new(&path);
    let mut files: Vec<String> = Vec::new();

    if let Ok(entries) = std::fs::read_dir(folder) {
        let mut paths: Vec<std::path::PathBuf> = entries
            .flatten()
            .filter_map(|e| {
                let p = e.path();
                if !p.is_file() {
                    return None;
                }
                let name = p.file_name()?.to_str()?.to_owned();
                if is_sidecar_file(&name) {
                    return None;
                }
                Some(p)
            })
            .collect();
        paths.sort();
        files = paths
            .into_iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
    }

    let payload = serde_json::json!({
        "files": files,
        "folders": [path],
    });

    if let Some(window) = app.get_webview_window("main") {
        window
            .emit("args-received", payload)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ── Phase 2: MVVM domain commands ─────────────────────────────────────────

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

    // Load existing, append, save
    let mut sidecar = crate::core::sidecar::load_sidecar(&file_path)
        .map_err(|e| e.to_string())?
        .unwrap_or(MrsfSidecar {
            mrsf_version: "1.0".to_string(),
            document: document.unwrap_or_else(|| {
                std::path::Path::new(&file_path)
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default()
            }),
            comments: vec![],
        });
    sidecar.comments.push(comment);
    crate::core::sidecar::save_sidecar(
        &file_path,
        &sidecar.document,
        &sidecar.comments,
    )
    .map_err(|e| e.to_string())?;
    let _ = app.emit_to("main", "comments-changed", CommentsChangedEvent { file_path });
    Ok(())
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
pub fn get_unresolved_counts(file_paths: Vec<String>) -> Result<std::collections::HashMap<String, u32>, String> {
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

// ── Document search ───────────────────────────────────────────────────────

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub line_index: usize,
    pub start_col: usize,
    pub end_col: usize,
}

#[tauri::command]
pub fn search_in_document(content: String, query: String) -> Vec<SearchMatch> {
    if query.is_empty() {
        return vec![];
    }
    let lower_query = query.to_lowercase();
    let query_chars = lower_query.chars().count();
    let mut results = Vec::new();
    for (i, line) in content.lines().enumerate() {
        let lower_line = line.to_lowercase();
        let chars: Vec<char> = lower_line.chars().collect();
        let query_chars_vec: Vec<char> = lower_query.chars().collect();
        let mut pos = 0;
        while pos + query_chars <= chars.len() {
            if chars[pos..pos + query_chars] == query_chars_vec[..] {
                results.push(SearchMatch {
                    line_index: i,
                    start_col: pos,
                    end_col: pos + query_chars,
                });
                pos += 1;
            } else {
                pos += 1;
            }
        }
    }
    results
}
