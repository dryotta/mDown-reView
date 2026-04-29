//! `get_file_comments` command: load a sidecar, partition by anchor
//! variant, dispatch typed-anchor matching against a single shared
//! `LazyParsedDoc`, and return grouped threads.
//!
//! Extracted from `mod.rs` to keep that file under the 400-LOC budget
//! (architecture rule 23). The IPC entry point [`get_file_comments`] is
//! re-exported via `mod.rs` so `lib.rs` registration stays unchanged.

use crate::core::types::{CommentThread, MrsfComment};
use tauri::State;

use super::enforce_workspace_path;
use crate::watcher::{SidecarConfigState, WatcherState};

/// Result of [`get_file_comments`]: matched/grouped threads plus the mtime
/// of the sidecar file the loader actually picked. `sidecar_mtime_ms` is
/// `None` when no sidecar exists for `file_path` (or the platform/FS does
/// not expose mtime). Callers can use the value to detect external sidecar
/// edits without a follow-up IPC. Field name mirrors the `*_ms` epoch
/// convention used by [`crate::commands::FileStat::mtime_ms`].
#[derive(serde::Serialize, Debug, specta::Type)]
pub struct GetFileCommentsResult {
    pub threads: Vec<CommentThread>,
    pub sidecar_mtime_ms: Option<i64>,
}

/// Resolve the on-disk sidecar path from pre-resolved YAML/JSON paths.
/// Prefers YAML over JSON to match [`crate::core::sidecar::load_sidecar_at`].
/// Returns `None` when neither exists.
fn resolve_sidecar_path_from(yaml: &str, json: &str) -> Option<std::path::PathBuf> {
    let yaml = std::path::PathBuf::from(yaml);
    if yaml.exists() {
        return Some(yaml);
    }
    let json = std::path::PathBuf::from(json);
    if json.exists() {
        return Some(json);
    }
    None
}

fn sidecar_mtime_ms_from(yaml: &str, json: &str) -> Option<i64> {
    let path = resolve_sidecar_path_from(yaml, json)?;
    std::fs::metadata(&path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as i64)
}

/// Combined hot-path: load sidecar → match to file lines → build threads.
/// Single IPC call for the GUI's most common operation.
///
/// Comments are partitioned by anchor variant: `Line`/`File` go through the
/// existing `match_comments` batch algorithm (line-targeting heuristics);
/// typed anchors (CSV cell, JSON path, HTML range/element, image rect,
/// word range) are dispatched through [`crate::core::anchors::resolve_anchor`]
/// against a single shared [`crate::core::anchors::LazyParsedDoc`] so the
/// file is parsed at most once per call (lazily, only for the
/// representations the present anchors actually need).
///
/// Workspace-allowlisted via [`enforce_workspace_path`] (advisory #5 / iter-4
/// security blocker S2): rejects paths the user has not opened so a renderer
/// cannot probe arbitrary files. The file body itself is read with a 10 MB
/// cap (matching `read_text_file` and `SIDECAR_MAX_BYTES`) — anything larger
/// degrades silently to empty bytes so all comments orphan, identical to the
/// `NotFound` branch.
#[tauri::command]
#[specta::specta]
pub fn get_file_comments(
    state: State<'_, WatcherState>,
    config_state: State<'_, SidecarConfigState>,
    file_path: String,
) -> Result<GetFileCommentsResult, String> {
    enforce_workspace_path(&state, &file_path)?;
    get_file_comments_inner(&file_path, &config_state)
}

/// Pure helper for [`get_file_comments`]. Skips the workspace guard so
/// integration tests can exercise the matcher / typed-anchor path without
/// fabricating a `State<'_, WatcherState>`. The IPC layer must call the
/// `#[tauri::command]` wrapper above, never this function directly.
pub fn get_file_comments_inner(file_path: &str, config_state: &SidecarConfigState) -> Result<GetFileCommentsResult, String> {
    use crate::core::anchors::{resolve_anchor, LazyParsedDoc, MatchOutcome};
    use crate::core::types::{Anchor, MatchedComment};

    // Resolve sidecar paths ONCE — used for both mtime and load.
    let (yaml, json, _) = super::resolve_sidecar_pair(file_path, config_state);

    // Capture sidecar mtime up-front so the value reflects the same on-disk
    // state the loader is about to read. Loader failure does not invalidate
    // the mtime — return it anyway so callers can still detect edits.
    let sidecar_mtime_ms = sidecar_mtime_ms_from(&yaml, &json);

    let sidecar = crate::core::sidecar::load_sidecar_at(&yaml, &json).map_err(|e| e.to_string())?;
    let comments = match sidecar {
        Some(s) => s.comments,
        None => {
            return Ok(GetFileCommentsResult {
                threads: vec![],
                sidecar_mtime_ms,
            })
        }
    };
    if comments.is_empty() {
        return Ok(GetFileCommentsResult {
            threads: vec![],
            sidecar_mtime_ms,
        });
    }

    // Bucket comments by whether they need source bytes for resolution.
    // Only `Anchor::Line` and `Anchor::WordRange` consume the per-line UTF-8
    // split — `File`/`Unknown` do not. When no comment in the sidecar needs
    // bytes, skip `std::fs::File::open` entirely; this is the binary-source
    // hot path (an .mp3 / .png file with file-level comments must never be
    // UTF-8 decoded).
    let mut needs_bytes: Vec<MrsfComment> = Vec::new();
    let mut zero_io: Vec<MrsfComment> = Vec::new();
    for c in comments {
        match c.anchor {
            Anchor::Line { .. } | Anchor::WordRange(_) => needs_bytes.push(c),
            Anchor::File | Anchor::Unknown { .. } => zero_io.push(c),
        }
    }

    // Read raw bytes once with a 10 MB cap (security blocker S1: docs/security.md
    // rule 1 — every fs read must be bounded). NotFound (deleted/renamed),
    // over-cap, and other errors all silently degrade to empty bytes so all
    // comments orphan; cause is logged. Skipped entirely when only
    // `File`/`Unknown` anchors are present (binary-source-safe).
    const MAX_BYTES: usize = 10 * 1024 * 1024;
    let bytes = if needs_bytes.is_empty() {
        Vec::new()
    } else {
        match std::fs::File::open(file_path) {
            Ok(f) => {
                use std::io::Read;
                let mut buf = Vec::new();
                match f.take((MAX_BYTES + 1) as u64).read_to_end(&mut buf) {
                    Ok(_) if buf.len() > MAX_BYTES => {
                        tracing::warn!(
                            "get_file_comments: {file_path} exceeds {MAX_BYTES}-byte cap; orphaning all comments"
                        );
                        Vec::new()
                    }
                    Ok(_) => buf,
                    Err(e) => {
                        tracing::warn!("Could not read {file_path} for comment matching: {e}");
                        Vec::new()
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => {
                tracing::warn!("Could not open {file_path} for comment matching: {e}");
                Vec::new()
            }
        }
    };
    let doc = LazyParsedDoc::new(bytes);

    // Line: existing line-targeting heuristics. Skip materializing
    // `doc.lines()` entirely when there are no Line anchors — typed-only
    // sidecars on multi-MB files do not need the line-split cache, and
    // populating it would be the dominant cost (perf-expert iter-4 finding).
    let line_only: Vec<MrsfComment> = needs_bytes
        .iter()
        .filter(|c| matches!(c.anchor, Anchor::Line { .. }))
        .cloned()
        .collect();
    let mut matched = if line_only.is_empty() {
        Vec::new()
    } else {
        let lines_str: Vec<&str> = doc.lines().iter().map(String::as_str).collect();
        crate::core::matching::match_comments(&line_only, &lines_str)
    };

    // WordRange: per-comment dispatch through `resolve_anchor` (consumes
    // `doc.lines()` lazily on first call).
    for c in needs_bytes
        .into_iter()
        .filter(|c| matches!(c.anchor, Anchor::WordRange(_)))
    {
        let outcome = resolve_anchor(&c.anchor, &doc);
        matched.push(MatchedComment {
            comment: c,
            matched_line_number: 0,
            is_orphaned: matches!(outcome, MatchOutcome::Orphan),
            anchored_text: None,
        });
    }

    // File / Unknown: synthetic Exact match without touching `doc`. File
    // anchors land at line 1 (#131 invariant) so the panel sort and
    // line-keyed UI consumers behave consistently.
    for c in zero_io {
        let matched_line_number = if matches!(c.anchor, Anchor::File) { 1 } else { 0 };
        matched.push(MatchedComment {
            comment: c,
            matched_line_number,
            is_orphaned: false,
            anchored_text: None,
        });
    }

    Ok(GetFileCommentsResult {
        threads: crate::core::threads::group_into_threads(&matched),
        sidecar_mtime_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::get_file_comments_inner;
    use crate::core::anchors::LINES_INIT_COUNT;
    use crate::core::sidecar::save_sidecar;
    use crate::core::types::{Anchor, MrsfComment};
    use crate::watcher::SidecarConfigState;

    fn typed_comment(id: &str, anchor: Anchor) -> MrsfComment {
        MrsfComment {
            id: id.into(),
            author: "Test User (test)".into(),
            timestamp: "2026-04-20T12:00:00-07:00".into(),
            text: "typed".into(),
            resolved: false,
            anchor,
            ..Default::default()
        }
    }

    /// D1 perf guard: a sidecar containing ONLY typed anchors (no Line/File)
    /// must NOT materialize `LazyParsedDoc::lines()`  the per-line UTF-8
    /// split is the dominant cost on multi-MB files and is unused by these
    /// typed resolvers (HtmlElement, ImageRect; CSV/JSON likewise).
    /// `LINES_INIT_COUNT` is a thread-local so concurrent tests do not race.
    #[test]
    fn get_file_comments_only_typed_does_not_read_lines() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("doc.html");
        std::fs::write(&file, b"<html><body>x</body></html>").unwrap();
        let file_path = file.to_str().unwrap().to_string();

        let html_c = typed_comment(
            "c-html",
            Anchor::Unknown {
                kind: "html_element".into(),
                data: serde_json::json!({"selector_path":"html > body","tag":"body","text_preview":"x"}),
            },
        );
        let img_c = typed_comment(
            "c-img",
            Anchor::Unknown {
                kind: "image_rect".into(),
                data: serde_json::json!({"x_pct":10.0,"y_pct":10.0,"w_pct":20.0,"h_pct":20.0}),
            },
        );
        save_sidecar(&file_path, "doc.html", &[html_c, img_c]).unwrap();

        let config = SidecarConfigState::new();
        LINES_INIT_COUNT.with(|c| c.set(0));
        let _threads = get_file_comments_inner(&file_path, &config).expect("ok");
        assert_eq!(
            LINES_INIT_COUNT.with(|c| c.get()),
            0,
            "typed-only sidecars must not materialize doc.lines()  \
             D1 perf guard regressed"
        );
    }

    /// Companion to the perf-guard test: when the sidecar contains a
    /// Line/File anchor, the lines cache MUST be initialized exactly once.
    /// Locks in the positive side of the conditional so a future refactor
    /// that drops the line read entirely cannot pass silently.
    #[test]
    fn get_file_comments_with_line_anchor_initializes_lines_once() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("doc.md");
        std::fs::write(&file, b"line one\nline two\nline three\n").unwrap();
        let file_path = file.to_str().unwrap().to_string();

        let line_c = typed_comment(
            "c-line",
            Anchor::Line {
                line: 2,
                end_line: None,
                start_column: None,
                end_column: None,
                selected_text: Some("line two".into()),
                selected_text_hash: None,
            },
        );
        save_sidecar(&file_path, "doc.md", &[line_c]).unwrap();

        let config = SidecarConfigState::new();
        LINES_INIT_COUNT.with(|c| c.set(0));
        let _ = get_file_comments_inner(&file_path, &config).expect("ok");
        assert_eq!(
            LINES_INIT_COUNT.with(|c| c.get()),
            1,
            "Line-anchor path must materialize lines exactly once"
        );
    }

    /// File-level perf guard + binary-source safety: a sidecar containing
    /// only `Anchor::File` comments must never materialize `doc.lines()`
    /// AND every comment must surface anchored at line 1, non-orphaned
    /// (#131 invariant). We point the sidecar at a binary file containing
    /// raw NUL bytes — `std::fs::read_to_string` would either fail or
    /// produce lossy garbage if anyone widened `wants_source_bytes` to
    /// include `Anchor::File`.
    #[test]
    fn get_file_comments_only_file_anchors_skips_lines_and_anchors_at_one() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("phantom.bin");
        // Binary content with embedded NULs: invalid UTF-8 boundary, would
        // fail or lose data via `read_to_string`.
        std::fs::write(&file, [0xFFu8, 0x00, 0x80, 0xFE, 0x00]).unwrap();
        let file_path = file.to_str().unwrap().to_string();

        let f1 = typed_comment("f1", Anchor::File);
        let f2 = typed_comment("f2", Anchor::File);
        save_sidecar(&file_path, "phantom.bin", &[f1, f2]).unwrap();

        let config = SidecarConfigState::new();
        LINES_INIT_COUNT.with(|c| c.set(0));
        let result = get_file_comments_inner(&file_path, &config).expect("ok");
        assert_eq!(
            LINES_INIT_COUNT.with(|c| c.get()),
            0,
            "file-only sidecars must not materialize doc.lines()  binary-source-safe"
        );
        // Two top-level threads (no replies), each anchored at line 1
        // (#131), neither orphaned.
        assert_eq!(result.threads.len(), 2);
        for t in &result.threads {
            assert_eq!(t.root.matched_line_number, 1, "file anchors land at line 1");
            assert!(!t.root.is_orphaned, "file anchors are never orphaned");
            assert!(matches!(t.root.comment.anchor, Anchor::File));
        }
    }

    /// File-level + missing source: same invariant must hold even when the
    /// source file does not exist on disk (deleted or never created).
    /// CLI-driven workflows on binary files routinely leave the source
    /// file missing; the IPC must succeed without `std::fs` errors.
    #[test]
    fn get_file_comments_only_file_anchors_succeeds_when_source_missing() {
        let dir = tempfile::tempdir().unwrap();
        // NB: source file intentionally NOT created.
        let file_path = dir.path().join("missing.bin").to_str().unwrap().to_string();

        let f1 = typed_comment("f1", Anchor::File);
        save_sidecar(&file_path, "missing.bin", &[f1]).unwrap();

        let config = SidecarConfigState::new();
        let result = get_file_comments_inner(&file_path, &config).expect("ok");
        assert_eq!(result.threads.len(), 1);
        assert_eq!(result.threads[0].root.matched_line_number, 1);
        assert!(!result.threads[0].root.is_orphaned);
    }
}
