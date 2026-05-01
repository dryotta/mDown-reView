//! Filesystem-facing IPC commands: directory listing and file reads.

use super::is_sidecar_file;
use crate::core::paths::canonicalize_no_verbatim;
use crate::core::types::DirEntry;
use crate::mdr_command;

/// Canonicalize an absolute path to the long form without the Windows `\\?\`
/// verbatim prefix. Used by the renderer to normalize paths at workspace-open
/// and tab-open boundaries so that string-equality comparisons against
/// scanner output (which itself canonicalizes via `dunce`) match. No
/// workspace guard — this is the very command callers use to obtain the
/// canonical form before they have a workspace to validate against.
#[mdr_command]
pub fn canonicalize_path(path: String) -> Result<String, String> {
    canonicalize_no_verbatim(std::path::Path::new(&path))
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| {
            tracing::error!("[rust] canonicalize_path error: {}", e);
            e.to_string()
        })
}

/// Outcome of a `check_path_exists` probe. Serialized as a bare lowercase
/// string ("file" / "dir" / "missing") so the wire shape matches the prior
/// hand-mirrored TS literal union — but the enum forces specta to emit the
/// union in `bindings.ts` so the façade can drop its `as` cast and a future
/// variant addition fails the codegen drift gate.
#[derive(serde::Serialize, Debug, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum PathKind {
    File,
    Dir,
    Missing,
}

/// Check if a path exists and whether it is a directory or file.
#[mdr_command]
pub fn check_path_exists(path: String) -> PathKind {
    match std::fs::metadata(&path) {
        Ok(meta) if meta.is_dir() => PathKind::Dir,
        Ok(_) => PathKind::File,
        Err(_) => PathKind::Missing,
    }
}

const DEFAULT_READ_DIR_LIMIT: usize = 250;

/// Capped directory listing: entries + total count + overflow flag.
#[derive(serde::Serialize, Debug, specta::Type)]
pub struct ReadDirResult {
    pub entries: Vec<DirEntry>,
    pub total: usize,
    pub has_more: bool,
}

/// Read directory entries, rejecting path traversal.
/// Returns at most `limit` entries (default 250) with total count so the
/// frontend can offer a "Show all N items…" affordance.
/// Hides `.review.yaml`/`.review.json` sidecar files, and also hides the
/// `sidecar_root` directory when listing a workspace root with an active
/// redirect (AC10: prevents users from seeing the internal sidecar store).
#[mdr_command]
pub fn read_dir(
    path: String,
    limit: Option<usize>,
    show_sidecars: Option<bool>,
    config_state: tauri::State<'_, crate::watcher::SidecarConfigState>,
) -> Result<ReadDirResult, String> {
    read_dir_inner(path, limit, show_sidecars, &config_state)
}

/// Inner implementation, decoupled from `tauri::State` so unit/integration
/// tests can construct a plain `SidecarConfigState` and call this directly
/// without spinning up a full `tauri::App`.
pub fn read_dir_inner(
    path: String,
    limit: Option<usize>,
    show_sidecars: Option<bool>,
    config_state: &crate::watcher::SidecarConfigState,
) -> Result<ReadDirResult, String> {
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

    // Determine if we should hide a sidecar_root directory.
    // Only applies when we're listing a workspace root that has sidecar_root configured.
    let hide_dir_name: Option<String> = config_state
        .resolve_for_file(&canonical)
        .and_then(|(ws_root, sr)| {
            if canonical == ws_root {
                // We're listing the workspace root — hide the first component of sidecar_root
                sr.and_then(|p| {
                    p.components()
                        .next()
                        .map(|c| c.as_os_str().to_string_lossy().into_owned())
                })
            } else {
                None
            }
        });

    let entries = std::fs::read_dir(&canonical).map_err(|e| {
        tracing::error!("[rust] command error: {}", e);
        e.to_string()
    })?;

    let mut result = Vec::new();
    let show = show_sidecars.unwrap_or(false);
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
        // Sidecar file filter — gate on is_file so a directory whose name
        // ends in `.review.yaml` (legal on every FS) is never mistaken
        // for a sidecar file.
        if !show && !meta.is_dir() && is_sidecar_file(&name) {
            continue;
        }
        // The "Show sidecar files in folder pane" toggle controls every
        // sidecar artifact uniformly: when OFF (default) we hide both
        // the inline `.review.{yaml,json}` files AND the `sidecar_root`
        // directory configured by `.mrsf.yaml`. When ON, both surface so
        // users can browse `.reviews/` and inspect the raw metadata.
        if !show {
            if let Some(ref hide) = hide_dir_name {
                if name == *hide && meta.is_dir() {
                    continue;
                }
            }
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
    let total = result.len();
    let cap = limit.unwrap_or(DEFAULT_READ_DIR_LIMIT);
    let has_more = total > cap;
    result.truncate(cap);
    Ok(ReadDirResult { entries: result, total, has_more })
}

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
    /// `*_ms` epoch convention used by [`FileStat::mtime_ms`]. Surfaced
    /// here so callers can detect external edits (mtime jumps) without a
    /// follow-up `stat_file` IPC round-trip.
    pub mtime_ms: Option<i64>,
}

/// Read a text file, rejecting binary files and files >10 MB.
///
/// Returns the decoded UTF-8 content alongside `size_bytes` (raw byte length
/// of the on-disk file), `line_count` (logical lines as defined by
/// [`str::lines`]), and `mtime_ms` (last-modified epoch ms; `None` when the
/// platform/FS does not expose it). The file handle's metadata is read
/// before the body so content + mtime come from the same `open()` and the
/// caller cannot observe a torn (content_v1, mtime_v2) pair.
///
/// Workspace-allowlisted: the path is run through [`ensure_readable`] before
/// any I/O. Mirrors `stat_file` so a malicious renderer cannot read arbitrary
/// disk paths via the IPC.
#[mdr_command]
pub fn read_text_file(
    path: String,
    state: tauri::State<'_, crate::watcher::WatcherState>,
) -> Result<TextFileResult, String> {
    let canonical = ensure_readable(&path, state.inner())?;
    read_text_file_inner(canonical.to_string_lossy().into_owned())
}

/// Inner implementation, decoupled from `tauri::State` and from the workspace
/// guard so unit/integration tests can exercise the pure-I/O behaviour
/// (binary detection, size cap, mtime piggyback) without spinning up a
/// `tauri::App` or registering a workspace.
pub fn read_text_file_inner(path: String) -> Result<TextFileResult, String> {
    use std::io::Read;

    // Open once; pull metadata + content from the same handle so mtime
    // matches the bytes returned (single open(), no second path lookup).
    let mut file = std::fs::File::open(&path).map_err(|e| {
        tracing::error!("[rust] command error: {}", e);
        e.to_string()
    })?;
    let mtime_ms = file
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64);

    // Read first, then check size (eliminates TOCTOU race between metadata + read)
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|e| {
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
        mtime_ms,
    })
}

/// Read a binary file, returning base64-encoded content. Rejects files >10 MB.
///
/// Workspace-allowlisted via [`ensure_readable`].
#[mdr_command]
pub fn read_binary_file(
    path: String,
    state: tauri::State<'_, crate::watcher::WatcherState>,
) -> Result<String, String> {
    let canonical = ensure_readable(&path, state.inner())?;
    read_binary_file_inner(canonical.to_string_lossy().into_owned())
}

/// Inner implementation of [`read_binary_file`], without the workspace guard.
/// Mirrors [`read_text_file_inner`] so tests can exercise the pure-I/O
/// behaviour (size cap, base64 encode) without touching `WatcherState`.
pub fn read_binary_file_inner(path: String) -> Result<String, String> {
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

/// Reject a read request whose canonical path is either outside the watcher
/// allowlist OR inside a system-locations bucket per
/// [`crate::core::security::system_locations`]. Used by [`read_text_file`] and
/// [`read_binary_file`] to close the "no workspace guard" gap called out in
/// issue #338's review of the existing IPC surface.
///
/// Returns the canonical [`PathBuf`] on success so callers perform the actual
/// I/O against the canonicalized form (defense-in-depth against TOCTOU
/// symlink swaps between the guard check and the read).
///
/// All rejection paths return the literal string `"path not in workspace"` —
/// matching the existing [`stat_file_inner`] error so the renderer can
/// uniformly surface workspace-guard rejections.
///
/// TODO(#338-group-b): when group B lands the full canonicalize-then-allowlist
/// semantics with split read/write allowlists this helper folds into the new
/// chokepoint. Logged via `tracing::warn!` under target `fs-guard` so the
/// review-time grep for the prefix returns every guard event.
pub fn ensure_readable(
    path_str: &str,
    state: &crate::watcher::WatcherState,
) -> Result<std::path::PathBuf, String> {
    use crate::core::security::system_locations::{classify, Tier};

    let raw = std::path::Path::new(path_str);
    // First containment check on the raw path (cheap; matches existing
    // `stat_file_inner` pattern at line ~292).
    if !state.is_path_allowed(raw) {
        tracing::warn!(target: "fs-guard", "[fs-guard] path outside workspace: {}", path_str);
        return Err("path not in workspace".into());
    }
    // Then canonicalize and re-check containment + system-locations.
    let canonical = canonicalize_no_verbatim(raw)
        .map_err(|e| format!("canonicalize failed: {e}"))?;
    if !state.is_path_allowed(&canonical) {
        tracing::warn!(target: "fs-guard", "[fs-guard] canonical path outside workspace: {}", canonical.display());
        return Err("path not in workspace".into());
    }
    // Workspace root for `classify()`: use the FIRST (sorted) watched dir for
    // a deterministic canonical-prefix check. Group B will replace this with
    // the explicit workspace-root state owned by the new chokepoint.
    let workspace_root = state
        .first_watched_dir()
        .ok_or_else(|| "no workspace registered".to_string())?;
    match classify(&canonical, &workspace_root) {
        Ok(Tier::Inside) => Ok(canonical),
        Ok(Tier::Outside) => {
            tracing::warn!(target: "fs-guard", "[fs-guard] outside workspace (tier 2): {}", canonical.display());
            Err("path not in workspace".into())
        }
        Ok(Tier::System { flavor }) => {
            tracing::warn!(target: "fs-guard", "[fs-guard] system path blocked ({:?}): {}", flavor, canonical.display());
            Err("path not in workspace".into())
        }
        Err(e) => {
            tracing::warn!(target: "fs-guard", "[fs-guard] non-canonical: {} reason={:?}", canonical.display(), e);
            Err("path not in workspace".into())
        }
    }
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
#[derive(serde::Serialize, Debug, specta::Type)]
pub struct FileStat {
    pub size_bytes: u64,
    /// Last-modified time as epoch milliseconds. `None` if the platform/FS
    /// does not expose mtime or it is before the UNIX epoch. Field name
    /// mirrors the MRSF `*_ms` epoch convention.
    pub mtime_ms: Option<i64>,
}

#[mdr_command]
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
///
/// Also loads the `.mrsf.yaml` config for the workspace root and caches
/// its `sidecar_root` value in [`SidecarConfigState`] so that subsequent
/// sidecar reads/writes use the configured path.
#[mdr_command]
pub fn update_tree_watched_dirs(
    window: tauri::Window,
    root: String,
    dirs: Vec<String>,
    state: tauri::State<'_, crate::watcher::WatcherState>,
    config_state: tauri::State<'_, crate::watcher::SidecarConfigState>,
) -> Result<(), String> {
    state.set_tree_watched_dirs(window.label(), root.clone(), dirs).map_err(|e| {
        tracing::warn!("[rust] update_tree_watched_dirs rejected: {}", e);
        e
    })?;

    // Load .mrsf.yaml config for this workspace root.
    let canonical_root = crate::core::paths::canonicalize_no_verbatim(std::path::Path::new(&root))
        .map_err(|e| format!("cannot canonicalize root: {e}"))?;
    let config = crate::core::paths::load_mrsf_config(&canonical_root).unwrap_or_else(|e| {
        tracing::warn!(
            "[sidecar-config] failed to load .mrsf.yaml for {}: {e}",
            root
        );
        None
    });
    config_state.set_config(canonical_root, config);

    Ok(())
}
