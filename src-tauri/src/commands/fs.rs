//! Filesystem-facing IPC commands: directory listing and file reads.

use super::is_sidecar_file;
use crate::core::paths::canonicalize_no_verbatim;
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
    let canonical = canonicalize_no_verbatim(std::path::Path::new(&path)).map_err(|e| {
        tracing::error!("[rust] command error: {}", e);
        e.to_string()
    })?;
    // Ensure the canonical path matches the requested one (no breakout)
    let requested = std::path::Path::new(&path);
    if requested.is_absolute() {
        let req_canonical = canonicalize_no_verbatim(requested).map_err(|e| e.to_string())?;
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

/// Result of [`read_text_file`]: file content plus cheap-to-compute metadata
/// (byte size and line count) that the UI surfaces in the status bar without
/// requiring a second IPC round-trip.
#[derive(serde::Serialize, Debug)]
pub struct TextFileResult {
    pub content: String,
    pub size_bytes: u64,
    pub line_count: usize,
}

/// Read a text file, rejecting binary files and files >10 MB.
///
/// Returns the decoded UTF-8 content alongside `size_bytes` (raw byte length
/// of the on-disk file) and `line_count` (logical lines as defined by
/// [`str::lines`]).
#[tauri::command]
pub fn read_text_file(path: String) -> Result<TextFileResult, String> {
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

    let size_bytes = bytes.len() as u64;
    let content = String::from_utf8(bytes).map_err(|e| {
        tracing::error!("[rust] command error: {}", e);
        "binary_file".to_string()
    })?;
    let line_count = content.lines().count();

    Ok(TextFileResult {
        content,
        size_bytes,
        line_count,
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

/// Lightweight `stat`: returns just the byte size of a file, with no content
/// read. Used by viewers (BinaryPlaceholder, TooLargePlaceholder) that need
/// to display a size without paying the I/O cost of `read_binary_file`. No
/// 10 MB cap — over-cap files are exactly the case we want to surface.
///
/// Workspace-allowlisted: mirrors `commands/system.rs::reveal_in_folder` so a
/// malicious renderer cannot probe arbitrary paths (e.g. `~/.ssh/id_rsa`)
/// for existence/size. The path must be inside an open workspace folder or
/// an open tab.
#[derive(serde::Serialize, Debug)]
pub struct FileStat {
    pub size_bytes: u64,
    /// Last-modified time as epoch milliseconds. `None` if the platform/FS
    /// does not expose mtime or it is before the UNIX epoch. Field name
    /// mirrors the MRSF `*_ms` epoch convention.
    pub mtime_ms: Option<i64>,
}

#[tauri::command]
pub fn stat_file(
    path: String,
    state: tauri::State<'_, crate::watcher::WatcherState>,
) -> Result<FileStat, String> {
    stat_file_inner(&path, &state)
}

/// Inner implementation, decoupled from `tauri::State` so unit/integration
/// tests can construct a plain `WatcherState` and call this directly without
/// spinning up a full `tauri::App`.
pub fn stat_file_inner(
    path: &str,
    state: &crate::watcher::WatcherState,
) -> Result<FileStat, String> {
    if !state.is_path_allowed(std::path::Path::new(path)) {
        tracing::warn!("[fs] stat_file rejected: path outside workspace");
        return Err("path not in workspace".into());
    }
    let meta = std::fs::metadata(path).map_err(|e| {
        tracing::error!("[rust] command error: {}", e);
        e.to_string()
    })?;
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64);
    Ok(FileStat {
        size_bytes: meta.len(),
        mtime_ms,
    })
}

/// Update the set of directories whose direct children should produce
/// `folder-changed` events (root + currently-expanded folders in the tree pane).
///
/// `root` and every entry in `dirs` are canonicalized internally; callers may
/// pass any absolute form. Each entry must exist and be a directory, and every
/// dir must be contained within `root`. At most
/// [`crate::watcher::MAX_TREE_WATCHED_DIRS`] entries per call.
#[tauri::command]
pub fn update_tree_watched_dirs(
    root: String,
    dirs: Vec<String>,
    state: tauri::State<'_, crate::watcher::WatcherState>,
) -> Result<(), String> {
    state.set_tree_watched_dirs(root, dirs).map_err(|e| {
        tracing::warn!("[rust] update_tree_watched_dirs rejected: {}", e);
        e
    })
}
