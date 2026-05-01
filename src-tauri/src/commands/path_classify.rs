//! `path_classify` IPC: classify an href against the calling window's workspace.
//!
//! Issue #338 / Group B foundation: replaces TS-only shape classification with
//! authoritative Rust canonical-path classification. The renderer never
//! supplies the workspace root — the IPC resolves it from
//! [`WatcherState::tree_watched_dirs_snapshot`] keyed by [`tauri::Window::label`]
//! so a compromised renderer cannot lie about workspace membership
//! (security-expert flagged renderer-supplied workspace_root as a self-LIE
//! vector — e.g. passing `workspace_root="/etc"` to claim `/etc/passwd` is
//! "inside").
//!
//! See `docs/architecture.md` rule 1 (Rust owns the policy decision) and
//! `docs/security.md` rule 13 (system-locations blocklist).

use std::path::{Path, PathBuf};

use crate::core::paths::canonicalize_no_verbatim;
use crate::core::security::system_locations::{classify, tier_to_wire};
use crate::core::types::wire::PathClassification;
use crate::mdr_command;
use crate::watcher::WatcherState;

/// Bound on accepted href byte length — well above any plausible URL/path.
/// Matches the spirit of `docs/performance.md` rule 1 (cap every unbounded
/// renderer-supplied input).
const MAX_HREF_BYTES: usize = 8 * 1024;
const MAX_BASE_DIR_BYTES: usize = 8 * 1024;

/// Classify `href` (optionally resolved against `base_dir`) for the workspace
/// associated with the calling window.
#[mdr_command]
pub fn path_classify(
    href: String,
    base_dir: Option<String>,
    window: tauri::Window,
    state: tauri::State<'_, WatcherState>,
) -> Result<PathClassification, String> {
    if href.len() > MAX_HREF_BYTES {
        return Err(format!(
            "path_classify: href exceeds {MAX_HREF_BYTES} bytes"
        ));
    }
    if let Some(b) = base_dir.as_ref() {
        if b.len() > MAX_BASE_DIR_BYTES {
            return Err(format!(
                "path_classify: base_dir exceeds {MAX_BASE_DIR_BYTES} bytes"
            ));
        }
    }

    let workspace_root = workspace_root_for_window(state.inner(), window.label())
        .ok_or_else(|| "no workspace registered for this window".to_string())?;

    path_classify_inner(&href, base_dir.as_deref(), &workspace_root)
}

/// Pure classification core, decoupled from `tauri::State` and `tauri::Window`
/// so unit/integration tests can drive every branch without spinning up a
/// `tauri::App` (mirrors the `read_text_file_inner` pattern).
pub fn path_classify_inner(
    href: &str,
    base_dir: Option<&str>,
    workspace_root: &Path,
) -> Result<PathClassification, String> {
    // 1. Resolve href: relative hrefs join under base_dir; absolute hrefs
    //    bypass base_dir entirely.
    let raw: PathBuf = {
        let h = Path::new(href);
        if h.is_absolute() {
            h.to_path_buf()
        } else if let Some(base) = base_dir {
            Path::new(base).join(h)
        } else {
            PathBuf::from(href)
        }
    };

    // 2. Canonicalize. Failure is reported as Err; the renderer treats this
    //    as fail-closed (per security-expert: never silently downgrade to a
    //    permissive tier).
    let canonical =
        canonicalize_no_verbatim(&raw).map_err(|e| format!("canonicalize failed: {e}"))?;

    // 3. Classify against the workspace root.
    let tier = classify(&canonical, workspace_root).map_err(|e| format!("classify failed: {e:?}"))?;

    Ok(tier_to_wire(&tier, &canonical))
}

/// Resolve the canonical workspace root for a given window label.
///
/// `tree_watched_dirs` for a window contains the workspace root plus every
/// currently-expanded subdirectory; the workspace root is the lex-smallest
/// (shortest-prefix) entry, which is what we return. Returns `None` if the
/// window has no watched dirs (e.g. file-only mode before any tab opens).
pub fn workspace_root_for_window(state: &WatcherState, window_label: &str) -> Option<PathBuf> {
    let snapshot = state.tree_watched_dirs_snapshot();
    snapshot
        .get(window_label)
        .and_then(|set| set.iter().min().cloned())
}
