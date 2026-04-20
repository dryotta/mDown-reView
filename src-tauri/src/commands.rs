use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};

// ── Types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LaunchArgs {
    pub files: Vec<String>,
    pub folders: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommentResponse {
    pub author: String,
    pub text: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewComment {
    pub id: String,
    #[serde(rename = "anchorType", default = "default_anchor_type")]
    pub anchor_type: String,
    // Line anchor fields
    #[serde(rename = "lineHash", skip_serializing_if = "Option::is_none")]
    pub line_hash: Option<String>,
    #[serde(rename = "lineNumber", skip_serializing_if = "Option::is_none")]
    pub line_number: Option<u32>,
    // Context for re-anchoring
    #[serde(rename = "contextBefore", skip_serializing_if = "Option::is_none")]
    pub context_before: Option<String>,
    #[serde(rename = "contextAfter", skip_serializing_if = "Option::is_none")]
    pub context_after: Option<String>,
    // Selection fields
    #[serde(rename = "selectedText", skip_serializing_if = "Option::is_none")]
    pub selected_text: Option<String>,
    #[serde(rename = "selectionStartOffset", skip_serializing_if = "Option::is_none")]
    pub selection_start_offset: Option<u32>,
    #[serde(rename = "selectionEndLine", skip_serializing_if = "Option::is_none")]
    pub selection_end_line: Option<u32>,
    #[serde(rename = "selectionEndOffset", skip_serializing_if = "Option::is_none")]
    pub selection_end_offset: Option<u32>,
    // Legacy block fields (preserved for migration)
    #[serde(rename = "blockHash", skip_serializing_if = "Option::is_none")]
    pub block_hash: Option<String>,
    #[serde(rename = "headingContext", skip_serializing_if = "Option::is_none")]
    pub heading_context: Option<String>,
    #[serde(rename = "fallbackLine", skip_serializing_if = "Option::is_none")]
    pub fallback_line: Option<u32>,
    // Content
    pub text: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    pub resolved: bool,
    // Responses
    #[serde(skip_serializing_if = "Option::is_none")]
    pub responses: Option<Vec<CommentResponse>>,
}

fn default_anchor_type() -> String {
    "block".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewComments {
    pub version: u32,
    pub comments: Vec<ReviewComment>,
}

#[derive(Debug, Deserialize)]
pub struct LegacyReviewComments {
    pub version: Option<u32>,
    pub comments: Vec<ReviewComment>,
}

pub type LaunchArgsState = Arc<Mutex<Option<LaunchArgs>>>;

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

/// Save review comments sidecar file (atomic via temp + rename).
#[tauri::command]
pub fn save_review_comments(file_path: String, comments: Vec<ReviewComment>) -> Result<(), String> {
    let sidecar_path = std::path::PathBuf::from(format!("{}.review.json", file_path));
    let payload = ReviewComments {
        version: 3,
        comments,
    };
    let json = serde_json::to_string_pretty(&payload).map_err(|e| {
        tracing::error!("[rust] command error: {}", e);
        e.to_string()
    })?;

    // Write to temp file in same directory, then rename for atomicity
    let dir = sidecar_path.parent().unwrap_or(std::path::Path::new("."));
    let tmp_path = dir.join(format!(
        ".review-{}.tmp",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    std::fs::write(&tmp_path, &json).map_err(|e| {
        tracing::error!("[rust] command error: {}", e);
        e.to_string()
    })?;
    std::fs::rename(&tmp_path, &sidecar_path).map_err(|e| {
        // Clean up temp file on rename failure
        let _ = std::fs::remove_file(&tmp_path);
        tracing::error!("[rust] command error: {}", e);
        e.to_string()
    })?;
    Ok(())
}

/// Load review comments sidecar file; returns null if no sidecar exists.
#[tauri::command]
pub fn load_review_comments(file_path: String) -> Result<Option<ReviewComments>, String> {
    let sidecar_path = format!("{}.review.json", file_path);
    match std::fs::read_to_string(&sidecar_path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => {
            tracing::error!("[rust] command error: {}", e);
            Err(e.to_string())
        }
        Ok(content) => {
            let legacy: LegacyReviewComments = serde_json::from_str(&content).map_err(|e| {
                tracing::error!("[rust] command error: {}", e);
                e.to_string()
            })?;
            Ok(Some(ReviewComments {
                version: legacy.version.unwrap_or(0),
                comments: legacy.comments,
            }))
        }
    }
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
