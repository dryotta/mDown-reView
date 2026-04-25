//! Per-file badge aggregators: unresolved counts + max severity.

use crate::core::severity::{max_severity, Severity};
use crate::watcher::WatcherState;
use std::collections::HashMap;
use std::path::Path;
use tauri::State;

/// Maximum number of paths accepted in a single `get_file_badges` call.
/// Mirrors `MAX_TREE_WATCHED_DIRS` in `watcher.rs` to bound the cost of a
/// single IPC round-trip (bug-hunter #11).
pub const MAX_BADGE_PATHS: usize = 1000;

/// Per-file badge: count of unresolved threads + max severity across them.
#[derive(Debug, Clone, serde::Serialize)]
pub struct FileBadge {
    pub count: u32,
    pub max_severity: Severity,
}

/// Per-file unresolved-thread count + worst severity.
#[tauri::command]
pub fn get_file_badges(
    state: State<'_, WatcherState>,
    file_paths: Vec<String>,
) -> Result<HashMap<String, FileBadge>, String> {
    enforce_badge_input_cap(&file_paths)?;
    Ok(get_file_badges_inner(&state, &file_paths))
}

/// Validates the input length cap for `get_file_badges`. Public so
/// integration tests can exercise the cap without having to fabricate a
/// `State<'_, WatcherState>`.
pub fn enforce_badge_input_cap(file_paths: &[String]) -> Result<(), String> {
    if file_paths.len() > MAX_BADGE_PATHS {
        Err("too many paths".to_string())
    } else {
        Ok(())
    }
}

/// Pure helper for [`get_file_badges`].
pub fn get_file_badges_inner(
    state: &WatcherState,
    file_paths: &[String],
) -> HashMap<String, FileBadge> {
    let mut out: HashMap<String, FileBadge> = HashMap::new();
    for fp in file_paths {
        // Use the relaxed guard so badges still surface for orphan / deleted
        // files whose sidecar is the only artifact left in the workspace.
        if !state.is_path_or_parent_allowed(Path::new(fp)) {
            continue;
        }
        let sidecar = match crate::core::sidecar::load_sidecar(fp) {
            Ok(Some(s)) => s,
            Ok(None) => continue,
            Err(e) => {
                tracing::warn!("[get_file_badges] could not load {fp}: {e}");
                continue;
            }
        };
        if sidecar.comments.is_empty() {
            continue;
        }
        let content = std::fs::read_to_string(fp).unwrap_or_default();
        let lines: Vec<&str> = content.lines().collect();
        let matched = crate::core::matching::match_comments(&sidecar.comments, &lines);
        let threads = crate::core::threads::group_into_threads(&matched);
        let mut count = 0u32;
        let mut worst = Severity::None;
        for t in &threads {
            let unresolved = !t.root.comment.resolved
                || t.replies.iter().any(|r| !r.comment.resolved);
            if !unresolved {
                continue;
            }
            count += 1;
            let s = max_severity(t);
            if s > worst {
                worst = s;
            }
        }
        if count > 0 {
            out.insert(
                fp.clone(),
                FileBadge {
                    count,
                    max_severity: worst,
                },
            );
        }
    }
    out
}
