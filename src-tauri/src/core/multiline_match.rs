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
const MIN_PREFIX_CHARS: usize = 12;

/// Minimum word count that a prefix must retain before it can match.
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

    // Tier 2: best-prefix retry. Iterate longest → shortest along word
    // boundaries until a prefix matches or the prefix is too short.
    for prefix in best_prefix_candidates(&normalized) {
        if let Some(line) = best_match_line(prefix, projection, orig_line, orig_end_line) {
            return Some(MultilineMatch {
                line,
                is_prefix: true,
                matched_text: prefix.to_string(),
            });
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
        // User selects from heading into following paragraph; the raw
        // selection contains '\n'. After lossy normalization, the '\n'
        // becomes ' ' (whitespace pass) — and the projection joins
        // blank-separated source lines with ' ' too — so the cross-
        // block selection matches.
        let p = proj(&[
            "# Heading",
            "",
            "Paragraph with content.",
        ]);
        // Note: heading "# Heading" stays as-is because md_strip
        // only strips inline (not block) markers.
        let m = find_match("# Heading\nParagraph with content.", &p, Some(1), Some(3)).unwrap();
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
        // "alpha beta gamma delta" → 22 chars / 4 words → ok
        // "alpha beta gamma"       → 16 chars / 3 words → ok
        // "alpha beta"             → 10 chars / 2 words → BELOW 12 chars → dropped
        // "alpha"                  → 5 chars / 1 word   → dropped
        assert_eq!(cuts.len(), 2);
        assert_eq!(cuts[0], "alpha beta gamma delta");
        assert_eq!(cuts[1], "alpha beta gamma");
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
