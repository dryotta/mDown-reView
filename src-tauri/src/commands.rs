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
pub struct MrsfComment {
    pub id: String,
    pub author: String,
    pub timestamp: String,
    pub text: String,
    pub resolved: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_column: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_column: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchored_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_text_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub comment_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub severity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_to: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MrsfSidecar {
    pub mrsf_version: String,
    pub document: String,
    pub comments: Vec<MrsfComment>,
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
        
        // Hide review sidecar files from folder tree
        if name.ends_with(".review.yaml") || name.ends_with(".review.json") {
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

/// Save review comments as MRSF YAML sidecar (atomic via temp + rename).
#[tauri::command]
pub fn save_review_comments(file_path: String, document: String, comments: Vec<MrsfComment>) -> Result<(), String> {
    let sidecar_path = std::path::PathBuf::from(format!("{}.review.yaml", file_path));
    let payload = MrsfSidecar {
        mrsf_version: "1.0".to_string(),
        document,
        comments,
    };
    let yaml = serde_yaml::to_string(&payload).map_err(|e| {
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
    std::fs::write(&tmp_path, &yaml).map_err(|e| {
        tracing::error!("[rust] command error: {}", e);
        e.to_string()
    })?;
    std::fs::rename(&tmp_path, &sidecar_path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        tracing::error!("[rust] command error: {}", e);
        e.to_string()
    })?;
    Ok(())
}

/// Load review comments sidecar; tries .review.yaml first, then .review.json.
#[tauri::command]
pub fn load_review_comments(file_path: String) -> Result<Option<MrsfSidecar>, String> {
    let yaml_path = format!("{}.review.yaml", file_path);
    let json_path = format!("{}.review.json", file_path);

    // Try YAML first
    match std::fs::read_to_string(&yaml_path) {
        Ok(content) => {
            let sidecar: MrsfSidecar = serde_yaml::from_str(&content).map_err(|e| {
                tracing::error!("[rust] YAML parse error: {}", e);
                e.to_string()
            })?;
            return Ok(Some(sidecar));
        }
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            tracing::error!("[rust] command error: {}", e);
            return Err(e.to_string());
        }
        _ => {} // Not found, try JSON
    }

    // Try JSON fallback
    match std::fs::read_to_string(&json_path) {
        Ok(content) => {
            let sidecar: MrsfSidecar = serde_json::from_str(&content).map_err(|e| {
                tracing::error!("[rust] JSON parse error: {}", e);
                e.to_string()
            })?;
            Ok(Some(sidecar))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => {
            tracing::error!("[rust] command error: {}", e);
            Err(e.to_string())
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

/// Scan a directory tree for MRSF sidecar files (.review.yaml and .review.json).
/// Returns pairs of (sidecar_path, source_file_path).
#[tauri::command]
pub fn scan_review_files(root: String) -> Result<Vec<(String, String)>, String> {
    let mut results = Vec::new();
    let walker = walkdir::WalkDir::new(&root)
        .max_depth(50)
        .into_iter()
        .filter_map(|e| e.ok());

    for entry in walker {
        let path = entry.path();
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            let (is_sidecar, suffix) = if name.ends_with(".review.yaml") {
                (true, ".review.yaml")
            } else if name.ends_with(".review.json") {
                (true, ".review.json")
            } else {
                (false, "")
            };
            if is_sidecar {
                let sidecar = path.to_string_lossy().to_string();
                let source = sidecar.trim_end_matches(suffix).to_string();
                results.push((sidecar, source));
            }
        }
        if results.len() >= 10_000 {
            tracing::warn!("[scan] capped at 10,000 review files");
            break;
        }
    }
    Ok(results)
}

/// Get the current git HEAD SHA, if in a git repository.
#[tauri::command]
pub fn get_git_head(path: String) -> Result<Option<String>, String> {
    let output = std::process::Command::new("git")
        .arg("rev-parse")
        .arg("HEAD")
        .current_dir(&path)
        .output();
    match output {
        Ok(out) if out.status.success() => {
            let sha = String::from_utf8_lossy(&out.stdout).trim().to_string();
            Ok(if sha.is_empty() { None } else { Some(sha) })
        }
        _ => Ok(None),
    }
}
