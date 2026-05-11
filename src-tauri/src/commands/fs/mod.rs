//! Filesystem-facing IPC commands: directory listing, file reads, stat, and
//! tree-watcher updates.
//!
//! Sibling-module split landed in #355 to keep every file under the rule 23
//! 400-line budget. Read paths live in [`read`] (10 MB cap pattern,
//! `docs/security.md` rules 1-3); directory listing in [`dir`] (sidecar +
//! sidecar_root filtering). This `mod.rs` keeps the cross-cutting items —
//! `ensure_readable` workspace guard, `stat_file*`, `check_path_exists`,
//! `canonicalize_path`, `update_tree_watched_dirs` — and the flat `pub use`
//! block so the parent `commands/mod.rs` re-exports plus tests continue to
//! address every item via `commands::fs::Foo`.

use crate::core::paths::canonicalize_no_verbatim;
use crate::mdr_command;

pub mod dir;
pub mod read;

pub use dir::{read_dir, read_dir_inner, ReadDirResult};
pub use read::{
    read_binary_file, read_binary_file_inner, read_text_file, read_text_file_inner, TextFileResult,
};

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

/// Reject a read request whose canonical path is outside the watcher
/// allowlist. Used by [`read_text_file`] and [`read_binary_file`] to close
/// the "no workspace guard" gap called out in issue #338's review of the
/// existing IPC surface.
///
/// Returns the canonical [`PathBuf`] on success so callers perform the actual
/// I/O against the canonicalized form (defense-in-depth against TOCTOU
/// symlink swaps between the guard check and the read).
///
/// All rejection paths return one of three distinct sentinels so tests
/// can identify which guard fired:
///
/// * `"path not in workspace"` — both `is_path_allowed` checks (raw and
///   post-canonicalize containment). Matched verbatim by
///   `src/components/comments/CommentsPanel.tsx`.
/// * `"canonicalize failed"` — `canonicalize_no_verbatim` errored.
/// * `"path not canonicalizable"` — `classify` returned a `NonCanonicalErr`.
///
/// **Tier::System paths are NOT rejected here.** The watcher allowlist
/// (`is_path_allowed`) is only seeded through user-initiated chokepoints
/// (`register_window_file`, `extend_window_scope_files`, the renderer's
/// folder open), so any path reaching the read path with a positive
/// `is_path_allowed` result has already been claimed by an explicit user
/// gesture. Trust the upstream gate; do not second-guess user intent on
/// every read. The system-locations DENY list is enforced exclusively at
/// the content-initiated chokepoints (`commands::path_classify` consumed
/// by `useLinkRouter`, `core::html_assets` for `<img>` / `<iframe>` /
/// `<audio>` / `<video>`). See rule 17b of `docs/security.md`.
///
/// Workspace-root semantics (issue #338 / iter-1 forward-fix):
/// `is_path_allowed` is the source of truth for containment — it scans every
/// window's tree-watched-dirs and watched-paths. `classify` is invoked
/// **only** to enforce the integrity guards (`..`, relative, verbatim) via
/// the `NonCanonicalErr` branch; in practice these are unreachable because
/// `canonicalize_no_verbatim` already simplified the path. The branch is
/// kept as a fail-closed guard against future refactors that might bypass
/// the canonicalize step.
pub fn ensure_readable(
    path_str: &str,
    state: &crate::watcher::WatcherState,
) -> Result<std::path::PathBuf, String> {
    use crate::core::security::system_locations::classify;

    let raw = std::path::Path::new(path_str);
    // First containment check on the raw path (cheap; matches the existing
    // `stat_file_inner` pattern below).
    if !state.is_path_allowed(raw) {
        tracing::warn!(target: "fs-guard", "[fs-guard] path outside workspace: {}", path_str);
        return Err("path not in workspace".into());
    }
    // Then canonicalize and re-check containment.
    let canonical = canonicalize_no_verbatim(raw)
        .map_err(|e| {
            tracing::warn!(target: "fs-guard", "[fs-guard] canonicalize failed for {}: {e}", path_str);
            "canonicalize failed".to_string()
        })?;
    if !state.is_path_allowed(&canonical) {
        tracing::warn!(target: "fs-guard", "[fs-guard] canonical path outside workspace: {}", canonical.display());
        return Err("path not in workspace".into());
    }
    // `is_path_allowed` has vetted containment. `classify` is retained as
    // the fail-closed integrity gate for `..`, relative, and verbatim
    // forms (unreachable through the public IPC contract because
    // `canonicalize_no_verbatim` ran above; kept defensively per rule 11a
    // of `docs/architecture.md`). `Tier::System` is intentionally accepted
    // — see the doc-comment block above and rule 17b of
    // `docs/security.md`.
    match classify(&canonical, &canonical) {
        Ok(_) => Ok(canonical),
        Err(e) => {
            tracing::warn!(target: "fs-guard", "[fs-guard] non-canonical: {} reason={:?}", canonical.display(), e);
            Err("path not canonicalizable".into())
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
