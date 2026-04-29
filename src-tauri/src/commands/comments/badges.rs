//! Per-file badge aggregators: unresolved counts + max severity.

use crate::core::severity::{max_severity, Severity};
use crate::core::types::{Anchor, MatchedComment};
use crate::watcher::{SidecarConfigState, WatcherState};
use std::collections::HashMap;
use std::path::Path;
use tauri::State;

/// File anchors and typed anchors (image/csv/json/html/word) do not need to
/// read source bytes for badge computation. The matcher path
/// (`match_comments`) is the only consumer of the per-line UTF-8 split, and
/// it only handles `Anchor::Line`. File-level threads are anchored at line 1
/// per #131 (synthesised below) without ever opening the file — critical for
/// binary-source files where the bytes are not UTF-8 in the first place.
fn wants_source_bytes(anchor: &Anchor) -> bool {
    matches!(anchor, Anchor::Line { .. })
}

/// Maximum number of paths accepted in a single `get_file_badges` call.
/// Mirrors `MAX_TREE_WATCHED_DIRS` in `watcher.rs` to bound the cost of a
/// single IPC round-trip (bug-hunter #11).
pub const MAX_BADGE_PATHS: usize = 1000;

/// Per-file badge: count of unresolved threads + max severity across them.
/// `file_level_count` is the subset of `count` whose root anchor is
/// `Anchor::File` — surfaced separately so the viewer toolbar can show a
/// dedicated file-anchored thread badge.
#[derive(Debug, Clone, serde::Serialize)]
pub struct FileBadge {
    pub count: u32,
    pub max_severity: Severity,
    pub file_level_count: u32,
}

/// Per-file unresolved-thread count + worst severity.
#[tauri::command]
pub fn get_file_badges(
    state: State<'_, WatcherState>,
    config_state: State<'_, SidecarConfigState>,
    file_paths: Vec<String>,
) -> Result<HashMap<String, FileBadge>, String> {
    enforce_badge_input_cap(&file_paths)?;
    Ok(get_file_badges_inner(&state, &config_state, &file_paths))
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
    config_state: &SidecarConfigState,
    file_paths: &[String],
) -> HashMap<String, FileBadge> {
    let mut out: HashMap<String, FileBadge> = HashMap::new();
    for fp in file_paths {
        // Use the relaxed guard so badges still surface for orphan / deleted
        // files whose sidecar is the only artifact left in the workspace.
        if !state.is_path_or_parent_allowed(Path::new(fp)) {
            continue;
        }
        let (yaml, json, _) = super::resolve_sidecar_pair(fp, config_state);
        let sidecar = match crate::core::sidecar::load_sidecar_at(&yaml, &json) {
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

        // Wave 1b short-circuit: split typed-anchor + file comments out of
        // the matcher path. File anchors are anchored at synthetic line 1
        // (#131) and typed anchors are counted as Exact — neither needs the
        // matcher / source-byte read. Only `Anchor::Line` flows through
        // `match_comments` and only then do we touch the file system.
        let mut zero_io_matched: Vec<MatchedComment> = Vec::new();
        let mut line_only: Vec<crate::core::types::MrsfComment> = Vec::new();
        for c in &sidecar.comments {
            if wants_source_bytes(&c.anchor) {
                line_only.push(c.clone());
            } else {
                zero_io_matched.push(MatchedComment {
                    comment: c.clone(),
                    matched_line_number: if matches!(c.anchor, Anchor::File) { 1 } else { 0 },
                    is_orphaned: false,
                    anchored_text: None,
                });
            }
        }

        let line_matched = if line_only.is_empty() {
            Vec::new()
        } else {
            let content = std::fs::read_to_string(fp).unwrap_or_default();
            let lines: Vec<&str> = content.lines().collect();
            crate::core::matching::match_comments(&line_only, &lines)
        };

        let mut matched = line_matched;
        matched.extend(zero_io_matched);
        let threads = crate::core::threads::group_into_threads(&matched);
        let mut count = 0u32;
        let mut file_level_count = 0u32;
        let mut worst = Severity::None;
        for t in &threads {
            let unresolved =
                !t.root.comment.resolved || t.replies.iter().any(|r| !r.comment.resolved);
            if !unresolved {
                continue;
            }
            count += 1;
            if matches!(t.root.comment.anchor, Anchor::File) {
                file_level_count += 1;
            }
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
                    file_level_count,
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
    use crate::core::types::{Anchor, MrsfComment};
    use crate::watcher::WatcherState;

    fn watcher_state_allowing(dir: &std::path::Path) -> WatcherState {
        let canonical = canonicalize_no_verbatim(dir).unwrap();
        let (tx, _rx) = std::sync::mpsc::sync_channel(1);
        let state = WatcherState::new(tx);
        state
            .set_tree_watched_dirs(
                "test",
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
            Anchor::Unknown {
                kind: "csv_cell".into(),
                data: serde_json::json!({"row_idx":0,"col_idx":0,"col_header":"name"}),
            },
            false,
            Some("medium"),
        );
        let resolved = typed_comment(
            "r1",
            Anchor::Unknown {
                kind: "json_path".into(),
                data: serde_json::json!({"json_path":"$.foo"}),
            },
            true,
            Some("high"),
        );
        save_sidecar(&file_path, "data.csv", &[unresolved, resolved]).unwrap();

        let state = watcher_state_allowing(&canonical);
        let config = SidecarConfigState::new();
        let badges = get_file_badges_inner(&state, &config, std::slice::from_ref(&file_path));
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
            Anchor::Unknown {
                kind: "html_element".into(),
                data: serde_json::json!({"selector_path":"html>body>p","tag":"p","text_preview":"hi"}),
            },
            false,
            Some("low"),
        );
        let line = line_comment("l1", 1, false, Some("high"));
        save_sidecar(&file_path, "doc.md", &[typed, line]).unwrap();

        let state = watcher_state_allowing(&canonical);
        let config = SidecarConfigState::new();
        let badges = get_file_badges_inner(&state, &config, std::slice::from_ref(&file_path));
        let badge = badges.get(&file_path).expect("badge for mixed file");
        assert_eq!(badge.count, 2);
        assert_eq!(badge.max_severity, Severity::High);
        assert_eq!(badge.file_level_count, 0);
    }

    /// File-level-only sidecar against a MISSING source file produces a
    /// correct badge — proves badge computation never touches the source
    /// file path for `Anchor::File` (binary-source-safe). If the matcher
    /// path were taken, `std::fs::read_to_string` would degrade the comment
    /// to orphaned-at-line-1 with an empty content; the badge would still
    /// count it but the assertion below would catch a regression where
    /// `wants_source_bytes` accidentally widens to include `Anchor::File`.
    #[test]
    fn file_level_only_with_missing_source_produces_badge() {
        let dir = tempfile::tempdir().unwrap();
        let canonical = canonicalize_no_verbatim(dir.path()).unwrap();
        // NB: source file intentionally NOT created.
        let file_path = canonical.join("phantom.bin").to_string_lossy().into_owned();

        let unresolved = typed_comment("f1", Anchor::File, false, Some("high"));
        let resolved = typed_comment("f2", Anchor::File, true, Some("low"));
        save_sidecar(&file_path, "phantom.bin", &[unresolved, resolved]).unwrap();

        let state = watcher_state_allowing(&canonical);
        let config = SidecarConfigState::new();
        let badges = get_file_badges_inner(&state, &config, std::slice::from_ref(&file_path));
        let badge = badges.get(&file_path).expect("badge for file-only sidecar");
        assert_eq!(badge.count, 1, "one unresolved file-level thread");
        assert_eq!(badge.file_level_count, 1, "the unresolved thread is file-level");
        assert_eq!(badge.max_severity, Severity::High);
    }

    /// `file_level_count` is the file-anchored subset of `count` — it must
    /// not include line-anchored threads even when their resolved/severity
    /// state is similar.
    #[test]
    fn file_level_count_is_subset_of_count() {
        let dir = tempfile::tempdir().unwrap();
        let canonical = canonicalize_no_verbatim(dir.path()).unwrap();
        let file = canonical.join("doc.md");
        std::fs::write(&file, "alpha\nbeta\ngamma\n").unwrap();
        let file_path = file.to_string_lossy().into_owned();

        let line = line_comment("l1", 2, false, Some("medium"));
        let file_a = typed_comment("f1", Anchor::File, false, Some("low"));
        let file_b = typed_comment("f2", Anchor::File, false, Some("high"));
        save_sidecar(&file_path, "doc.md", &[line, file_a, file_b]).unwrap();

        let state = watcher_state_allowing(&canonical);
        let config = SidecarConfigState::new();
        let badges = get_file_badges_inner(&state, &config, std::slice::from_ref(&file_path));
        let badge = badges.get(&file_path).expect("badge for mixed file");
        assert_eq!(badge.count, 3);
        assert_eq!(badge.file_level_count, 2);
        assert_eq!(badge.max_severity, Severity::High);
    }
}
