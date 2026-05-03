use crate::core::fuzzy::fuzzy_score;
use crate::core::md_strip::strip_md_inline;
use crate::core::multiline_match::{find_match, MultilineMatch};
use crate::core::projection::RenderedProjection;
use crate::core::types::{MatchedComment, MrsfComment};
use sha2::{Digest, Sha256};

const FUZZY_THRESHOLD: f64 = 0.6;

/// Match comments to file lines using the re-anchoring algorithm.
///
/// For each comment:
/// 1. Exact `selected_text` substring match (original line first, then full scan)
///    — when multiple matches exist, pick closest to original line (MRSF §7.2)
/// 1b. Markdown-stripped substring match — recovers visual-mode selections
///    that span inline-formatting markers (`**bold**`, `[link](url)`, etc.)
///    where the rendered text the user selected is not literally present in
///    the source line. Same closest-to-original-line tiebreaker as 1.
/// 1c. Multi-line projection match — recovers cross-block / soft-wrap /
///    inline-HTML / smart-quote selections whose rendered text spans more
///    than one source line. Falls back to **best-prefix** retry (trim
///    trailing words from the selection until a prefix matches), so a
///    selection whose tail no longer exists still anchors at the line
///    where the surviving prefix begins. See `core::multiline_match`.
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

    // Lazy projection: only build when at least one comment carries
    // `selected_text` AND the file actually has lines. Cost is one
    // strip + normalize per source line, amortized across all
    // selection-bearing comments for this file.
    let needs_projection = line_count > 0
        && comments
            .iter()
            .any(|c| c.selected_text.as_deref().is_some_and(|s| !s.is_empty()));
    let projection: Option<RenderedProjection> = if needs_projection {
        Some(RenderedProjection::build(file_lines))
    } else {
        None
    };

    comments
        .iter()
        .map(|comment| {
            let orig_line = comment.line;
            let orig_end = comment.end_line;
            let selected_text = comment.selected_text.as_deref();

            // File-level comments have no line and no selected_text —
            // they are always anchored at line 1 and never orphaned (#131).
            // Synthetic file-level: not a re-anchor decision, no [matching] emit.
            // This branch must run BEFORE the line_count==0 early-return so a
            // legacy file-level comment on an empty file is not misclassified
            // as orphan (issue #280 forward-fix B).
            if orig_line.is_none() && selected_text.is_none() {
                return MatchedComment {
                    comment: comment.clone(),
                    matched_line_number: 1,
                    is_orphaned: false,
                    anchored_text: None,
                    original_line: None,
                };
            }

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
                // No matches found — try normalized (markdown-stripped) match
                // before falling through to step 2. This covers the common
                // visual-mode case where the user's selection spans an
                // inline-formatting marker (`**bold**`, `[link](url)`, etc.)
                // so the rendered text they selected is not literally present
                // on any line, but IS present on a line once the markers are
                // stripped to their rendered form. See `core::md_strip`.
                let stripped_matches: Vec<u32> = file_lines
                    .iter()
                    .enumerate()
                    .filter(|(_, line)| strip_md_inline(line).contains(sel))
                    .map(|(i, _)| (i as u32) + 1)
                    .collect();

                if stripped_matches.len() == 1 {
                    let new_line = stripped_matches[0];
                    let re_derived = new_line != orig_line.unwrap_or(0);
                    let outcome = if re_derived { "normalized-relocated" } else { "normalized-orig" };
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
                } else if stripped_matches.len() > 1 {
                    if let Some(ol) = orig_line {
                        let best = *stripped_matches
                            .iter()
                            .min_by_key(|&&m| (m as i64 - ol as i64).unsigned_abs())
                            .unwrap();
                        let re_derived = best != ol;
                        let outcome = if re_derived { "normalized-relocated" } else { "normalized-orig" };
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
                    let first = stripped_matches[0];
                    emit_match_event(
                        cmd, &comment.id, &file_hash, "normalized-ambiguous",
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
                // No normalized matches either — fall through to step 1c
            }

            // Step 1c: Multi-line projection match (full + best-prefix).
            //
            // Recovers selections that the per-line passes above can't
            // see: cross-block selections where `selected_text` carries
            // an internal `\n`, single rendered blocks whose source
            // soft-wraps over multiple lines, inline-HTML rendered text
            // (`<kbd>Ctrl</kbd>` → "Ctrl"), and Unicode/whitespace noise
            // (NBSP, smart quotes, en/em dashes).
            //
            // When the full `selected_text` no longer matches verbatim
            // (e.g. a trailing word was edited away), the best-prefix
            // tier inside `find_match` trims trailing words and retries
            // until a long-enough prefix matches; the comment anchors
            // at the source line where that prefix begins. See
            // `core::multiline_match` and the user-facing requirement:
            // "match the selection as completely as possible; when not
            // possible, reduce from the end."
            if let (Some(sel), Some(proj)) = (selected_text, projection.as_ref()) {
                if let Some(MultilineMatch {
                    line: matched_line,
                    is_prefix,
                    matched_text,
                }) = find_match(sel, proj, orig_line, orig_end)
                {
                    let outcome = if is_prefix {
                        "multiline-prefix"
                    } else if Some(matched_line) == orig_line {
                        "multiline-orig"
                    } else {
                        "multiline-relocated"
                    };
                    let re_derived = Some(matched_line) != orig_line;
                    emit_match_event(
                        cmd, &comment.id, &file_hash, outcome,
                        orig_line, orig_end, matched_line, orig_end, re_derived,
                    );
                    let mut c = comment.clone();
                    c.line = Some(matched_line);
                    return MatchedComment {
                        comment: c,
                        matched_line_number: matched_line,
                        is_orphaned: false,
                        anchored_text: Some(matched_text),
                        original_line: orig_line,
                    };
                }
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
    // `multiline-prefix` is intentionally NOT in the warn list: it's
    // the **expected** outcome after a normal edit removes the trailing
    // word(s) of a selection. Spamming WARN there would drown out the
    // genuine regressions (`exact-ambiguous`, `orphan`, `fuzzy`) the
    // log is meant to surface. It remains visible at INFO under the
    // `--trace` / `MDR_IPC_TRACE` gate (see observability schema).
    let warn_outcome = matches!(
        outcome,
        "exact-ambiguous" | "orphan" | "fuzzy" | "normalized-ambiguous"
    );
    let suppress_warn = cmd == "get_file_badges";

    // Pre-format Option fields as `<n|none>` strings so tracing always emits
    // the field (tracing skips Option=None on the wire). This matches the
    // schema documented in `docs/observability.md` `[matching]` and lets
    // grep/analyzer tooling rely on stable field-presence.
    let orig_line_s = orig_line.map_or_else(|| "none".to_string(), |n| n.to_string());
    let orig_end_s = orig_end.map_or_else(|| "none".to_string(), |n| n.to_string());
    let matched_end_s = matched_end.map_or_else(|| "none".to_string(), |n| n.to_string());

    if warn_outcome && !suppress_warn {
        tracing::warn!(
            target: "matching",
            cmd,
            file = file_path_hash,
            comment_id,
            outcome,
            orig_line = orig_line_s.as_str(),
            orig_end = orig_end_s.as_str(),
            matched_line,
            matched_end = matched_end_s.as_str(),
            re_derived,
            "[matching]"
        );
    } else if crate::startup_recorder::ipc_trace_enabled() {
        tracing::info!(
            target: "matching",
            cmd,
            file = file_path_hash,
            comment_id,
            outcome,
            orig_line = orig_line_s.as_str(),
            orig_end = orig_end_s.as_str(),
            matched_line,
            matched_end = matched_end_s.as_str(),
            re_derived,
            "[matching]"
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
        assert_eq!(result[0].original_line, Some(2));
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
        assert_eq!(result[0].original_line, Some(1));
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
        assert_eq!(result[0].original_line, Some(1));
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
        // Line-anchored comment on empty file → orphan, original_line preserved.
        assert!(result[0].is_orphaned);
        assert_eq!(result[0].matched_line_number, 1);
        assert_eq!(result[0].original_line, Some(5));
        // File-level synthetic case (issue #280 forward-fix B): the synthetic
        // file-level branch runs BEFORE the line_count==0 early-return, so
        // file-level comments on empty files stay anchored at line 1 and are
        // NOT orphaned (preserves the #131 file-level invariant).
        assert!(!result[1].is_orphaned);
        assert_eq!(result[1].matched_line_number, 1);
        assert_eq!(result[1].original_line, None);
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
        assert_eq!(result[0].original_line, Some(1));
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
        assert_eq!(result[0].original_line, Some(3));
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
        // original_line preserved even though fallback clamps to 3.
        assert_eq!(result[0].original_line, Some(100));
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
        assert_eq!(result[0].original_line, None);
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
        assert_eq!(result[0].original_line, Some(4));
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
        assert_eq!(result[0].original_line, None);
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
        assert_eq!(result[0].original_line, Some(2));
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
        assert_eq!(result[0].original_line, Some(2));
    }

    // --- Step 1b: visual-mode (rendered text) selection across markers ---

    #[test]
    fn visual_selection_across_bold_marker_matches() {
        // Source line has a bold marker; user selected the rendered text
        // in visual view, which doesn't contain the `**` markers.
        let comments = vec![make_comment("c1", Some(1), Some("Hello world here"))];
        let lines = vec!["Hello **world** here"];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].matched_line_number, 1);
        assert!(
            !result[0].is_orphaned,
            "selection across bold marker should not orphan"
        );
    }

    #[test]
    fn visual_selection_across_link_matches() {
        let comments = vec![make_comment("c1", Some(1), Some("Click here please"))];
        let lines = vec!["Click [here](https://example.com) please"];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result[0].matched_line_number, 1);
        assert!(!result[0].is_orphaned);
    }

    #[test]
    fn visual_selection_across_inline_code_matches() {
        let comments = vec![make_comment(
            "c1",
            Some(1),
            Some("Use cargo build --release now"),
        )];
        let lines = vec!["Use `cargo build --release` now"];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result[0].matched_line_number, 1);
        assert!(!result[0].is_orphaned);
    }

    #[test]
    fn visual_selection_across_strikethrough_matches() {
        let comments = vec![make_comment(
            "c1",
            Some(1),
            Some("This deprecated text"),
        )];
        let lines = vec!["This ~~deprecated~~ text"];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result[0].matched_line_number, 1);
        assert!(!result[0].is_orphaned);
    }

    #[test]
    fn visual_selection_across_combined_inline_formats_matches() {
        // Mirrors line 32 of samples/markdown/01-gfm-basics.md.
        let comments = vec![make_comment(
            "c1",
            Some(1),
            Some("fast Vec<u8> allocation must not reallocate"),
        )];
        let lines = vec![
            "A line that mixes them: a *fast* `Vec<u8>` allocation **must not** ~~reallocate~~.",
        ];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result[0].matched_line_number, 1);
        assert!(!result[0].is_orphaned);
    }

    #[test]
    fn visual_selection_picks_closest_line_when_multiple_strip_to_same_text() {
        // Both line 1 and line 5 strip to "shared text"; the comment was
        // originally on line 4, so it should re-anchor to line 5 (closest).
        let comments = vec![make_comment("c1", Some(4), Some("shared text"))];
        let lines = vec![
            "**shared** text",
            "filler one",
            "filler two",
            "filler three",
            "*shared* text",
        ];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result[0].matched_line_number, 5);
        assert!(!result[0].is_orphaned);
        assert_eq!(result[0].original_line, Some(4));
    }

    #[test]
    fn visual_selection_no_marker_on_line_falls_through_to_other_steps() {
        // No inline markers anywhere → step 1b matches the same lines as
        // step 1, so step 1 succeeds first and step 1b doesn't fire. This
        // is just a sanity check that the new step is non-disruptive.
        let comments = vec![make_comment("c1", Some(2), Some("plain text"))];
        let lines = vec!["first line", "plain text here", "third line"];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result[0].matched_line_number, 2);
        assert!(!result[0].is_orphaned);
    }

    // ── Step 1c: multi-line projection match + best-prefix fallback ──
    //
    // These tests cover the user-facing scenarios that motivated the
    // step 1c addition: cross-block selections, soft-wrapped paragraph
    // selections, inline-HTML selections, smart-quote normalization,
    // and best-prefix recovery when the selection's tail is gone.

    #[test]
    fn cross_block_selection_into_following_paragraph_matches_at_start() {
        // User selects from a heading INTO the following paragraph.
        // selected_text contains '\n'. Steps 1 and 1b never match (per
        // line). Step 1c projection joins the heading + paragraph and
        // matches; comment anchors at the heading's source line.
        let comments = vec![make_comment(
            "c1",
            Some(1),
            Some("Heading\nThis is the first paragraph"),
        )];
        let lines = vec![
            "# Heading",
            "",
            "This is the first paragraph after.",
        ];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result[0].matched_line_number, 1);
        assert!(!result[0].is_orphaned);
    }

    #[test]
    fn soft_wrapped_paragraph_selection_anchors_at_start_line() {
        // Source has a soft-wrapped paragraph; the selection in the
        // rendered view crosses the source-line boundary.
        let comments = vec![make_comment(
            "c1",
            Some(1),
            Some("paragraph that spans two"),
        )];
        let lines = vec!["This is a long paragraph that", "spans two lines here."];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result[0].matched_line_number, 1);
        assert!(!result[0].is_orphaned);
    }

    #[test]
    fn inline_html_kbd_selection_matches_via_projection() {
        // Source uses <kbd>; rendered selection is "Press Ctrl+K now".
        // Step 1b doesn't help because <kbd> isn't markdown markers it
        // strips, but step 1c uses the extended HTML stripper.
        let comments = vec![make_comment(
            "c1",
            Some(1),
            Some("Press Ctrl+K now"),
        )];
        let lines = vec!["Press <kbd>Ctrl</kbd>+<kbd>K</kbd> now"];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result[0].matched_line_number, 1);
        assert!(!result[0].is_orphaned);
    }

    #[test]
    fn nbsp_in_source_matches_ascii_space_selection() {
        // Source has NBSP between "alpha" and "beta"; rendered selection
        // captures ASCII space. Step 1 fails (literal substring), step
        // 1c normalizes both sides to ASCII space.
        let comments = vec![make_comment("c1", Some(1), Some("alpha beta charlie"))];
        let lines = vec!["alpha\u{00A0}beta charlie ends here."];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result[0].matched_line_number, 1);
        assert!(!result[0].is_orphaned);
    }

    #[test]
    fn smart_quotes_in_source_match_ascii_quote_selection() {
        // Source has \u{2019} (curly right single quote); rendered
        // selection has ASCII apostrophe.
        let comments = vec![make_comment("c1", Some(1), Some("it's a working day"))];
        let lines = vec!["See: it\u{2019}s a working day, indeed."];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result[0].matched_line_number, 1);
        assert!(!result[0].is_orphaned);
    }

    #[test]
    fn best_prefix_recovers_when_trailing_word_edited_away() {
        // Selection was "alpha beta gamma delta epsilon" but the source
        // no longer contains "epsilon" (last word was edited out).
        // Step 1c's best-prefix tier trims trailing words and finds
        // "alpha beta gamma delta" → anchors at line 1.
        let comments = vec![make_comment(
            "c1",
            Some(1),
            Some("alpha beta gamma delta epsilon"),
        )];
        let lines = vec![
            "filler one",
            "alpha beta gamma delta is here.",
            "filler two",
        ];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result[0].matched_line_number, 2);
        assert!(!result[0].is_orphaned);
        // The matched anchored_text is the recovered prefix.
        let matched = result[0].anchored_text.as_deref().unwrap();
        assert!(
            matched.starts_with("alpha beta gamma delta"),
            "expected prefix recovery, got: {matched:?}"
        );
    }

    #[test]
    fn best_prefix_does_not_match_too_short_a_phrase() {
        // Selection "the foo bar" → only "the" survives; below the
        // 12-char / 2-word floor → step 1c gives up and downstream
        // tiers (fuzzy / orphan) take over.
        let comments = vec![make_comment("c1", Some(1), Some("the foo bar"))];
        let lines = vec!["completely unrelated text only"];
        let result = match_comments(&comments, &lines, "/test", "test");
        // Without a recoverable prefix, this orphans.
        assert!(result[0].is_orphaned);
    }

    #[test]
    fn projection_match_picks_closest_line_among_duplicates() {
        // Both line 1 and line 5 (after stripping) project to a span
        // containing "shared phrase". Original line is 4 → line 5
        // wins (closest-to-original tie-break in multiline_match).
        let comments = vec![make_comment("c1", Some(4), Some("shared phrase"))];
        let lines = vec![
            "**shared** phrase early",
            "filler",
            "filler",
            "filler",
            "_shared_ phrase late",
        ];
        let result = match_comments(&comments, &lines, "/test", "test");
        // Step 1b's per-line stripped match also fires here (each line
        // strips to "shared phrase early/late"), so it could resolve
        // first. Either step 1b or step 1c lands at line 5; assert the
        // user-visible behaviour, not which step resolved it.
        assert_eq!(result[0].matched_line_number, 5);
        assert!(!result[0].is_orphaned);
    }

    #[test]
    fn projection_handles_combined_inline_formats_across_lines() {
        // Two-source-line paragraph mixing every inline format.
        // Mirrors `samples/markdown/01-gfm-basics.md:32` style.
        let comments = vec![make_comment(
            "c1",
            Some(1),
            Some("a fast Vec<u8> allocation must not reallocate."),
        )];
        let lines = vec![
            "A line that mixes them: a *fast* `Vec<u8>` allocation",
            "**must not** ~~reallocate~~.",
        ];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result[0].matched_line_number, 1);
        assert!(!result[0].is_orphaned);
    }

    #[test]
    fn projection_match_for_table_cell_with_br() {
        // Table cell with `<br>` rendering as a space. Selection
        // captures "line one line two" from the rendered cell.
        let comments = vec![make_comment(
            "c1",
            Some(1),
            Some("line one line two"),
        )];
        let lines = vec!["| line one<br>line two | second |"];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result[0].matched_line_number, 1);
        assert!(!result[0].is_orphaned);
    }

    #[test]
    fn projection_match_for_blockquote_with_inline_link() {
        // Mirrors `samples/markdown/01-gfm-basics.md:70` style: a
        // blockquote with bold + inline code + link. Selection picks
        // the rendered text only.
        let comments = vec![make_comment(
            "c1",
            Some(1),
            Some("longer blockquote with emphasis, inline code, and a link."),
        )];
        let lines =
            vec!["> A longer blockquote with **emphasis**, `inline code`, and a [link](https://example.com)."];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result[0].matched_line_number, 1);
        assert!(!result[0].is_orphaned);
    }

    #[test]
    fn projection_unused_when_no_selection_text_present() {
        // Optimisation contract: file with comments but none carry
        // selected_text → projection is not built. Behaviour must be
        // unchanged from pre-step-1c.
        let comments = vec![make_comment("c1", Some(2), None)];
        let lines = vec!["alpha", "beta", "gamma"];
        let result = match_comments(&comments, &lines, "/test", "test");
        assert_eq!(result[0].matched_line_number, 2);
        assert!(!result[0].is_orphaned);
    }
}
