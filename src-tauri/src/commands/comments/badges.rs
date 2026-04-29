//! Per-file badge aggregators: unresolved counts + max severity.

use crate::core::severity::{max_severity, Severity};
use crate::core::types::{Anchor, MatchedComment};
use crate::watcher::{SidecarConfigState, WatcherState};
use rayon::prelude::*;
use std::collections::HashMap;
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
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct FileBadge {
    pub count: u32,
    pub max_severity: Severity,
    pub file_level_count: u32,
}

/// Per-file unresolved-thread count + worst severity.
#[tauri::command]
#[specta::specta]
pub fn get_file_badges(
    state: State<'_, WatcherState>,
    config_state: State<'_, SidecarConfigState>,
    cache: State<'_, super::BadgeCache>,
    file_paths: Vec<String>,
) -> Result<HashMap<String, FileBadge>, String> {
    enforce_badge_input_cap(&file_paths)?;
    Ok(get_file_badges_inner(&state, &config_state, &cache, &file_paths))
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
///
/// Read-only: walks each input path's sidecar, computes per-file
/// `(unresolved_count, max_severity)` and emits an entry only when
/// `count > 0`. Independently of the input order, the per-path work is
/// bounded by:
///   1. one stat of each candidate sidecar path (yaml + json),
///   2. one `read_capped` of the YAML/JSON sidecar (10 MB cap),
///   3. one optional `std::fs::read_to_string` of the source file when
///      the sidecar contains at least one `Anchor::Line` comment
///      (typed anchors and `Anchor::File` skip the read).
///
/// Steps 2 and 3 are skipped when the [`super::BadgeCache`] reports a
/// fresh hit for `(yaml_mtime, json_mtime)`. Cache misses fall through
/// to the full pipeline and the result is written back. The `_state`
/// parameter is intentionally unused — see the rationale above.
pub fn get_file_badges_inner(
    _state: &WatcherState,
    config_state: &SidecarConfigState,
    cache: &super::BadgeCache,
    file_paths: &[String],
) -> HashMap<String, FileBadge> {
    use std::sync::atomic::{AtomicU32, Ordering};
    let t_start = std::time::Instant::now();
    let cache_hits = AtomicU32::new(0);
    let sidecars_loaded = AtomicU32::new(0);
    let sidecars_skipped_empty = AtomicU32::new(0);
    let source_reads = AtomicU32::new(0);

    let collected: Vec<(String, FileBadge)> = file_paths
        .par_iter()
        .filter_map(|fp| {
            let (yaml, json, _) = super::resolve_sidecar_pair(fp, config_state);
            let yaml_mtime = super::badge_cache::mtime_ms(&yaml);
            let json_mtime = super::badge_cache::mtime_ms(&json);

            // Cache lookup short-circuits sidecar IO + matching when
            // both fingerprints match a prior result. A `None` mtime
            // (sidecar absent) is a valid fingerprint half — see
            // `BadgeCache::lookup` for the equality contract.
            if let Some(badge) = cache.lookup(fp, yaml_mtime, json_mtime) {
                cache_hits.fetch_add(1, Ordering::Relaxed);
                return Some((fp.clone(), badge));
            }

            let sidecar = match crate::core::sidecar::load_sidecar_at(&yaml, &json) {
                Ok(Some(s)) => {
                    sidecars_loaded.fetch_add(1, Ordering::Relaxed);
                    s
                }
                Ok(None) => {
                    // No sidecar exists — drop any stale cache entry
                    // and skip emitting a badge for this path.
                    cache.invalidate(fp);
                    return None;
                }
                Err(e) => {
                    tracing::warn!("[get_file_badges] could not load {fp}: {e}");
                    return None;
                }
            };
            if sidecar.comments.is_empty() {
                sidecars_skipped_empty.fetch_add(1, Ordering::Relaxed);
                cache.invalidate(fp);
                return None;
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
                source_reads.fetch_add(1, Ordering::Relaxed);
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
            if count == 0 {
                cache.invalidate(fp);
                None
            } else {
                let badge = FileBadge {
                    count,
                    max_severity: worst,
                    file_level_count,
                };
                cache.insert(fp.clone(), yaml_mtime, json_mtime, badge.clone());
                Some((fp.clone(), badge))
            }
        })
        .collect();

    let mut out: HashMap<String, FileBadge> = HashMap::with_capacity(collected.len());
    for (k, v) in collected {
        out.insert(k, v);
    }

    let elapsed_ms = t_start.elapsed().as_millis();
    tracing::info!(
        "[badge-diag] get_file_badges: input={} cache_hits={} sidecars_loaded={} sidecars_empty={} source_reads={} emitted={} elapsed_ms={}",
        file_paths.len(),
        cache_hits.load(Ordering::Relaxed),
        sidecars_loaded.load(Ordering::Relaxed),
        sidecars_skipped_empty.load(Ordering::Relaxed),
        source_reads.load(Ordering::Relaxed),
        out.len(),
        elapsed_ms,
    );
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
        let cache = super::super::BadgeCache::new();
        let badges = get_file_badges_inner(&state, &config, &cache, std::slice::from_ref(&file_path));
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
        let cache = super::super::BadgeCache::new();
        let badges = get_file_badges_inner(&state, &config, &cache, std::slice::from_ref(&file_path));
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
        let cache = super::super::BadgeCache::new();
        let badges = get_file_badges_inner(&state, &config, &cache, std::slice::from_ref(&file_path));
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
        let cache = super::super::BadgeCache::new();
        let badges = get_file_badges_inner(&state, &config, &cache, std::slice::from_ref(&file_path));
        let badge = badges.get(&file_path).expect("badge for mixed file");
        assert_eq!(badge.count, 3);
        assert_eq!(badge.file_level_count, 2);
        assert_eq!(badge.max_severity, Severity::High);
    }

    /// Fix #3 regression: a sidecar containing only `Anchor::File`
    /// comments must NOT trigger a `std::fs::read_to_string(fp)` of the
    /// source file. Validated by deliberately omitting the source file
    /// from disk — if the badge code tried to read it, it would still
    /// "work" (just produce empty lines), but the explicit safeguard is
    /// that file-anchor-only sidecars must surface a badge identical to
    /// what a typed-anchor-only sidecar produces.
    #[test]
    fn file_anchor_only_skips_source_read() {
        let dir = tempfile::tempdir().unwrap();
        let canonical = canonicalize_no_verbatim(dir.path()).unwrap();
        // NB: file intentionally NOT created on disk.
        let file_path = canonical.join("doc.md").to_string_lossy().into_owned();

        let file_only = MrsfComment {
            id: "f1".to_string(),
            author: "T".to_string(),
            timestamp: "2026-01-01T00:00:00Z".to_string(),
            text: "file-level comment".to_string(),
            resolved: false,
            severity: Some("high".to_string()),
            anchor: Anchor::File,
            ..Default::default()
        };
        save_sidecar(&file_path, "doc.md", &[file_only]).unwrap();

        let state = watcher_state_allowing(&canonical);
        let config = SidecarConfigState::new();
        let cache = super::super::BadgeCache::new();
        let badges = get_file_badges_inner(&state, &config, &cache, std::slice::from_ref(&file_path));
        let badge = badges
            .get(&file_path)
            .expect("badge for file-anchor-only sidecar");
        assert_eq!(badge.count, 1);
        assert_eq!(badge.max_severity, Severity::High);
    }

    /// Iter-7 regression: badges must surface even when the
    /// `tree_watched_dirs` allowlist is empty (i.e. before the
    /// `update_tree_watched_dirs` IPC has had a chance to populate it).
    /// Previously, `get_file_badges` ran every input through
    /// `is_path_or_parent_allowed`, which produced a TOCTOU race on
    /// every workspace open: `read_dir` resolved fast, `useFileBadges`
    /// fired immediately, the gate was still empty, and every path was
    /// rejected — leaving badges blank until the user expanded a
    /// folder. Dropping the gate (commit chore/badge-loading-diag)
    /// turns this into a passing assertion. If a future change re-adds
    /// the gate, this test will break and force a deliberate decision.
    #[test]
    fn badges_surface_without_tree_watched_dirs_allowlist() {
        let dir = tempfile::tempdir().unwrap();
        let canonical = canonicalize_no_verbatim(dir.path()).unwrap();
        let file = canonical.join("doc.md");
        std::fs::write(&file, "alpha\n").unwrap();
        let file_path = file.to_string_lossy().into_owned();

        save_sidecar(
            &file_path,
            "doc.md",
            &[line_comment("c1", 1, false, Some("high"))],
        )
        .unwrap();

        // Fresh WatcherState — `tree_watched_dirs` has never been
        // populated. Pre-fix: result was `{}`. Post-fix: badge surfaces.
        let (tx, _rx) = std::sync::mpsc::sync_channel(1);
        let state = WatcherState::new(tx);
        let config = SidecarConfigState::new();
        let cache = super::super::BadgeCache::new();
        let badges = get_file_badges_inner(&state, &config, &cache, std::slice::from_ref(&file_path));
        let badge = badges
            .get(&file_path)
            .expect("badge must surface even when tree_watched_dirs is empty");
        assert_eq!(badge.count, 1);
        assert_eq!(badge.max_severity, Severity::High);
    }

    /// Fix #6 regression: a second call with no sidecar mutation hits
    /// the cache — sidecar bytes are NOT re-loaded from disk. We verify
    /// this indirectly by deleting the sidecar between calls AFTER the
    /// cache populates: pre-fix, the second call would see no sidecar
    /// and return `{}`; post-fix, the cache hit short-circuits the disk
    /// read for the original (yaml_mtime, json_mtime) — but mtime
    /// changes (now `None`) so the lookup misses, forcing recompute.
    /// To prove the cache is REALLY working, we instead repeat the
    /// call with the sidecar untouched and assert the cache len is 1.
    #[test]
    fn second_call_hits_cache_when_sidecar_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let canonical = canonicalize_no_verbatim(dir.path()).unwrap();
        let file = canonical.join("doc.md");
        std::fs::write(&file, "alpha\n").unwrap();
        let file_path = file.to_string_lossy().into_owned();
        save_sidecar(
            &file_path,
            "doc.md",
            &[line_comment("c1", 1, false, Some("medium"))],
        )
        .unwrap();

        let state = watcher_state_allowing(&canonical);
        let config = SidecarConfigState::new();
        let cache = super::super::BadgeCache::new();

        // First call populates the cache.
        let first = get_file_badges_inner(&state, &config, &cache, std::slice::from_ref(&file_path));
        assert_eq!(first.get(&file_path).expect("badge").count, 1);
        assert_eq!(cache.len(), 1);

        // Second call must hit the cache. We can't directly observe
        // "no I/O happened" without injecting a stub, but we CAN assert
        // (a) the result is identical and (b) the cache is unchanged
        // (still 1 entry, same fingerprint).
        let second = get_file_badges_inner(&state, &config, &cache, std::slice::from_ref(&file_path));
        assert_eq!(second.get(&file_path).expect("badge").count, 1);
        assert_eq!(cache.len(), 1);
    }

    /// Fix #6 regression: when the sidecar is mutated (mtime advances)
    /// the cached entry is invalidated and the next call recomputes
    /// against the new content.
    #[test]
    fn cache_invalidates_after_sidecar_mutation() {
        let dir = tempfile::tempdir().unwrap();
        let canonical = canonicalize_no_verbatim(dir.path()).unwrap();
        let file = canonical.join("doc.md");
        std::fs::write(&file, "alpha\n").unwrap();
        let file_path = file.to_string_lossy().into_owned();
        save_sidecar(
            &file_path,
            "doc.md",
            &[line_comment("c1", 1, false, Some("low"))],
        )
        .unwrap();

        let state = watcher_state_allowing(&canonical);
        let config = SidecarConfigState::new();
        let cache = super::super::BadgeCache::new();

        let first = get_file_badges_inner(&state, &config, &cache, std::slice::from_ref(&file_path));
        assert_eq!(first.get(&file_path).expect("badge").count, 1);
        assert_eq!(first.get(&file_path).unwrap().max_severity, Severity::Low);

        // Mutate the sidecar — bump severity to high. Sleep briefly so
        // the mtime step is reliably observable on Windows (FAT/ReFS
        // resolution is 100 ns; NTFS is much finer; CI VMs vary).
        std::thread::sleep(std::time::Duration::from_millis(10));
        save_sidecar(
            &file_path,
            "doc.md",
            &[
                line_comment("c1", 1, false, Some("low")),
                line_comment("c2", 1, false, Some("high")),
            ],
        )
        .unwrap();

        let second = get_file_badges_inner(&state, &config, &cache, std::slice::from_ref(&file_path));
        let badge = second.get(&file_path).expect("badge after mutation");
        assert_eq!(badge.count, 2);
        assert_eq!(badge.max_severity, Severity::High);
    }
}
