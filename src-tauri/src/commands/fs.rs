//! Filesystem-facing IPC commands: directory listing and file reads.

use super::is_sidecar_file;
use crate::core::types::DirEntry;

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
