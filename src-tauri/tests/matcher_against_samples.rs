//! End-to-end matcher coverage against real sample markdown fixtures.
//!
//! Issue: visual-mode selection comments must anchor reliably even
//! when selections span multiple source lines, cross block boundaries,
//! span inline HTML, contain Unicode/whitespace noise, or have lost a
//! trailing word to a subsequent edit. The unit tests in
//! `core::matching::tests` cover each tier in isolation; this suite
//! drives the full matcher against actual samples to lock the user-
//! facing contract:
//!
//!   "match the selected text as completely as possible. When not
//!    possible, reduce the selection from the end and try to match
//!    the beginning."
//!
//! Failure here is either a real regression (the selection no longer
//! anchors) or a false positive (the selection anchored at the wrong
//! line). Both are user-visible bugs; fix the matcher, not the test.

use mdown_review_lib::core::matching::match_comments;
use mdown_review_lib::core::types::MrsfComment;

fn load_sample(name: &str) -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("samples")
        .join("markdown")
        .join(name);
    std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "could not read sample fixture {}: {e}",
            path.display()
        )
    })
}

fn comment_with_selection(orig_line: u32, end_line: Option<u32>, sel: &str) -> MrsfComment {
    MrsfComment {
        id: format!("c-test-{orig_line}"),
        author: "test".to_string(),
        timestamp: "2026-04-30T00:00:00Z".to_string(),
        text: "review note".to_string(),
        resolved: false,
        line: Some(orig_line),
        end_line,
        start_column: None,
        end_column: None,
        selected_text: Some(sel.to_string()),
        anchored_text: None,
        selected_text_hash: None,
        commit: None,
        comment_type: None,
        severity: None,
        reply_to: None,
        ..Default::default()
    }
}

fn match_one(file: &str, comment: MrsfComment) -> mdown_review_lib::core::types::MatchedComment {
    let content = load_sample(file);
    let lines: Vec<&str> = content.split('\n').collect();
    let result = match_comments(&[comment], &lines, &format!("/test/{file}"), "test");
    assert_eq!(result.len(), 1);
    result.into_iter().next().unwrap()
}

// ── 01-gfm-basics.md ────────────────────────────────────────────────

#[test]
fn gfm_basics_selection_inside_soft_wrapped_intro_paragraph() {
    // The intro paragraph at lines 3-5:
    //   "Headings, lists, blockquotes, emphasis, links, autolinks, strikethrough,"
    //   "inline code, and horizontal rules — the bread-and-butter of every"
    //   "markdown file."
    // User selects in visual view: "strikethrough, inline code, and horizontal rules"
    // — this crosses the source line break between line 3 and line 4.
    // Expectation: anchor at line 3 (start of the matched span).
    let comment = comment_with_selection(
        3,
        Some(5),
        "strikethrough, inline code, and horizontal rules",
    );
    let m = match_one("01-gfm-basics.md", comment);
    assert!(!m.is_orphaned, "should anchor across soft-wrap; got orphan");
    assert_eq!(
        m.matched_line_number, 3,
        "expected line 3 (start of matched span), got {}",
        m.matched_line_number
    );
}

#[test]
fn gfm_basics_selection_across_inline_formats_in_one_line() {
    // Line 32: "A line that mixes them: a *fast* `Vec<u8>` allocation **must not** ~~reallocate~~."
    // Visual selection: "fast Vec<u8> allocation must not reallocate"
    // — every word boundary crosses an inline marker.
    let comment = comment_with_selection(
        32,
        Some(32),
        "fast Vec<u8> allocation must not reallocate",
    );
    let m = match_one("01-gfm-basics.md", comment);
    assert!(!m.is_orphaned);
    assert_eq!(m.matched_line_number, 32);
}

#[test]
fn gfm_basics_selection_in_blockquote_with_link_and_code() {
    // Line 70: "> A longer blockquote with **emphasis**, `inline code`, and a [link](https://example.com)."
    // Visual selection: "longer blockquote with emphasis, inline code, and a link."
    let comment = comment_with_selection(
        70,
        Some(70),
        "longer blockquote with emphasis, inline code, and a link.",
    );
    let m = match_one("01-gfm-basics.md", comment);
    assert!(!m.is_orphaned);
    assert_eq!(m.matched_line_number, 70);
}

#[test]
fn gfm_basics_cross_block_selection_from_heading_into_following_paragraph() {
    // 01-gfm-basics.md:
    //   line  9: "# H1 Heading"
    //   line 10: "## H2 Heading"
    //   line 11: "### H3 Heading"
    // The visual viewer shows "H1 Heading", "H2 Heading", "H3 Heading"
    // as three rendered headings — `getSelection().toString()` does
    // NOT return the source-bytes `#`/`##`/`###` markers, only the
    // rendered text joined by `\n`. The matcher must strip block
    // markers in its projection so this RENDERED form matches fully.
    let comment = comment_with_selection(
        9,
        Some(11),
        "H1 Heading\nH2 Heading\nH3 Heading",
    );
    let m = match_one("01-gfm-basics.md", comment);
    assert!(!m.is_orphaned);
    assert_eq!(m.matched_line_number, 9);
    // FULL match required — best-prefix would silently drop the
    // trailing headings; that's the user-visible bug we're fixing.
    let anchored = m.anchored_text.as_deref().unwrap_or("");
    assert!(
        anchored.contains("H3 Heading"),
        "anchored_text should cover the FULL selection; got {anchored:?}"
    );
}

// ── 11-kitchen-sink.md ──────────────────────────────────────────────

#[test]
fn kitchen_sink_selection_across_inline_html_and_markdown() {
    // Lines 26-32 are one long paragraph mixing every inline format
    // *and* inline HTML. Visual selection: "italic, bold, bold italic, strikethrough"
    // — crosses *italic*, **bold**, ***bold italic***, ~~strikethrough~~.
    let comment = comment_with_selection(
        26,
        Some(32),
        "italic, bold, bold italic, strikethrough",
    );
    let m = match_one("11-kitchen-sink.md", comment);
    assert!(!m.is_orphaned, "should match through marker mix");
    assert_eq!(m.matched_line_number, 26);
}

#[test]
fn kitchen_sink_selection_spanning_kbd_and_text() {
    // Line 31: "keyboard hint <kbd>Ctrl</kbd>+<kbd>K</kbd>, subscript H<sub>2</sub>O,"
    // Visual selection: "keyboard hint Ctrl+K, subscript H2O,"
    let comment = comment_with_selection(31, Some(31), "keyboard hint Ctrl+K, subscript H2O,");
    let m = match_one("11-kitchen-sink.md", comment);
    assert!(!m.is_orphaned, "should match through kbd+sub HTML");
    assert_eq!(m.matched_line_number, 31);
}

// ── 02-tables.md ────────────────────────────────────────────────────

#[test]
fn tables_selection_inside_simple_cell() {
    // Line 9 has a row with `read_text_file` cell. Visual selection
    // captures the rendered cell content (no backticks).
    let comment = comment_with_selection(
        9,
        Some(9),
        "read_text_file IPC command",
    );
    let m = match_one("02-tables.md", comment);
    assert!(!m.is_orphaned);
    assert_eq!(m.matched_line_number, 9);
}

#[test]
fn tables_selection_through_br_in_cell() {
    // Line 65: "| line one<br>line two | `pipe \\| inside code spans is fine` | escape outside code: \\\\ |"
    // Visual selection: "line one line two" (br rendered as a space).
    let comment = comment_with_selection(65, Some(65), "line one line two");
    let m = match_one("02-tables.md", comment);
    assert!(!m.is_orphaned, "should match through <br>");
    assert_eq!(m.matched_line_number, 65);
}

// ── Best-prefix recovery against a real sample ──────────────────────

#[test]
fn best_prefix_recovers_when_trailing_word_no_longer_in_source() {
    // Take a known span from line 32 of 01-gfm-basics.md and append a
    // word that no longer exists. Best-prefix should drop the bogus
    // trailing word and anchor at line 32.
    let comment = comment_with_selection(
        32,
        Some(32),
        "fast Vec<u8> allocation must not reallocate ABSENT",
    );
    let m = match_one("01-gfm-basics.md", comment);
    assert!(!m.is_orphaned, "best-prefix should recover");
    assert_eq!(m.matched_line_number, 32);
    let anchored = m.anchored_text.as_deref().unwrap_or("");
    assert!(
        anchored.contains("fast Vec<u8> allocation must not reallocate")
            && !anchored.contains("ABSENT"),
        "anchored_text should drop trailing 'ABSENT', got: {anchored:?}"
    );
}

// ── Determinism under ambiguity ─────────────────────────────────────

#[test]
fn deterministic_match_when_ambiguous_picks_closest_to_orig_line() {
    // "## " appears on many heading lines in 01-gfm-basics. With
    // selected_text "## H" and orig_line 11, the matcher should anchor
    // at line 10 or 11 (closest "## " heading). Any deterministic
    // result is acceptable as long as it doesn't orphan.
    let comment = comment_with_selection(11, Some(11), "## H2 Heading");
    let m = match_one("01-gfm-basics.md", comment);
    assert!(!m.is_orphaned);
    // Line 10 is "## H2 Heading"; that's the unambiguous winner.
    assert_eq!(m.matched_line_number, 10);
}

// ── Fenced code block selection (rubber-duck iter 2 coverage) ──────

#[test]
fn selection_inside_fenced_code_block_matches_literal_source() {
    // 03-code-blocks.md line 9: `use std::collections::HashMap;`
    // inside a ```rust block. Visual-mode selection captures the
    // literal source bytes (Shiki preserves them), so the projection
    // must NOT rewrite them. Even literal `<` `>` `[` `]` `*` markers
    // inside code blocks should anchor.
    let comment = comment_with_selection(9, Some(9), "use std::collections::HashMap;");
    let m = match_one("03-code-blocks.md", comment);
    assert!(!m.is_orphaned, "fenced-code line should anchor literally");
    assert_eq!(m.matched_line_number, 9);
}

#[test]
fn selection_inside_fenced_code_with_brackets_matches() {
    // 03-code-blocks.md line 15: `pub mrsf_version: String,` inside
    // the rust struct. (Line numbers approximate; we just need any
    // line with rust syntax to confirm the projection preserves
    // brackets/markers inside the fence.)
    let content = load_sample("03-code-blocks.md");
    let lines: Vec<&str> = content.split('\n').collect();
    // Pick a line that contains `Vec<` — if it's literally present
    // and we project the file, our matcher should anchor exactly.
    let needle = "Vec<MrsfComment>";
    let target_line = lines
        .iter()
        .position(|l| l.contains(needle))
        .map(|p| (p + 1) as u32)
        .expect("sample fixture should contain Vec<MrsfComment>");

    let comment = comment_with_selection(target_line, Some(target_line), needle);
    let m = match_one("03-code-blocks.md", comment);
    assert!(!m.is_orphaned);
    assert_eq!(m.matched_line_number, target_line);
}

// ── No-cap stress (rubber-duck iter 2 blocking issue) ──────────────

#[test]
fn long_selection_recovers_via_extensive_prefix_trimming() {
    // Take a real paragraph from 11-kitchen-sink.md and append many
    // bogus trailing words. The matcher should trim them all and
    // anchor at the original line.
    let content = load_sample("11-kitchen-sink.md");
    let lines: Vec<&str> = content.split('\n').collect();
    // Find a recognizable phrase and build a long bogus tail.
    let phrase = "A paragraph with";
    let target_line = lines
        .iter()
        .position(|l| l.contains(phrase))
        .map(|p| (p + 1) as u32)
        .expect("sample fixture should contain the phrase");
    let trailing_bogus: String = (1..=30)
        .map(|i| format!("zzz-bogus-{i}"))
        .collect::<Vec<_>>()
        .join(" ");
    let sel = format!("{phrase} {trailing_bogus}");

    let comment = comment_with_selection(target_line, Some(target_line), &sel);
    let m = match_one("11-kitchen-sink.md", comment);
    assert!(
        !m.is_orphaned,
        "best-prefix should iterate past 16 attempts to recover"
    );
    assert_eq!(m.matched_line_number, target_line);
    assert!(
        m.anchored_text.as_deref().unwrap_or("").contains(phrase),
        "anchored prefix should include the leading phrase"
    );
    assert!(
        !m.anchored_text.as_deref().unwrap_or("").contains("zzz-bogus"),
        "anchored prefix should drop the bogus tail"
    );
}

// ── Negative case: completely unrelated selection orphans ───────────

#[test]
fn unrelated_selection_orphans() {
    // A selection with no overlap with any line in the sample: should
    // orphan, not anchor at the wrong line.
    let comment = comment_with_selection(
        20,
        Some(20),
        "this string absolutely positively does not appear anywhere",
    );
    let m = match_one("01-gfm-basics.md", comment);
    assert!(m.is_orphaned, "unrelated text must orphan, got line {}", m.matched_line_number);
}

// ── Block-marker stripping (rendered-text user contract) ────────────
//
// `getSelection().toString()` returns the RENDERED text, which has no
// block-level markdown markers (`# `, `> `, `- `, `1. `, `[ ]`, `[x]`,
// `[!TIP]`, HR `---`). The matcher must strip those from its
// projection so cross-block selections substring-match cleanly.
// "Match the selection as completely as possible" — full match wins
// over best-prefix recovery.

#[test]
fn rendered_cross_heading_selection_matches_fully() {
    // Lines 17-22 of 11-kitchen-sink.md:
    //   "# Level 1"
    //   "## Level 2"
    //   "### Level 3"
    //   "#### Level 4"
    //   "##### Level 5"
    //   "###### Level 6"
    // User dragging across the rendered headings sees "Level 1"
    // through "Level 6" with newlines between (no `#` markers).
    let comment = comment_with_selection(
        17,
        Some(22),
        "Level 1\nLevel 2\nLevel 3\nLevel 4\nLevel 5\nLevel 6",
    );
    let m = match_one("11-kitchen-sink.md", comment);
    assert!(
        !m.is_orphaned,
        "rendered cross-heading selection must anchor; got orphan"
    );
    assert_eq!(m.matched_line_number, 17);
    // Critical: must be a FULL match, not best-prefix recovery —
    // the user's "as much as possible" contract requires the WHOLE
    // selection to match when block markers are the only obstacle.
    let anchored = m.anchored_text.as_deref().unwrap_or("");
    assert!(
        anchored.contains("Level 6"),
        "anchored_text should cover the FULL selection (incl. Level 6); \
         got {anchored:?} — best-prefix recovery would drop trailing levels"
    );
}

#[test]
fn rendered_cross_task_list_selection_matches_fully() {
    // Lines 40-41 of 11-kitchen-sink.md:
    //   "- [x] Done — first task"
    //   "- [ ] Pending — second task"
    // Visual rendering shows checkboxes (DOM elements) followed by
    // "Done — first task" / "Pending — second task". The selection
    // captures only the text, no `- [ ]` / `- [x]` markers.
    let comment = comment_with_selection(
        40,
        Some(41),
        "Done — first task\nPending — second task",
    );
    let m = match_one("11-kitchen-sink.md", comment);
    assert!(
        !m.is_orphaned,
        "rendered cross-task-list selection must anchor; got orphan"
    );
    assert_eq!(m.matched_line_number, 40);
    let anchored = m.anchored_text.as_deref().unwrap_or("");
    assert!(
        anchored.contains("Pending") && anchored.contains("second task"),
        "anchored_text should cover BOTH list items (full match); \
         got {anchored:?} — partial match means best-prefix dropped line 41"
    );
}

#[test]
fn rendered_gfm_alert_blockquote_cross_line_selection_matches_fully() {
    // Lines 7-9 of 11-kitchen-sink.md:
    //   "> [!TIP]"
    //   "> If you found a regression on this page, narrow it down by opening"
    //   "> the dedicated single-feature file (01–10) that covers the surface."
    // remarkGithubAlerts strips the `[!TIP]` marker from the rendered
    // output; the `> ` markers are also absent visually. Selection
    // captures only the prose text.
    let comment = comment_with_selection(
        8,
        Some(9),
        "If you found a regression on this page, narrow it down by opening\n\
         the dedicated single-feature file (01–10) that covers the surface.",
    );
    let m = match_one("11-kitchen-sink.md", comment);
    assert!(
        !m.is_orphaned,
        "rendered alert-blockquote cross-line selection must anchor; got orphan"
    );
    assert_eq!(m.matched_line_number, 8);
    let anchored = m.anchored_text.as_deref().unwrap_or("");
    assert!(
        anchored.contains("dedicated single-feature file"),
        "anchored_text should cover the FULL selection; got {anchored:?} \
         — partial match means best-prefix dropped line 9"
    );
}

#[test]
fn rendered_cross_paragraph_through_hr_anchors_at_first_paragraph() {
    // 11-kitchen-sink.md: line 9 is the last line of the alert
    // blockquote, line 11 is the HR `---`, line 13 is `## Heading
    // anchors`. A user that drags from inside the alert through the
    // HR into the next heading captures rendered text WITHOUT the
    // `---` glyphs (browsers don't include `<hr>` content in the
    // selection string). The matcher should anchor at the start of
    // the captured prose, not orphan because of the intervening HR.
    let comment = comment_with_selection(
        9,
        Some(13),
        "the dedicated single-feature file (01–10) that covers the surface.\nHeading anchors",
    );
    let m = match_one("11-kitchen-sink.md", comment);
    assert!(
        !m.is_orphaned,
        "rendered selection across HR must anchor; got orphan"
    );
    // Full match would put us at line 9. If only best-prefix
    // recovers (dropping "Heading anchors"), we still land at line 9.
    assert_eq!(m.matched_line_number, 9);
}

#[test]
fn rendered_setext_heading_underline_does_not_block_match() {
    // Construct a setext-heading scenario inline (no sample uses
    // setext, but the matcher must still handle it). Source:
    //   "Setext H1"
    //   "========="
    //   ""
    //   "Following paragraph here."
    // Rendered: an H1 reading "Setext H1" followed by the paragraph.
    // User selection: "Setext H1\nFollowing paragraph here."
    use mdown_review_lib::core::matching::match_comments;
    let lines = vec![
        "Setext H1",
        "=========",
        "",
        "Following paragraph here.",
    ];
    let comment = comment_with_selection(1, Some(4), "Setext H1\nFollowing paragraph here.");
    let result = match_comments(&[comment], &lines, "/test/setext.md", "test");
    let m = result.into_iter().next().unwrap();
    assert!(!m.is_orphaned, "setext cross-paragraph must anchor");
    assert_eq!(m.matched_line_number, 1);
    let anchored = m.anchored_text.as_deref().unwrap_or("");
    assert!(
        anchored.contains("Following paragraph here"),
        "anchored_text should include trailing paragraph (full match); got {anchored:?}"
    );
}

#[test]
fn rendered_cross_row_table_selection_matches_through_alignment_row() {
    // 02-tables.md lines 7-9:
    //   "| Name | Type | Notes |"               (header row, line 7)
    //   "|---|---|---|"                          (alignment row, line 8 — invisible)
    //   "| `read_text_file` | IPC command | …"   (body row,   line 9)
    // User drag from a header cell into the body row captures the
    // rendered text "Type Notes\nread_text_file IPC command" with a
    // single newline (the alignment row contributes nothing visible).
    let comment = comment_with_selection(
        7,
        Some(9),
        "Type Notes\nread_text_file IPC command",
    );
    let m = match_one("02-tables.md", comment);
    assert!(
        !m.is_orphaned,
        "cross-row table selection must anchor through alignment row"
    );
    // Either line 7 (start of selection) is fine; line 9 would also
    // be acceptable. The KEY property: the alignment row does NOT
    // inject `--- :---: ---:` garbage that breaks the substring match.
    assert!(
        m.matched_line_number == 7 || m.matched_line_number == 9,
        "expected line 7 or 9; got {}",
        m.matched_line_number
    );
}

#[test]
fn rendered_footnote_reference_does_not_break_match() {
    // 11-kitchen-sink.md line 32 ends with `…and a footnote reference[^kitchen].`
    // The rendered output replaces `[^kitchen]` with a superscript link
    // that displays as a number (e.g. "¹" or "1"). A selection that
    // starts before the footnote reference and ends after must not
    // hit the literal `[^kitchen]` token in the projection.
    //
    // We capture only the prose ("a footnote reference") which DOES
    // appear on line 32. The projection must not contain `[^kitchen]`
    // garbage that would cause the closest-to-orig-line tie-break to
    // pick a different line that has the substring more cleanly.
    let comment = comment_with_selection(
        32,
        Some(32),
        "a footnote reference",
    );
    let m = match_one("11-kitchen-sink.md", comment);
    assert!(!m.is_orphaned);
    assert_eq!(m.matched_line_number, 32);
}

// ── Best-prefix recovery: lowered MIN_PREFIX_CHARS ──────────────────

#[test]
fn best_prefix_recovers_short_heading_after_lowered_floor() {
    // After fix: MIN_PREFIX_CHARS lowered to 8 so 10-char headings like
    // "H1 Heading" survive trimming. Build a query with a recoverable
    // 10-char prefix and bogus tail.
    use mdown_review_lib::core::matching::match_comments;
    let lines = vec!["# H1 Heading", "Other content here."];
    // 10-char prefix "H1 Heading" + bogus tail.
    let comment = comment_with_selection(1, Some(1), "H1 Heading absent-trail");
    let result = match_comments(&[comment], &lines, "/test/h1.md", "test");
    let m = result.into_iter().next().unwrap();
    assert!(!m.is_orphaned, "10-char prefix must recover");
    assert_eq!(m.matched_line_number, 1);
}

// ── CJK / no-whitespace char-level best-prefix fallback ─────────────

#[test]
fn cjk_no_whitespace_query_recovers_via_char_level_prefix() {
    // CJK paragraphs have no ASCII spaces. Best-prefix word-level
    // trimming would yield zero candidates; the char-level fallback
    // (gated on word_count < MIN_PREFIX_WORDS) trims trailing chars
    // to recover the leading prefix.
    use mdown_review_lib::core::matching::match_comments;
    // Source line: "你好世界这是一段测试文字" (12 chars, no spaces).
    // Selection: "你好世界这是一段测试文字含杂尾" (extra 3 chars at the end).
    // The trailing 3 chars don't appear in the source — char-level
    // best-prefix should drop them and anchor at line 1.
    let lines = vec!["你好世界这是一段测试文字。"];
    let comment = comment_with_selection(1, Some(1), "你好世界这是一段测试文字含杂尾");
    let result = match_comments(&[comment], &lines, "/test/cjk.md", "test");
    let m = result.into_iter().next().unwrap();
    assert!(
        !m.is_orphaned,
        "CJK query without whitespace should recover via char-level prefix"
    );
    assert_eq!(m.matched_line_number, 1);
}
