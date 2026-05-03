//! Multi-line selection matcher with **best-prefix** fallback.
//!
//! Given a `RenderedProjection` of a file and a `selected_text` query
//! captured from `window.getSelection().toString()`, find the source
//! line a comment should anchor to.
//!
//! ## Algorithm
//!
//! 1. **Full match** — normalize the query and search for it as a
//!    substring in the projection. If found, anchor at the source line
//!    containing the start of the match. If multiple matches exist,
//!    pick the one closest to the comment's original `[line, end_line]`
//!    span, then by smallest offset (deterministic tie-break).
//!
//! 2. **Best-prefix match** — if the full query doesn't match, trim
//!    trailing characters at word boundaries and retry. Continue until
//!    a prefix matches OR the prefix shrinks below a minimum length
//!    (12 chars or 2 words). The first successful prefix wins, so the
//!    LONGEST recoverable prefix is the one that anchors.
//!
//! This satisfies the user's stated requirement: "match the selected
//! text as completely as possible; when not possible, reduce the
//! selection from the end and try to match the beginning."
//!
//! ## Determinism
//!
//! All tie-breaks are total orderings, so two runs over the same input
//! always produce the same output. No randomization, no iteration-
//! order dependence beyond `str::find`'s stable left-to-right scan.

use crate::core::normalize::normalize_lossy;
use crate::core::projection::RenderedProjection;

/// Minimum prefix length (in chars) that the best-prefix retry will
/// accept. Below this, we'd risk anchoring on a common phrase like
/// "the" or "click". Calibrated for English prose; tighter than the
/// fuzzy step's existing 0.6 threshold.
///
/// Lowered from 12 to 8 so 10-char rendered headings like
/// `H1 Heading` (after block-prefix strip removes `# `) survive the
/// best-prefix gate. The closest-to-orig-line tie-break still picks
/// the right instance when the same phrase repeats.
const MIN_PREFIX_CHARS: usize = 8;

/// Minimum word count that a prefix must retain before it can match.
/// Whitespace queries (English prose) keep this floor to avoid
/// noisy single-word anchors. Whitespace-free queries (CJK, single
/// long token) bypass the word floor and use a char-level retry
/// instead — see `best_prefix_chars`.
const MIN_PREFIX_WORDS: usize = 2;

// NOTE: there is no per-call cap on prefix attempts or candidate
// matches. The user requirement is "match as much as possible; reduce
// from end if not"; capping iteration would under-deliver on long
// selections (>16 trims to recover the surviving prefix) and on
// repetitive documents (>64 occurrences where the closest one to
// `[orig_line, end_line]` sits past the first batch). The
// `MIN_PREFIX_CHARS` floor naturally bounds prefix iteration; substring
// search bounds candidate enumeration to `projection.len() /
// needle.len()` matches. See rubber-duck critique iter 2 of issue #341.

/// Result of a multi-line match attempt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MultilineMatch {
    /// 1-based source line where the match begins (the line a comment
    /// should anchor to).
    pub line: u32,
    /// Whether this was a full match (`false`) or a best-prefix
    /// recovery (`true`). Surfaces via the `[matching]` log outcome.
    pub is_prefix: bool,
    /// The query that actually matched — useful for logging the
    /// recovered prefix length and for the matched_text field on
    /// `MatchedComment`.
    pub matched_text: String,
}

/// Search for `query` in the projection. Returns the best-anchoring
/// match according to the algorithm in the module docstring, or `None`
/// if no acceptable match (full or prefix) was found.
///
/// `orig_line` and `orig_end_line` are used as a soft preference when
/// multiple matches exist — the closest one to the original span wins.
/// `None` for either disables that preference (first match wins).
pub fn find_match(
    query: &str,
    projection: &RenderedProjection,
    orig_line: Option<u32>,
    orig_end_line: Option<u32>,
) -> Option<MultilineMatch> {
    if projection.text.is_empty() {
        return None;
    }

    let normalized = normalize_lossy(query);
    if normalized.is_empty() {
        return None;
    }

    // Tier 1: full-query match.
    if let Some(line) = best_match_line(&normalized, projection, orig_line, orig_end_line) {
        return Some(MultilineMatch {
            line,
            is_prefix: false,
            matched_text: normalized,
        });
    }

    // Tier 2a: word-boundary best-prefix retry. Iterate longest →
    // shortest along whitespace boundaries until a prefix matches or
    // the prefix is too short.
    for prefix in best_prefix_candidates(&normalized) {
        if let Some(line) = best_match_line(prefix, projection, orig_line, orig_end_line) {
            return Some(MultilineMatch {
                line,
                is_prefix: true,
                matched_text: prefix.to_string(),
            });
        }
    }

    // Tier 2b: char-boundary best-prefix retry — only fires when the
    // query has fewer whitespace-separated words than `MIN_PREFIX_WORDS`,
    // i.e. CJK / Thai / unbroken URL-like text where the word floor
    // would yield zero candidates. Trims one char at a time from the
    // tail; same `MIN_PREFIX_CHARS` floor applies.
    //
    // Cost: at most `query.chars().count() - MIN_PREFIX_CHARS` retries.
    // For typical CJK selections (≤ MRSF §6.2 4 KB cap) this caps at a
    // few thousand iterations of `str::find` — still well below the
    // matcher's overall budget.
    if word_count(&normalized) < MIN_PREFIX_WORDS {
        for prefix in best_prefix_chars(&normalized) {
            if let Some(line) = best_match_line(prefix, projection, orig_line, orig_end_line) {
                return Some(MultilineMatch {
                    line,
                    is_prefix: true,
                    matched_text: prefix.to_string(),
                });
            }
        }
    }

    None
}

/// Search the projection for `needle` and return the **1-based source
/// line** of the best match (closest to the `[orig_line, orig_end_line]`
/// span; left-most offset on tie).
///
/// Returns `None` when `needle` does not appear in the projection.
fn best_match_line(
    needle: &str,
    projection: &RenderedProjection,
    orig_line: Option<u32>,
    orig_end_line: Option<u32>,
) -> Option<u32> {
    if needle.is_empty() {
        return None;
    }

    // Collect ALL match offsets. For a needle of length `n`, the
    // total number of non-overlapping matches is bounded by
    // `projection.len() / n`, so worst-case enumeration cost is
    // O(projection_size). No per-call cap — the user requirement
    // ("match as much as possible") is incompatible with truncating
    // the candidate set before the closest-to-original tie-break runs.
    let mut candidates: Vec<usize> = Vec::new();
    let mut search_from = 0usize;
    while let Some(rel) = projection.text[search_from..].find(needle) {
        let abs = search_from + rel;
        candidates.push(abs);
        // Advance by at least one byte to avoid infinite loop on
        // empty needle (defensive — we already returned for empty).
        search_from = abs + needle.len().max(1);
        if search_from >= projection.text.len() {
            break;
        }
    }
    if candidates.is_empty() {
        return None;
    }

    let lines: Vec<u32> = candidates
        .iter()
        .map(|&o| projection.line_for_offset(o))
        .collect();

    // Tie-break:
    //   1. distance to original span (smaller is better)
    //   2. smaller offset (left-most)
    let orig_lo = orig_line.unwrap_or(1);
    let orig_hi = orig_end_line.unwrap_or(orig_lo);

    let mut best_idx = 0usize;
    let mut best_dist = span_distance(lines[0], orig_lo, orig_hi);
    for (i, &line) in lines.iter().enumerate().skip(1) {
        let d = span_distance(line, orig_lo, orig_hi);
        if d < best_dist || (d == best_dist && candidates[i] < candidates[best_idx]) {
            best_idx = i;
            best_dist = d;
        }
    }
    Some(lines[best_idx])
}

/// Distance between a candidate line and the original `[lo, hi]` span.
/// Zero if the candidate is inside the span.
#[inline]
fn span_distance(line: u32, lo: u32, hi: u32) -> u32 {
    if line < lo {
        lo - line
    } else if line > hi {
        line - hi
    } else {
        0
    }
}

/// Iterator over progressively shorter prefixes of `query`, each cut at
/// a **word boundary** (whitespace gap), going longest → shortest.
/// Stops once the prefix would fall below `MIN_PREFIX_CHARS` or
/// `MIN_PREFIX_WORDS`. No explicit attempt cap — the floor naturally
/// bounds iteration to `≤ word_count(query)` trials, which is itself
/// bounded by `selected_text` length (≤ 4096 chars per MRSF §6.2).
fn best_prefix_candidates(query: &str) -> impl Iterator<Item = &str> {
    // Pre-compute end-of-word byte positions, longest first. Word
    // boundaries are simply gaps where whitespace begins. The full
    // query is NOT yielded here — find_match has already tried it.
    let mut cuts: Vec<usize> = Vec::new();
    let bytes = query.as_bytes();

    // Walk back from the end of `query`, skipping the trailing word
    // each iteration. A "word" is a maximal run of non-whitespace.
    let mut i = bytes.len();
    while i > 0 {
        // Skip trailing whitespace at this offset.
        while i > 0 && bytes[i - 1] == b' ' {
            i -= 1;
        }
        // i now sits AT the end of a non-whitespace run; record it as
        // a potential cut and then back up over the run.
        if i > 0 {
            cuts.push(i);
        }
        while i > 0 && bytes[i - 1] != b' ' {
            i -= 1;
        }
    }

    // The first cut is the full string with trailing whitespace
    // already trimmed. Skip it: callers already tried the full query.
    // Subsequent cuts are progressively shorter prefixes; iteration
    // terminates when we drop below the MIN_PREFIX_CHARS / WORDS gate.
    cuts.into_iter()
        .skip(1)
        .filter_map(move |end| {
            // Trim trailing whitespace inside the prefix too.
            let mut e = end;
            while e > 0 && query.as_bytes()[e - 1] == b' ' {
                e -= 1;
            }
            if e == 0 {
                return None;
            }
            let prefix = &query[..e];
            if prefix.chars().count() < MIN_PREFIX_CHARS {
                return None;
            }
            if word_count(prefix) < MIN_PREFIX_WORDS {
                return None;
            }
            Some(prefix)
        })
}

/// Iterator over progressively shorter char-level prefixes of `query`,
/// going longest → shortest. Trims one **char** (not byte, not word)
/// at a time from the end. Stops once the prefix would fall below
/// `MIN_PREFIX_CHARS`. The full query is NOT yielded — callers
/// already tried it.
///
/// Used for whitespace-free queries (CJK, single long token) where
/// `best_prefix_candidates` would yield zero candidates and the
/// "match as much as possible, reduce from the end" contract would
/// otherwise be unreachable.
fn best_prefix_chars(query: &str) -> impl Iterator<Item = &str> + '_ {
    // Pre-compute char-end byte offsets so we can slice without
    // re-scanning the string for each shortening. `char_indices`
    // yields (byte_offset, char) for each char start; we want the
    // boundaries AFTER each char (i.e. the start of the NEXT char,
    // or `query.len()` for the last). Skip the full-length boundary
    // because the full query was already tried.
    let mut boundaries: Vec<usize> = query
        .char_indices()
        .map(|(i, _)| i)
        .collect();
    // Discard the 0 entry; we want positions ≥ 1 (each is the byte
    // offset where the char ENDS / next char starts). Keep them in
    // order of increasing length so we can iterate longest → shortest
    // by reverse-walking.
    boundaries.remove(0); // remove offset 0 (empty prefix)
    boundaries.push(query.len()); // add the full-length boundary so
                                   // "everything except last char" is yielded first

    boundaries
        .into_iter()
        .rev()
        // Skip the full length — caller already tried it.
        .skip(1)
        .filter_map(move |end| {
            let prefix = &query[..end];
            if prefix.chars().count() < MIN_PREFIX_CHARS {
                return None;
            }
            // Don't trim mid-whitespace — if the trimmed prefix ends
            // in whitespace, peel it back to the previous non-space
            // boundary so we don't anchor on a trailing run of
            // spaces (cosmetic; matches `best_prefix_candidates`).
            let trimmed = prefix.trim_end();
            if trimmed.is_empty() || trimmed.chars().count() < MIN_PREFIX_CHARS {
                return None;
            }
            Some(trimmed)
        })
}

/// Count whitespace-separated words in `s` (cheap; not Unicode-aware
/// because `MIN_PREFIX_WORDS` is a coarse safety net, not a linguistic
/// measurement).
fn word_count(s: &str) -> usize {
    s.split_whitespace().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proj(lines: &[&str]) -> RenderedProjection {
        RenderedProjection::build(lines)
    }

    #[test]
    fn full_match_in_single_line_returns_that_line() {
        let p = proj(&["first line", "hello world here", "third line"]);
        let m = find_match("hello world", &p, Some(2), Some(2)).unwrap();
        assert_eq!(m.line, 2);
        assert!(!m.is_prefix);
    }

    #[test]
    fn full_match_across_soft_wrap_anchors_at_start_line() {
        // Selection "paragraph that spans two" crosses source-line 1→2.
        let p = proj(&["This is a paragraph that", "spans two lines."]);
        let m = find_match("paragraph that spans two", &p, Some(1), Some(1)).unwrap();
        assert_eq!(m.line, 1);
        assert!(!m.is_prefix);
    }

    #[test]
    fn full_match_strips_inline_html_in_source() {
        // Source has <kbd>; selection has rendered text "Ctrl+K".
        let p = proj(&["Press <kbd>Ctrl</kbd>+<kbd>K</kbd> now"]);
        let m = find_match("Press Ctrl+K now", &p, Some(1), Some(1)).unwrap();
        assert_eq!(m.line, 1);
    }

    #[test]
    fn cross_block_match_via_newline_boundary() {
        // User selects from a heading into the following paragraph;
        // `getSelection().toString()` returns the RENDERED text (no
        // `#` marker) joined by `\n`. After lossy normalization, the
        // `\n` becomes ` ` — and the projection's block-prefix strip
        // already dropped the `#` marker — so the cross-block
        // selection matches the projection's flat rendered text.
        let p = proj(&[
            "# Heading",
            "",
            "Paragraph with content.",
        ]);
        // Projection: "Heading Paragraph with content."
        let m = find_match("Heading\nParagraph with content.", &p, Some(1), Some(3)).unwrap();
        // The match starts at line 1.
        assert_eq!(m.line, 1);
    }

    #[test]
    fn best_prefix_retry_when_trailing_word_gone() {
        // Selection was originally "alpha beta gamma delta". Source no
        // longer contains "delta" — best-prefix should match "alpha
        // beta gamma" and anchor at line 1.
        let p = proj(&["alpha beta gamma is here"]);
        let m = find_match("alpha beta gamma delta", &p, Some(1), Some(1)).unwrap();
        assert_eq!(m.line, 1);
        assert!(m.is_prefix);
        assert!(m.matched_text.starts_with("alpha beta gamma"));
    }

    #[test]
    fn best_prefix_skipped_when_below_min_length() {
        // Source has "hi" but the prefix would need 12+ chars to
        // anchor.
        let p = proj(&["hi there"]);
        let result = find_match("hi xx yy zz", &p, Some(1), Some(1));
        // Best-prefix candidates would all be too short. Without a
        // recoverable prefix, we return None.
        assert!(result.is_none());
    }

    #[test]
    fn deterministic_tiebreak_picks_closest_to_orig_span() {
        // "shared phrase here" appears on lines 1 and 5. Original span
        // is line 4 → line 5 wins.
        let p = proj(&[
            "shared phrase here today",
            "filler",
            "filler",
            "filler",
            "shared phrase here too",
        ]);
        let m = find_match("shared phrase here", &p, Some(4), Some(4)).unwrap();
        assert_eq!(m.line, 5);
    }

    #[test]
    fn deterministic_tiebreak_picks_left_most_when_equidistant() {
        // "common" appears on lines 1 and 3; original is line 2 →
        // both equidistant; left-most (line 1) wins.
        let p = proj(&["common one", "filler", "common two"]);
        let m = find_match("common", &p, Some(2), Some(2)).unwrap();
        assert_eq!(m.line, 1);
    }

    #[test]
    fn no_match_returns_none() {
        let p = proj(&["alpha", "beta", "gamma"]);
        let m = find_match("absolutely not there", &p, Some(1), Some(1));
        assert!(m.is_none());
    }

    #[test]
    fn empty_query_returns_none() {
        let p = proj(&["anything"]);
        let m = find_match("", &p, Some(1), Some(1));
        assert!(m.is_none());
    }

    #[test]
    fn empty_projection_returns_none() {
        let p = proj(&[]);
        let m = find_match("anything", &p, Some(1), Some(1));
        assert!(m.is_none());
    }

    #[test]
    fn whitespace_only_query_returns_none() {
        let p = proj(&["anything"]);
        let m = find_match("   \t\n  ", &p, Some(1), Some(1));
        assert!(m.is_none());
    }

    #[test]
    fn nbsp_in_source_matches_ascii_space_query() {
        // Source has NBSP; rendered selection has ASCII space.
        let p = proj(&["alpha\u{00A0}beta charlie"]);
        let m = find_match("alpha beta charlie", &p, Some(1), Some(1)).unwrap();
        assert_eq!(m.line, 1);
    }

    #[test]
    fn smart_quotes_in_source_match_ascii_quote_query() {
        // Source has \u{2019} (right single quote); query has ASCII '.
        let p = proj(&["it\u{2019}s working today"]);
        let m = find_match("it's working today", &p, Some(1), Some(1)).unwrap();
        assert_eq!(m.line, 1);
    }

    #[test]
    fn best_prefix_candidates_drops_trailing_words_in_order() {
        let cuts: Vec<&str> = best_prefix_candidates("alpha beta gamma delta epsilon").collect();
        // Full string is skipped. Prefixes go longest → shortest.
        // After lowering MIN_PREFIX_CHARS to 8:
        // "alpha beta gamma delta" → 22 chars / 4 words → ok
        // "alpha beta gamma"       → 16 chars / 3 words → ok
        // "alpha beta"             → 10 chars / 2 words → ok (≥ 8 chars)
        // "alpha"                  → 5 chars / 1 word   → BELOW 8 chars + 2 words → dropped
        assert_eq!(cuts, vec!["alpha beta gamma delta", "alpha beta gamma", "alpha beta"]);
    }

    #[test]
    fn best_prefix_chars_iterates_longest_to_shortest() {
        // No-whitespace query with 12 chars; MIN_PREFIX_CHARS = 8.
        // Expect prefixes of 11, 10, 9, 8 chars, in order.
        let cuts: Vec<&str> = best_prefix_chars("ABCDEFGHIJKL").collect();
        assert_eq!(cuts.len(), 4, "got {cuts:?}");
        assert_eq!(cuts[0], "ABCDEFGHIJK");
        assert_eq!(cuts[3], "ABCDEFGH");
    }

    #[test]
    fn cjk_no_whitespace_query_recovers_via_char_level_prefix() {
        // 12 CJK chars; trim trailing 2 → 10 char prefix matches.
        let p = proj(&["你好世界这是一段测试文字。"]);
        let m = find_match("你好世界这是一段测试文字含杂尾", &p, Some(1), Some(1)).unwrap();
        assert!(m.is_prefix);
        assert_eq!(m.line, 1);
        // Recovered prefix should be the leading 12 CJK chars.
        assert!(m.matched_text.starts_with("你好世界这是一段测试文字"));
    }

    #[test]
    fn short_heading_recovers_via_lowered_min_prefix_chars() {
        // After lowering MIN_PREFIX_CHARS to 8, a 10-char heading
        // prefix like "H1 Heading" survives best-prefix trimming.
        let p = proj(&["H1 Heading", "Other content."]);
        let m = find_match("H1 Heading absent-trail", &p, Some(1), Some(1)).unwrap();
        assert!(m.is_prefix);
        assert_eq!(m.line, 1);
    }

    #[test]
    fn whitespace_query_does_not_use_char_level_fallback() {
        // For a whitespace query that is too short to recover via
        // word-level (single word, < MIN_PREFIX_CHARS=8 after trim),
        // we must NOT fall through to char-level — that would anchor
        // on noisy 8-char fragments. word_count("hello world") = 2,
        // which is ≥ MIN_PREFIX_WORDS, so char-level is bypassed.
        let p = proj(&["totally unrelated text"]);
        let m = find_match("hello world here", &p, Some(1), Some(1));
        // None of the word-level prefixes match either, so result is
        // None — char fallback isn't used because word_count ≥ 2.
        assert!(m.is_none());
    }

    #[test]
    fn span_distance_inside_span_is_zero() {
        assert_eq!(span_distance(5, 3, 7), 0);
    }

    #[test]
    fn span_distance_above_returns_diff() {
        assert_eq!(span_distance(10, 3, 7), 3);
    }

    #[test]
    fn span_distance_below_returns_diff() {
        assert_eq!(span_distance(1, 3, 7), 2);
    }

    // ── Stress / no-cap regressions (rubber-duck iter 2) ─────────────

    #[test]
    fn best_prefix_iterates_past_sixteen_word_trims() {
        // Selection has 25 words; the first 24 are deleted from the
        // source, only the leading 1 remains. The legacy
        // MAX_PREFIX_ATTEMPTS=16 cap would have stopped before
        // recovering the first-word prefix. With the cap removed, the
        // best-prefix iterator runs until the MIN_PREFIX_CHARS floor.
        // Build a 25-word query like "alpha-1 alpha-2 ... alpha-25"
        // and a source line containing only "alpha-1 alpha-2 alpha-3"
        // (3 words, ~21 chars — above the 12-char / 2-word floor).
        let words: Vec<String> = (1..=25).map(|i| format!("alpha-{i}")).collect();
        let query = words.join(" ");
        let source = "alpha-1 alpha-2 alpha-3 anchor here.".to_string();
        let p = proj(&[source.as_str()]);

        let m = find_match(&query, &p, Some(1), Some(1));
        let m = m.expect("best-prefix should recover even past 16 trims");
        assert!(m.is_prefix);
        assert_eq!(m.line, 1);
        assert!(
            m.matched_text.starts_with("alpha-1 alpha-2 alpha-3"),
            "expected longest surviving prefix; got {:?}",
            m.matched_text
        );
    }

    #[test]
    fn search_iterates_past_sixty_four_candidates_to_find_closest() {
        // Same needle appears 100 times; the 90th occurrence is
        // closest to orig_line. The legacy MAX_CANDIDATES=64 cap would
        // have truncated before the 90th match was inspected, biasing
        // the result toward earlier (top-of-document) candidates.
        // With the cap removed, the search collects all 100 matches
        // and picks the closest by span distance.
        let mut lines: Vec<String> = (1..=100).map(|i| format!("line {i} needle here")).collect();
        // Make line 90 an exact match too (same shape as the others).
        lines[89] = "line 90 needle here".to_string();
        let line_refs: Vec<&str> = lines.iter().map(String::as_str).collect();
        let p = proj(&line_refs);

        // orig_line is 90 → the 90th candidate should win.
        let m = find_match("needle", &p, Some(90), Some(90)).unwrap();
        assert_eq!(
            m.line, 90,
            "expected closest-to-orig (line 90); got line {}",
            m.line
        );
    }
}
