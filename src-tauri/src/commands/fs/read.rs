//! File-content reads: text + binary, with the canonical 10 MB cap pattern.
//!
//! See `docs/security.md` rules 1-3 for the full read-bounds policy.
//! The workspace allowlist guard ([`super::ensure_readable`]) lives in
//! [`super`]; this module only consumes it.

use super::ensure_readable;
use crate::mdr_command;
use std::io::Read;

/// Result of [`read_text_file`]: file content plus cheap-to-compute metadata
/// (byte size and line count) that the UI surfaces in the status bar without
/// requiring a second IPC round-trip.
#[derive(serde::Serialize, Debug, specta::Type)]
pub struct TextFileResult {
    pub content: String,
    pub size_bytes: u64,
    pub line_count: usize,
    /// Last-modified time as epoch milliseconds. `None` if the platform/FS
    /// does not expose mtime or it is before the UNIX epoch. Mirrors the
    /// `*_ms` epoch convention used by [`super::FileStat::mtime_ms`]. Surfaced
    /// here so callers can detect external edits (mtime jumps) without a
    /// follow-up `stat_file` IPC round-trip.
    pub mtime_ms: Option<i64>,
}

/// Shared 10 MB hard cap. Canonical in `docs/security.md` rule 1.
const MAX_SIZE: usize = 10 * 1024 * 1024;

/// Read a file's bytes with the canonical 10 MB cap pattern.
///
/// Combines:
///   1. fstat pre-check (open-handle `metadata().len()`) — TOCTOU-safe O(1)
///      reject for multi-GB files vs. path-swap attacks.
///   2. `Vec::with_capacity(meta.len().min(MAX_SIZE))` — pre-allocate; bounded
///      by MAX_SIZE so attacker-controlled `meta.len()` cannot OOM.
///   3. `File::take(MAX_SIZE + 1)` + post-read `bytes.len() > MAX_SIZE` —
///      defends against special files (`/dev/zero`, FIFOs, network FS) that
///      report `len() == 0` while streaming unbounded bytes.
///
/// Returns the bytes and the open-handle metadata (caller extracts mtime
/// from the same `open()` so content + mtime cannot be torn).
///
/// Mirrors `core::sidecar::read_capped`. See `docs/security.md` rules 1-3.
fn read_file_capped(path: &str) -> Result<(Vec<u8>, std::fs::Metadata), String> {
    let file = std::fs::File::open(path).map_err(|e| {
        tracing::error!("[rust] command error: {}", e);
        e.to_string()
    })?;
    let meta = file.metadata().map_err(|e| {
        tracing::error!("[rust] command error: {}", e);
        e.to_string()
    })?;
    if meta.len() > MAX_SIZE as u64 {
        return Err("file_too_large".into());
    }
    let mut bytes = Vec::with_capacity(meta.len().min(MAX_SIZE as u64) as usize);
    file.take(MAX_SIZE as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| {
            tracing::error!("[rust] command error: {}", e);
            e.to_string()
        })?;
    if bytes.len() > MAX_SIZE {
        return Err("file_too_large".into());
    }
    Ok((bytes, meta))
}

/// Read a text file, rejecting binary files and files >10 MB. Returns
/// decoded UTF-8 + `size_bytes` + `line_count` + `mtime_ms`. Workspace-
/// allowlisted via [`ensure_readable`]; cap + TOCTOU semantics live in
/// [`read_file_capped`] (see also `docs/security.md` rules 1-3).
#[mdr_command]
pub fn read_text_file(
    path: String,
    state: tauri::State<'_, crate::watcher::WatcherState>,
) -> Result<TextFileResult, String> {
    let canonical = ensure_readable(&path, state.inner())?;
    read_text_file_inner(canonical.to_string_lossy().into_owned())
}

/// Inner impl, decoupled from `tauri::State` so tests can exercise pure I/O.
pub fn read_text_file_inner(path: String) -> Result<TextFileResult, String> {
    let (bytes, meta) = read_file_capped(&path)?;
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64);

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
        mtime_ms,
    })
}

/// Read a binary file, returning base64-encoded content. Rejects files
/// >10 MB. Workspace-allowlisted via [`ensure_readable`]; cap semantics
/// live in [`read_file_capped`].
#[mdr_command]
pub fn read_binary_file(
    path: String,
    state: tauri::State<'_, crate::watcher::WatcherState>,
) -> Result<String, String> {
    let canonical = ensure_readable(&path, state.inner())?;
    read_binary_file_inner(canonical.to_string_lossy().into_owned())
}

/// Inner impl, no workspace guard. Mirrors [`read_text_file_inner`].
pub fn read_binary_file_inner(path: String) -> Result<String, String> {
    let (bytes, _meta) = read_file_capped(&path)?;
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}
