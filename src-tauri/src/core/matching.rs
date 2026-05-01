use crate::core::fuzzy::fuzzy_score;
use crate::core::types::{MatchedComment, MrsfComment};
use sha2::{Digest, Sha256};

const FUZZY_THRESHOLD: f64 = 0.6;

/// Match comments to file lines using the 4-step re-anchoring algorithm.
///
/// For each comment:
/// 1. Exact `selected_text` substring match (original line first, then full scan)
///    — when multiple matches exist, pick closest to original line (MRSF §7.2)
/// 2. Line fallback with plausibility check (MRSF §7.4 step 2b)
/// 3. Fuzzy match via Levenshtein similarity
/// 4. Orphan at clamped line or 1
///
/// `cmd` is the caller name (`get_file_comments` / `get_file_badges`) used as
/// the `cmd=` field on `[matching]` log lines (issue #280 AC4). `file_path` is
/// hashed (sha256, lower-hex, 8 chars) per call so log lines correlate without
/// leaking the path; see `docs/observability.md` `[matching]` schema.
pub fn match_comments(
    comments: &[MrsfComment],
    file_lines: &[&str],
    file_path: &str,
    cmd: &'static str,
) -> Vec<MatchedComment> {
    let line_count = file_lines.len() as u32;
    let file_hash = sha8(file_path);

    comments
        .iter()
        .map(|comment| {
            let orig_line = comment.line;
            let orig_end = comment.end_line;

            if line_count == 0 {
                emit_match_event(
                    cmd, &comment.id, &file_hash, "orphan",
                    orig_line, orig_end, 1, orig_end, false,
                );
                return MatchedComment {
                    comment: comment.clone(),
                    matched_line_number: 1,
                    is_orphaned: true,
                    anchored_text: None,
                    original_line: orig_line,
                };
            }

            let selected_text = comment.selected_text.as_deref();

            // File-level comments have no line and no selected_text —
            // they are always anchored at line 1 and never orphaned (#131).
            // Synthetic file-level: not a re-anchor decision, no [matching] emit.
            if orig_line.is_none() && selected_text.is_none() {
                return MatchedComment {
                    comment: comment.clone(),
                    matched_line_number: 1,
                    is_orphaned: false,
                    anchored_text: None,
                    original_line: None,
                };
            }

            // Step 1: Exact selected_text match (MRSF §7.4 step 1)
            if let Some(sel) = selected_text {
                // Collect all matching lines
                let matches: Vec<u32> = file_lines
                    .iter()
                    .enumerate()
                    .filter(|(_, line)| line.contains(sel))
                    .map(|(i, _)| (i as u32) + 1)
                    .collect();

                if matches.len() == 1 {
                    // §7.4 step 1a — single match
                    let new_line = matches[0];
                    let re_derived = new_line != orig_line.unwrap_or(0);
                    let outcome = if re_derived { "exact-relocated" } else { "exact-orig" };
                    emit_match_event(
                        cmd, &comment.id, &file_hash, outcome,
                        orig_line, orig_end, new_line, orig_end, re_derived,
                    );
                    let mut c = comment.clone();
                    c.line = Some(new_line);
                    return MatchedComment {
                        comment: c,
                        matched_line_number: new_line,
                        is_orphaned: false,
                        anchored_text: None,
                        original_line: orig_line,
                    };
                } else if matches.len() > 1 {
                    // §7.4 step 1b / §7.2 — multiple matches
                    if let Some(ol) = orig_line {
                        // Disambiguate: pick closest to original line
                        let best = *matches
                            .iter()
                            .min_by_key(|&&m| (m as i64 - ol as i64).unsigned_abs())
                            .unwrap();
                        let re_derived = best != ol;
                        let outcome = if re_derived { "exact-relocated" } else { "exact-orig" };
                        emit_match_event(
                            cmd, &comment.id, &file_hash, outcome,
                            orig_line, orig_end, best, orig_end, re_derived,
                        );
                        let mut c = comment.clone();
                        c.line = Some(best);
                        return MatchedComment {
                            comment: c,
                            matched_line_number: best,
                            is_orphaned: false,
                            anchored_text: None,
                            original_line: orig_line,
                        };
                    }
                    // No line hint — §7.2 SHOULD flag as ambiguous; pick first
                    let first = matches[0];
                    emit_match_event(
                        cmd, &comment.id, &file_hash, "exact-ambiguous",
                        orig_line, orig_end, first, orig_end, true,
                    );
                    let mut c = comment.clone();
                    c.line = Some(first);
                    return MatchedComment {
                        comment: c,
                        matched_line_number: first,
                        is_orphaned: false,
                        anchored_text: None,
                        original_line: orig_line,
                    };
                }
                // No matches found — fall through to step 2
            }

            // Step 2: Line/column fallback with plausibility check (MRSF §7.4 step 2)
            if let Some(ol) = orig_line {
                if ol >= 1 && ol <= line_count {
                    if let Some(sel) = selected_text {
                        // §7.4 step 2b — check if content at original line is plausible
                        let line_text = file_lines[(ol - 1) as usize];
                        let plausibility = fuzzy_score(sel, line_text);
                        if plausibility >= FUZZY_THRESHOLD {
                            // Plausible: anchor here but mark as needing re-anchoring
                            emit_match_event(
                                cmd, &comment.id, &file_hash, "plausibility",
                                orig_line, orig_end, ol, orig_end, false,
                            );
                            let mut c = comment.clone();
                            c.line = Some(ol);
                            return MatchedComment {
                                comment: c,
                                matched_line_number: ol,
                                is_orphaned: false,
                                anchored_text: Some(line_text.to_string()),
                                original_line: orig_line,
                            };
                        }
                        // Not plausible — proceed to step 3 (fuzzy search)
                    } else {
                        // Pure line fallback (no selected_text)
                        emit_match_event(
                            cmd, &comment.id, &file_hash, "line-fallback",
                            orig_line, orig_end, ol, orig_end, false,
                        );
                        return MatchedComment {
                            comment: comment.clone(),
                            matched_line_number: ol,
                            is_orphaned: false,
                            anchored_text: None,
                            original_line: orig_line,
                        };
                    }
                }
            }

            // Step 3: Fuzzy match (contextual re-anchoring, MRSF §7.4 step 3)
            if let Some(sel) = selected_text {
                let center = orig_line.unwrap_or(1);
                if let Some(fuzzy) = find_fuzzy_match(file_lines, sel, center) {
                    let re_derived = fuzzy.line != orig_line.unwrap_or(fuzzy.line);
                    emit_match_event(
                        cmd, &comment.id, &file_hash, "fuzzy",
                        orig_line, orig_end, fuzzy.line, orig_end, re_derived,
                    );
                    let mut c = comment.clone();
                    c.line = Some(fuzzy.line);
                    return MatchedComment {
                        comment: c,
                        matched_line_number: fuzzy.line,
                        is_orphaned: false,
                        anchored_text: Some(fuzzy.anchored_text),
                        original_line: orig_line,
                    };
                }
            }

            // Step 4: Orphan (MRSF §7.4 step 4)
            let fallback_line = match orig_line {
                Some(ol) => ol.min(line_count),
                None => 1,
            };
            emit_match_event(
                cmd, &comment.id, &file_hash, "orphan",
                orig_line, orig_end, fallback_line, orig_end, false,
            );
            MatchedComment {
                comment: comment.clone(),
                matched_line_number: fallback_line,
                is_orphaned: true,
                anchored_text: None,
                original_line: orig_line,
            }
        })
        .collect()
}

/// sha256(path) lowercased hex, truncated to 8 chars. Used as the `file=`
/// correlation token on `[matching]` log lines so analyzers can group
/// per-file events without leaking the path itself (privacy + log size).
fn sha8(path: &str) -> String {
    let h = format!("{:x}", Sha256::digest(path.as_bytes()));
    h[..8].to_string()
}

/// Emit one `[matching]` log line per matcher decision (issue #280 AC4).
///
/// `tracing::warn!` always-on for `exact-ambiguous` / `orphan` / `fuzzy`
/// (user-visible reanchor regressions surfaced even in release builds);
/// `tracing::info!` gated on `--trace` / `MDR_IPC_TRACE` via
/// `startup_recorder::ipc_trace_enabled()` (same gate as `[ipc]` info).
/// WARN is suppressed when `cmd == "get_file_badges"` to keep folder-badge
/// refresh from spraying logs (rubber-duck rationale: badges aggregate
/// over many files, repeating WARNs add no signal beyond the first call).
/// Schema is documented in `docs/observability.md` `[matching]` schema.
#[allow(clippy::too_many_arguments)]
fn emit_match_event(
    cmd: &'static str,
    comment_id: &str,
    file_path_hash: &str,
    outcome: &'static str,
    orig_line: Option<u32>,
    orig_end: Option<u32>,
    matched_line: u32,
    matched_end: Option<u32>,
    re_derived: bool,
) {
    let warn_outcome = matches!(outcome, "exact-ambiguous" | "orphan" | "fuzzy");
    let suppress_warn = cmd == "get_file_badges";

    if warn_outcome && !suppress_warn {
        tracing::warn!(
            target: "matching",
            cmd,
            file = file_path_hash,
            comment_id,
            outcome,
            orig_line = orig_line.map(|n| n as u64),
            orig_end = orig_end.map(|n| n as u64),
            matched_line,
            matched_end = matched_end.map(|n| n as u64),
            re_derived,
        );
    } else if crate::startup_recorder::ipc_trace_enabled() {
        tracing::info!(
            target: "matching",
            cmd,
            file = file_path_hash,
            comment_id,
            outcome,
            orig_line = orig_line.map(|n| n as u64),
            orig_end = orig_end.map(|n| n as u64),
            matched_line,
            matched_end = matched_end.map(|n| n as u64),
            re_derived,
        );
    }
}

struct FuzzyMatch {
    line: u32,
    anchored_text: String,
}

fn find_fuzzy_match(
    file_lines: &[&str],
    selected_text: &str,
    center_line: u32,
) -> Option<FuzzyMatch> {
    let mut best_line: Option<u32> = None;
    let mut best_score: f64 = 0.0;
    let mut best_text = String::new();

    for (i, file_line) in file_lines.iter().enumerate() {
        let score = fuzzy_score(selected_text, file_line);
        if score >= FUZZY_THRESHOLD && score > best_score {
            best_score = score;
            best_line = Some((i as u32) + 1);
            best_text = file_line.to_string();
        } else if score >= FUZZY_THRESHOLD
            && (score - best_score).abs() < f64::EPSILON
            && best_line.is_some()
        {
            let center_idx = (center_line as i64) - 1;
            let new_dist = ((i as i64) - center_idx).unsigned_abs();
            let old_dist = ((best_line.unwrap() as i64 - 1) - center_idx).unsigned_abs();
            if new_dist < old_dist {
                best_line = Some((i as u32) + 1);
                best_text = file_line.to_string();
            }
        }
    }

    best_line.map(|line| FuzzyMatch {
        line,
        anchored_text: best_text,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_comment(id: &str, line: Option<u32>, selected_text: Option<&str>) -> MrsfComment {
        MrsfComment {
            id: id.to_string(),
            author: "test".to_string(),
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            text: "comment text".to_string(),
            resolved: false,
            line,
            end_line: None,
            start_column: None,
            end_column: None,
            selected_text: selected_text.map(|s| s.to_string()),
            anchored_text: None,
            selected_text_hash: None,
            commit: None,
            comment_type: None,
            severity: None,
            reply_to: None,
            ..Default::default()
        }
    }

    #[test]
    fn exact_match_at_original_line() {
        let comments = vec![make_comment("c1", Some(2), Some("hello world"))];
        let lines = vec!["first line", "hello world here", "third line"];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].matched_line_number, 2);
        assert!(!result[0].is_orphaned);
    }

    #[test]
    fn exact_match_elsewhere() {
        let comments = vec![make_comment("c1", Some(1), Some("hello world"))];
        let lines = vec!["first line", "second line", "hello world here"];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].matched_line_number, 3);
        assert!(!result[0].is_orphaned);
        assert_eq!(result[0].comment.line, Some(3));
        // AC5: the matcher captures the pre-rewrite line so the UI can
        // surface "originally line X → re-anchored to Y".
        assert_eq!(result[0].original_line, Some(1));
    }

    #[test]
    fn line_fallback_no_selected_text() {
        let comments = vec![make_comment("c1", Some(2), None)];
        let lines = vec!["first", "second", "third"];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].matched_line_number, 2);
        assert!(!result[0].is_orphaned);
    }

    #[test]
    fn fuzzy_match_above_threshold() {
        let comments = vec![make_comment("c1", Some(1), Some("hello warld"))];
        let lines = vec!["first line", "hello world", "third line"];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].matched_line_number, 2);
        assert!(!result[0].is_orphaned);
        assert!(result[0].anchored_text.is_some());
        assert_eq!(result[0].anchored_text.as_deref(), Some("hello world"));
    }

    #[test]
    fn fuzzy_match_below_threshold_orphan() {
        let comments = vec![make_comment(
            "c1",
            Some(1),
            Some("completely different text xyz"),
        )];
        let lines = vec!["aaa", "bbb", "ccc"];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result.len(), 1);
        assert!(result[0].is_orphaned);
        assert_eq!(result[0].matched_line_number, 1);
    }

    #[test]
    fn empty_file_orphans_all() {
        let comments = vec![
            make_comment("c1", Some(5), Some("something")),
            make_comment("c2", None, None),
        ];
        let lines: Vec<&str> = vec![];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result.len(), 2);
        assert!(result[0].is_orphaned);
        assert_eq!(result[0].matched_line_number, 1);
        assert!(result[1].is_orphaned);
        assert_eq!(result[1].matched_line_number, 1);
    }

    #[test]
    fn empty_comments_returns_empty() {
        let comments: Vec<MrsfComment> = vec![];
        let lines = vec!["line one", "line two"];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert!(result.is_empty());
    }

    #[test]
    fn case_insensitive_fuzzy() {
        // "Hello World" vs "hello world" → exact match after lowering → score 1.0
        // But "Hello World" is selected_text, and file has "HELLO WORLD" on line 2.
        // Exact substring match is case-sensitive, so it won't match at step 1.
        // Fuzzy score("Hello World", "HELLO WORLD") → 1.0 after lowering → matches.
        let comments = vec![make_comment("c1", Some(1), Some("Hello World"))];
        let lines = vec!["first line", "HELLO WORLD", "third line"];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].matched_line_number, 2);
        assert!(!result[0].is_orphaned);
        assert!(result[0].anchored_text.is_some());
    }

    #[test]
    fn prefer_closest_line_on_equal_score() {
        // Use texts that are NOT substring matches but get equal Levenshtein scores.
        // fuzzy_score("abcdef", "abcXef"): lev distance = 1, max_len = 6, score = 5/6 ≈ 0.833
        // fuzzy_score("abcdef", "abcYef"): same score = 0.833
        // Line 1 (idx 0) dist from center 3 = |0 - 2| = 2
        // Line 4 (idx 3) dist from center 3 = |3 - 2| = 1 → closer, should win
        let comments = vec![make_comment("c1", Some(3), Some("abcdef"))];
        let lines = vec!["abcXef", "something", "else", "abcYef"];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].matched_line_number, 4);
        assert!(!result[0].is_orphaned);
    }

    #[test]
    fn orphan_fallback_line_clamped() {
        let comments = vec![make_comment("c1", Some(100), None)];
        let lines = vec!["only", "three", "lines"];
        // line 100 > line_count 3, so step 2 doesn't apply → step 4 orphan
        // fallback_line = min(100, 3) = 3
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result.len(), 1);
        assert!(result[0].is_orphaned);
        assert_eq!(result[0].matched_line_number, 3);
    }

    #[test]
    fn file_level_comment_never_orphaned() {
        // File-level comments (no line, no selected_text) should never show
        // the orphan warning — they are anchored to the file itself (#131).
        let comments = vec![make_comment("c1", None, None)];
        let lines = vec!["some content", "more content"];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result.len(), 1);
        assert!(!result[0].is_orphaned);
        assert_eq!(result[0].matched_line_number, 1);
    }

    // --- Tests for levenshtein and fuzzy_score live in core::fuzzy ---

    #[test]
    fn multiple_exact_matches_picks_closest_to_original_line() {
        // "hello" appears on lines 1, 3, 5. Original line is 4 → pick line 3 (closest).
        let comments = vec![make_comment("c1", Some(4), Some("hello"))];
        let lines = vec![
            "hello world",
            "other stuff",
            "hello there",
            "something",
            "hello again",
        ];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].matched_line_number, 3);
        assert!(!result[0].is_orphaned);
    }

    #[test]
    fn multiple_exact_matches_no_line_hint_picks_first() {
        // "hello" appears on lines 2, 4. No line hint → picks first (line 2).
        let comments = vec![make_comment("c1", None, Some("hello"))];
        let lines = vec!["other", "hello world", "stuff", "hello there"];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].matched_line_number, 2);
        assert!(!result[0].is_orphaned);
    }

    #[test]
    fn plausibility_check_skips_unrelated_line() {
        // selected_text is "hello world", original line 2 now has "completely different".
        // Plausibility check should fail → goes to fuzzy → finds "hello warld" on line 3.
        let comments = vec![make_comment("c1", Some(2), Some("hello world"))];
        let lines = vec!["first", "completely different content here", "hello warld"];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result.len(), 1);
        // Should find fuzzy match on line 3, NOT fall back to unrelated line 2
        assert_eq!(result[0].matched_line_number, 3);
        assert!(!result[0].is_orphaned);
        assert!(result[0].anchored_text.is_some());
    }

    #[test]
    fn plausibility_check_accepts_similar_line() {
        // selected_text is "hello world", original line 2 has "hello World!" (plausible).
        // Should anchor at line 2 with anchored_text.
        let comments = vec![make_comment("c1", Some(2), Some("hello world"))];
        let lines = vec!["first", "hello World!", "third"];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].matched_line_number, 2);
        assert!(!result[0].is_orphaned);
        assert_eq!(result[0].anchored_text.as_deref(), Some("hello World!"));
    }
}
