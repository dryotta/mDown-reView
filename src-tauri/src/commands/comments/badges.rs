//! Per-file badge aggregators: unresolved counts + max severity.

use crate::core::severity::{max_severity, Severity};
use crate::core::types::{Anchor, MatchedComment};
use crate::watcher::WatcherState;
use std::collections::HashMap;
use std::path::Path;
use tauri::State;

/// Typed anchors (image/csv/json/html/word) require kind-specific resolvers to
/// turn payload coordinates into a "matched" position. Badges short-circuit:
/// they treat every typed anchor as Exact (no orphaning), counting unresolved
/// ones without ever reading file content. Real resolution happens lazily in
/// `get_file_comments` when a file is actually opened. This keeps badge
/// computation O(N) over the sidecar with zero file I/O for typed-anchor-only
/// files (e.g. images, CSVs).
fn is_typed_anchor(anchor: &Anchor) -> bool {
    matches!(
        anchor,
        Anchor::ImageRect(_)
            | Anchor::CsvCell(_)
            | Anchor::JsonPath(_)
            | Anchor::HtmlRange(_)
            | Anchor::HtmlElement(_)
            | Anchor::WordRange(_)
    )
}

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

        // Wave 1b short-circuit: split typed-anchor comments out of the
        // matcher path. Typed anchors are counted as Exact (synthetic
        // `MatchedComment`) so we never call `match_comments` for them and
        // never touch the file system unless there's at least one
        // Line/File-anchored comment that actually needs re-anchoring.
        let mut typed_matched: Vec<MatchedComment> = Vec::new();
        let mut line_or_file: Vec<crate::core::types::MrsfComment> = Vec::new();
        for c in &sidecar.comments {
            if is_typed_anchor(&c.anchor) {
                typed_matched.push(MatchedComment {
                    comment: c.clone(),
                    matched_line_number: 0,
                    is_orphaned: false,
                    anchored_text: None,
                });
            } else {
                line_or_file.push(c.clone());
            }
        }

        let line_matched = if line_or_file.is_empty() {
            Vec::new()
        } else {
            let content = std::fs::read_to_string(fp).unwrap_or_default();
            let lines: Vec<&str> = content.lines().collect();
            crate::core::matching::match_comments(&line_or_file, &lines)
        };

        let mut matched = line_matched;
        matched.extend(typed_matched);
        let threads = crate::core::threads::group_into_threads(&matched);
        let mut count = 0u32;
        let mut worst = Severity::None;
        for t in &threads {
            let unresolved =
                !t.root.comment.resolved || t.replies.iter().any(|r| !r.comment.resolved);
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::paths::canonicalize_no_verbatim;
    use crate::core::sidecar::save_sidecar;
    use crate::core::types::{
        Anchor, CsvCellAnchor, HtmlElementAnchor, JsonPathAnchor, MrsfComment,
    };
    use crate::watcher::WatcherState;

    fn watcher_state_allowing(dir: &std::path::Path) -> WatcherState {
        let canonical = canonicalize_no_verbatim(dir).unwrap();
        let (tx, _rx) = std::sync::mpsc::sync_channel(1);
        let state = WatcherState::new(tx);
        state
            .set_tree_watched_dirs(
                canonical.to_string_lossy().into_owned(),
                vec![canonical.to_string_lossy().into_owned()],
            )
            .unwrap();
        state
    }

    fn typed_comment(
        id: &str,
        anchor: Anchor,
        resolved: bool,
        severity: Option<&str>,
    ) -> MrsfComment {
        MrsfComment {
            id: id.to_string(),
            author: "T".to_string(),
            timestamp: format!("2026-01-01T00:00:0{}Z", id.len() % 10),
            text: format!("typed {id}"),
            resolved,
            severity: severity.map(str::to_string),
            anchor,
            ..Default::default()
        }
    }

    fn line_comment(id: &str, line: u32, resolved: bool, severity: Option<&str>) -> MrsfComment {
        MrsfComment {
            id: id.to_string(),
            author: "T".to_string(),
            timestamp: format!("2026-01-02T00:00:0{}Z", id.len() % 10),
            text: format!("line {id}"),
            resolved,
            line: Some(line),
            severity: severity.map(str::to_string),
            anchor: Anchor::Line {
                line,
                end_line: None,
                start_column: None,
                end_column: None,
                selected_text: None,
                selected_text_hash: None,
            },
            ..Default::default()
        }
    }

    /// Wave 1b invariant: a typed-anchor-only sidecar must produce a badge
    /// even when the underlying file is missing on disk (i.e. no file read
    /// happens). One unresolved CsvCell + one resolved JsonPath → count=1.
    #[test]
    fn typed_anchor_comments_counted_without_parsing() {
        let dir = tempfile::tempdir().unwrap();
        let canonical = canonicalize_no_verbatim(dir.path()).unwrap();
        // NB: file intentionally NOT created. If badges code reads it, the
        // matcher path runs over an empty `Vec<&str>` and orphans are
        // produced — but these typed anchors must not flow through the
        // matcher at all, so the badge must still surface.
        let file_path = canonical.join("data.csv").to_string_lossy().into_owned();

        let unresolved = typed_comment(
            "u1",
            Anchor::CsvCell(CsvCellAnchor {
                row_idx: 0,
                col_idx: 0,
                col_header: "name".into(),
                primary_key_col: None,
                primary_key_value: None,
            }),
            false,
            Some("medium"),
        );
        let resolved = typed_comment(
            "r1",
            Anchor::JsonPath(JsonPathAnchor {
                json_path: "$.foo".into(),
                scalar_text: None,
            }),
            true,
            Some("high"),
        );
        save_sidecar(&file_path, "data.csv", &[unresolved, resolved]).unwrap();

        let state = watcher_state_allowing(&canonical);
        let badges = get_file_badges_inner(&state, std::slice::from_ref(&file_path));
        let badge = badges.get(&file_path).expect("badge for typed-only file");
        assert_eq!(badge.count, 1);
        assert_eq!(badge.max_severity, Severity::Medium);
    }

    /// Mixed typed + line anchors must both contribute to the count.
    #[test]
    fn mixed_typed_and_line_anchors() {
        let dir = tempfile::tempdir().unwrap();
        let canonical = canonicalize_no_verbatim(dir.path()).unwrap();
        let file = canonical.join("doc.md");
        std::fs::write(&file, "alpha\nbeta\n").unwrap();
        let file_path = file.to_string_lossy().into_owned();

        let typed = typed_comment(
            "t1",
            Anchor::HtmlElement(HtmlElementAnchor {
                selector_path: "html>body>p".into(),
                tag: "p".into(),
                text_preview: "hi".into(),
            }),
            false,
            Some("low"),
        );
        let line = line_comment("l1", 1, false, Some("high"));
        save_sidecar(&file_path, "doc.md", &[typed, line]).unwrap();

        let state = watcher_state_allowing(&canonical);
        let badges = get_file_badges_inner(&state, std::slice::from_ref(&file_path));
        let badge = badges.get(&file_path).expect("badge for mixed file");
        assert_eq!(badge.count, 2);
        assert_eq!(badge.max_severity, Severity::High);
    }
}
