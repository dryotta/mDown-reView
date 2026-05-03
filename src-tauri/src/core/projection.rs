//! `RenderedProjection` — joined, normalized, line-mapped view of a
//! markdown source file used by the multi-line selection matcher.
//!
//! ## Why
//!
//! The `[matching]` algorithm in `core::matching` historically does
//! **single-line** substring search (`line.contains(selected_text)`).
//! That fails for two whole classes of visual-mode selection:
//!
//! 1. **Cross-block selections** — user selects from a heading into the
//!    paragraph below; `selected_text` carries an internal `\n`.
//! 2. **Single rendered block spanning multiple source lines** — a soft-
//!    wrapped paragraph renders as one visual line but the selection
//!    crosses a source-line boundary.
//!
//! Both cases are well-modeled as substring search over a single
//! "rendered text" projection of the file: each source line is stripped
//! of inline markdown markers and inline HTML tags, normalized for
//! whitespace, then **joined with single ASCII spaces**. This mirrors
//! how a browser collapses whitespace across source lines when
//! rendering a single block element, and crucially lets a query that
//! contained `\n` (cross-block selection) match the same flat region.
//!
//! Block boundaries are NOT preserved in the projection text: the
//! `closest-to-original-line` tie-break (in `multiline_match`) keeps
//! cross-block ambiguity bounded — we anchor the match nearest the
//! comment's recorded `line` / `end_line` hint.
//!
//! ## Line map
//!
//! `line_for_offset(offset)` returns the **1-based source line** that
//! the projection byte at `offset` originated from. The matcher uses
//! this to translate the byte index of a substring match back to the
//! source line a comment should anchor to.
//!
//! ## Cost
//!
//! Build is O(file_size). Per call, the projection is reused across
//! every comment for that file, so the amortized cost is one strip +
//! normalize per source line per file refresh.

use crate::core::block_strip::strip_block_prefix;
use crate::core::md_strip::strip_md_inline;
use crate::core::normalize::normalize_lossy;

/// A rendered-text projection of one source file.
///
/// `text` is the concatenation of normalized, marker-stripped source
/// lines joined by single ASCII spaces.
/// `line_starts[i]` is the byte offset in `text` where source line
/// `i + 1` (1-based) begins. Length matches the source's line count.
#[derive(Debug, Clone)]
pub struct RenderedProjection {
    /// Normalized, marker-stripped, line-joined text of the file.
    pub text: String,
    /// `line_starts[i]` = byte offset in `text` where source line
    /// `i + 1`'s content begins. Blank lines share the same offset as
    /// the following line because they contribute no visible bytes.
    pub line_starts: Vec<usize>,
}

impl RenderedProjection {
    /// Build a projection from a slice of raw source lines.
    ///
    /// `file_lines` is the same `&[&str]` shape consumed by
    /// `match_comments` — split on `\n`, no trailing newline per item.
    pub fn build(file_lines: &[&str]) -> Self {
        let mut text = String::with_capacity(file_lines.iter().map(|l| l.len()).sum());
        let mut line_starts = Vec::with_capacity(file_lines.len());

        // Track fenced-code-block state across lines. Inside a fenced
        // block, the user's visual-mode selection captures the literal
        // source bytes (Shiki renders the unmodified source); applying
        // markdown / inline-HTML / table-pipe rewrites to the line
        // would break that match. The ASCII-art table line
        //   `| Name | Type | Notes |`
        // appearing inside a code block must NOT be rewritten the way
        // a real GFM table row above the fence is.
        let mut in_fence = false;

        for (i, raw) in file_lines.iter().enumerate() {
            let toggles_fence = is_fence_marker(raw);
            // Fence MARKER lines themselves are part of the source but
            // not visible content; project them as their literal trim
            // (so a search for them still works) and toggle state for
            // the NEXT line.
            let projected = if in_fence && !toggles_fence {
                // Inside a fence — keep the line literal so verbatim
                // selections of code match the source line.
                project_line_literal(raw)
            } else {
                project_line_rich(raw)
            };
            if toggles_fence {
                in_fence = !in_fence;
            }

            if i > 0 && !projected.is_empty() && !text.ends_with(' ') {
                text.push(' ');
            }

            // Record line start AT the position where this line's
            // content (or the implicit boundary it sits behind) begins.
            // For blank lines that's the same offset as the next line —
            // accepted because blank lines contribute no visible
            // bytes; the binary search in `line_for_offset` will pick
            // whichever entry's offset is ≤ the queried position.
            line_starts.push(text.len());
            text.push_str(&projected);
        }

        RenderedProjection { text, line_starts }
    }

    /// Return the **1-based source line number** that `offset` maps to.
    /// `offset` is a byte index into `self.text`.
    ///
    /// Out-of-range offsets clamp to the last source line (or `1` if
    /// the projection is empty).
    pub fn line_for_offset(&self, offset: usize) -> u32 {
        if self.line_starts.is_empty() {
            return 1;
        }
        // Largest i such that line_starts[i] <= offset.
        // `partition_point` returns the count of entries ≤ key when
        // we ask for the first that is > key, then subtract 1. This
        // gives stable behaviour even when multiple entries share the
        // same offset (blank-line case).
        let count = self.line_starts.partition_point(|&s| s <= offset);
        // count is the number of line_starts ≤ offset; the last such
        // index is count-1. Clamp to 0 if every entry > offset (which
        // shouldn't happen because line_starts[0] is always 0, but
        // defensive).
        let idx = count.saturating_sub(1);
        (idx as u32) + 1
    }
}

/// Detect a CommonMark/GFM fenced-code-block marker line: optional
/// indent (0–3 spaces), then ≥3 backticks or tildes, optional info
/// string. Used to toggle the "in fence" state across lines.
fn is_fence_marker(raw: &str) -> bool {
    let trimmed = raw.trim_start_matches(' ');
    // CommonMark allows up to 3 leading spaces.
    let indent = raw.len() - trimmed.len();
    if indent > 3 {
        return false;
    }
    if trimmed.starts_with("```") {
        return trimmed.chars().take_while(|&c| c == '`').count() >= 3;
    }
    if trimmed.starts_with("~~~") {
        return trimmed.chars().take_while(|&c| c == '~').count() >= 3;
    }
    false
}

/// Rich projection used outside fenced blocks: strip block-level
/// prefix (heading/list/blockquote/HR markers), strip inline markdown
/// markers, flatten table-cell pipes, drop GFM table alignment rows,
/// normalize whitespace.
fn project_line_rich(raw: &str) -> String {
    if is_alignment_row(raw) {
        // Alignment rows (`|---|:---:|---:|`) are invisible in the
        // rendered HTML; their literal `:---:` content would inject
        // garbage into cross-row table selections.
        return String::new();
    }
    // Block-level prefix strip runs FIRST so the body sees the same
    // shape every other prose line does. Doing it after inline strip
    // would force every inline regex to handle the leading `> # `.
    let no_block = strip_block_prefix(raw);
    let stripped = strip_md_inline(&no_block);
    let unpiped = strip_table_cell_pipes(&stripped);
    normalize_lossy(&unpiped)
}

/// True when a line is a GFM table alignment row — bracketed pipes
/// containing only dashes, colons, and whitespace. The browser
/// renders this as table styling (column alignment) with no visible
/// text, so the projection must contribute nothing for it. Without
/// this the projection injects `--- :---: ---:` between header and
/// body rows and breaks cross-row selection matching.
fn is_alignment_row(raw: &str) -> bool {
    let trimmed = raw.trim();
    if trimmed.len() < 3 || !trimmed.starts_with('|') || !trimmed.ends_with('|') {
        return false;
    }
    // Inside the bracketing pipes, every char must be `-`, `:`, `|`,
    // or whitespace. Need at least two internal pipes for ≥ 2 cells
    // (so `|---|` alone doesn't qualify — that's an HR-like single
    // cell which the matcher won't see anyway, but be conservative).
    if trimmed.matches('|').count() < 3 {
        return false;
    }
    let inner = &trimmed[1..trimmed.len() - 1];
    inner
        .chars()
        .all(|c| matches!(c, '-' | ':' | '|' | ' ' | '\t'))
}

/// Literal projection used INSIDE fenced code blocks: only normalize
/// whitespace + smart punctuation. Markers and pipe-art lines are
/// preserved so a verbatim copy-paste of code matches the source byte
/// stream. Visual-mode selection inside a code block is rare today
/// (#280 routes code-block comments through a different surface) but
/// the matcher must still anchor correctly when it happens.
fn project_line_literal(raw: &str) -> String {
    normalize_lossy(raw)
}

/// If `line` looks like a GFM table row (`| cell | cell | cell |` or
/// the alignment row `|---|:---:|---:|`), drop the leading + trailing
/// `|` and replace internal `|` separators with spaces. Otherwise
/// returns the line unchanged.
///
/// Why projection-level, not in `md_strip`: GFM table pipes are
/// **block-level** syntax, not inline markers. The browser renders
/// adjacent cells with no visible separator (just cell-box layout), so
/// a visual-mode selection across cells captures their text joined by
/// spaces. Without this pass the projection retains literal pipes that
/// the user-visible selection no longer has, breaking substring search.
///
/// The heuristic is conservative — leading and trailing `|` plus at
/// least two internal pipes — to avoid accidentally rewriting prose
/// like "stdin | stdout | stderr" mid-paragraph (which doesn't have
/// the leading/trailing `|`s of a real table row). Code-span pipes
/// were already eaten by `strip_md_inline`'s code-span pass before
/// we get here.
fn strip_table_cell_pipes(line: &str) -> String {
    let trimmed_start = line.trim_start();
    let leading_ws_len = line.len() - trimmed_start.len();
    let trimmed = trimmed_start.trim_end();
    if trimmed.len() < 2 || !trimmed.starts_with('|') || !trimmed.ends_with('|') {
        return line.to_string();
    }
    if trimmed.matches('|').count() < 3 {
        // Need at least one internal pipe to be a multi-cell row.
        return line.to_string();
    }
    let inner = &trimmed[1..trimmed.len() - 1];
    let mut out = String::with_capacity(line.len());
    out.push_str(&line[..leading_ws_len]);
    out.push_str(&inner.replace('|', " "));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_for(lines: &[&str]) -> RenderedProjection {
        RenderedProjection::build(lines)
    }

    #[test]
    fn empty_file_yields_empty_projection() {
        let p = build_for(&[]);
        assert_eq!(p.text, "");
        assert!(p.line_starts.is_empty());
        // Out-of-range offset on empty projection clamps to line 1.
        assert_eq!(p.line_for_offset(0), 1);
    }

    #[test]
    fn single_line_no_markers_passes_through() {
        let p = build_for(&["hello world"]);
        assert_eq!(p.text, "hello world");
        assert_eq!(p.line_starts, vec![0]);
        assert_eq!(p.line_for_offset(0), 1);
        assert_eq!(p.line_for_offset(5), 1);
    }

    #[test]
    fn soft_wrapped_paragraph_joins_with_space() {
        let p = build_for(&["This is a paragraph that", "spans two lines."]);
        assert_eq!(p.text, "This is a paragraph that spans two lines.");
        // line_starts: line 1 starts at 0; line 2 starts at 25 (just
        // after the joining space).
        assert_eq!(p.line_starts, vec![0, 25]);
        assert_eq!(p.line_for_offset(0), 1);
        assert_eq!(p.line_for_offset(24), 1); // last char of line 1's content
        assert_eq!(p.line_for_offset(25), 2); // first char of line 2's content
    }

    #[test]
    fn blank_line_collapses_to_space_join() {
        let p = build_for(&["first paragraph", "", "second paragraph"]);
        assert_eq!(p.text, "first paragraph second paragraph");
        // Blank line shares its offset with line 3 (it contributes no
        // visible bytes; its line_start sits at the same point as the
        // next non-blank line). `line_for_offset` will resolve to
        // whichever line_starts entry's offset is ≤ the queried
        // position — for blank/non-blank pairs, the LAST matching wins
        // so the next-line is preferred (consistent with "no visible
        // bytes for the blank line").
        assert_eq!(p.line_starts.len(), 3);
        assert_eq!(p.line_starts[0], 0);
        assert_eq!(p.line_for_offset(0), 1);
        // Offset within "second paragraph" maps to line 3.
        let pos = p.text.find("second").unwrap();
        assert_eq!(p.line_for_offset(pos), 3);
    }

    #[test]
    fn cross_block_selection_can_match_after_normalize() {
        // After block-prefix strip + whitespace normalize, a heading
        // followed by a paragraph projects to flat rendered text with
        // no `#` marker — exactly what `getSelection().toString()`
        // returns when the user drags from heading to paragraph.
        let p = build_for(&[
            "# Heading",
            "",
            "Paragraph with content.",
        ]);
        assert_eq!(p.text, "Heading Paragraph with content.");
    }

    #[test]
    fn projection_strips_bold_marker() {
        let p = build_for(&["Hello **world** here"]);
        assert_eq!(p.text, "Hello world here");
    }

    #[test]
    fn projection_strips_inline_html_kbd() {
        let p = build_for(&["Press <kbd>Ctrl</kbd>+<kbd>K</kbd>"]);
        assert_eq!(p.text, "Press Ctrl+K");
    }

    #[test]
    fn projection_strips_link_keeping_text() {
        let p = build_for(&["Click [here](https://example.com) please"]);
        assert_eq!(p.text, "Click here please");
    }

    #[test]
    fn projection_combines_marker_strip_and_whitespace_normalize() {
        // NBSP between words on a marker line.
        let line = "use **bold**\u{00A0}word here";
        let p = build_for(&[line]);
        assert_eq!(p.text, "use bold word here");
    }

    #[test]
    fn line_for_offset_clamps_to_last_line_when_out_of_range() {
        let p = build_for(&["alpha", "beta"]);
        assert_eq!(p.text, "alpha beta");
        // Past the end → last source line (2).
        assert_eq!(p.line_for_offset(999), 2);
    }

    #[test]
    fn multiple_blank_lines_collapse_to_single_separator() {
        let p = build_for(&["alpha", "", "", "beta"]);
        assert_eq!(p.text, "alpha beta");
    }

    #[test]
    fn line_starts_monotonic_non_decreasing() {
        let p = build_for(&["a", "b", "", "c", "d"]);
        for w in p.line_starts.windows(2) {
            assert!(w[0] <= w[1], "line_starts not monotonic: {:?}", p.line_starts);
        }
    }

    #[test]
    fn line_for_offset_with_blank_lines_picks_following_line() {
        // For ["alpha", "", "beta"]:
        // line_starts = [0, 6, 6]  (blank line shares offset with "beta")
        // text = "alpha beta"
        // Offset 6 (start of "beta") → line 3, not the blank line 2.
        let p = build_for(&["alpha", "", "beta"]);
        assert_eq!(p.text, "alpha beta");
        assert_eq!(p.line_for_offset(6), 3);
    }

    // ── table-row projection ────────────────────────────────────────

    #[test]
    fn table_row_pipes_become_spaces() {
        let p = build_for(&["| Name | Type | Notes |"]);
        // Visual rendering shows "Name", "Type", "Notes" as cells. The
        // projection drops the bracketing pipes and replaces internal
        // ones with spaces (then collapses to single spaces).
        assert_eq!(p.text, "Name Type Notes");
    }

    #[test]
    fn table_row_with_inline_code_in_cell_keeps_text() {
        // Backticks already stripped by strip_md_inline; pipes by us.
        let p = build_for(&["| `read_text_file` | IPC command | Returns now |"]);
        assert_eq!(p.text, "read_text_file IPC command Returns now");
    }

    #[test]
    fn table_alignment_row_projects_to_empty() {
        // GFM table alignment rows are invisible in the rendered HTML
        // (browsers translate them into column styling). A
        // cross-row selection captures NO `--- :---: ---:` glyphs, so
        // the projection MUST contribute nothing for them. Without
        // this, cross-row selection matching breaks because of
        // `--- :---: ---:` garbage between header and body rows.
        let p = build_for(&["|---|:---:|---:|"]);
        assert_eq!(p.text, "");
    }

    #[test]
    fn cross_row_selection_matches_through_alignment_row() {
        // Header row joined to body row by a single space — alignment
        // row contributes nothing to the projection.
        let lines = vec![
            "| Name | Type | Notes |",
            "|---|---|---|",
            "| `read_text_file` | IPC command | Returns now |",
        ];
        let p = build_for(&lines);
        // The whole "Type Notes read_text_file IPC command" sweep
        // must appear without any dashes or colons interleaved.
        assert!(
            p.text.contains("Type Notes read_text_file IPC command"),
            "alignment row injected garbage between header and body: {:?}",
            p.text
        );
    }

    #[test]
    fn cross_cell_selection_matches_via_projection() {
        let lines = vec![
            "| Name | Type | Notes |",
            "|---|---|---|",
            "| `read_text_file` | IPC command | Returns now |",
        ];
        let p = build_for(&lines);
        // The user's visual-mode selection of "read_text_file IPC command"
        // (with single spaces, no pipes) appears in the projection.
        assert!(
            p.text.contains("read_text_file IPC command"),
            "projection should expose cross-cell text without pipes: {:?}",
            p.text
        );
    }

    #[test]
    fn prose_line_with_internal_pipe_is_left_alone() {
        // A line with a pipe somewhere in the middle but no bracketing
        // `|` at start AND end is NOT a table row → leave the pipe.
        let p = build_for(&["use stdin | grep foo to filter"]);
        assert!(p.text.contains("|"), "non-table-row pipe should survive");
    }

    #[test]
    fn line_with_only_two_pipes_is_not_a_table_row() {
        // `|cell|` with only 2 pipes is below the heuristic threshold;
        // leave it alone. (3 pipes would be `|c1|c2|`.)
        let p = build_for(&["|alone|"]);
        assert_eq!(p.text, "|alone|");
    }

    // ── fenced code block context-awareness ──────────────────────────

    #[test]
    fn pipe_art_inside_fenced_code_block_is_not_table_stripped() {
        // A line that LOOKS like a GFM table row but lives inside a
        // fenced code block must NOT be rewritten — the user sees the
        // literal bytes (Shiki preserves them) and a verbatim
        // selection should match the source.
        let p = build_for(&[
            "```",
            "| Name | Type | Notes |",
            "```",
        ]);
        // Inside the fence, the pipe-art line is preserved verbatim.
        assert!(
            p.text.contains("| Name | Type | Notes |"),
            "fenced pipe-art was rewritten: {:?}",
            p.text
        );
    }

    #[test]
    fn markdown_table_outside_fence_is_still_table_stripped() {
        // Same shape but outside a fence — the rewrite still applies.
        let p = build_for(&["| Name | Type | Notes |"]);
        assert_eq!(p.text, "Name Type Notes");
    }

    #[test]
    fn inline_html_inside_fenced_block_is_preserved() {
        // The user copy-pasting code with literal HTML in it should
        // match the source bytes, not the stripped form.
        let p = build_for(&[
            "```html",
            "<kbd>Ctrl</kbd>",
            "```",
        ]);
        assert!(
            p.text.contains("<kbd>Ctrl</kbd>"),
            "fenced HTML was stripped: {:?}",
            p.text
        );
    }

    #[test]
    fn fence_state_resets_after_closing_fence() {
        let p = build_for(&[
            "```",
            "| inside | fence |",
            "```",
            "| outside | fence | now |",
        ]);
        // Inside line preserved.
        assert!(p.text.contains("| inside | fence |"));
        // Outside line still rewritten.
        assert!(p.text.contains("outside fence now"));
    }

    #[test]
    fn tilde_fence_is_recognised() {
        let p = build_for(&[
            "~~~",
            "| inside | tildes |",
            "~~~",
        ]);
        assert!(p.text.contains("| inside | tildes |"));
    }

    #[test]
    fn fence_with_info_string_is_recognised() {
        let p = build_for(&[
            "```rust",
            "let x = vec![1, 2, 3];",
            "```",
        ]);
        // The Rust source line is projected literally; brackets stay.
        assert!(p.text.contains("vec![1, 2, 3]"));
    }
}

