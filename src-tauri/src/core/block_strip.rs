//! Block-level marker stripper used by the matcher's rendered-text
//! projection.
//!
//! `getSelection().toString()` in the markdown viewer returns the
//! **rendered** text — block markers (`#`, `>`, `-`, `*`, `1.`, `[ ]`,
//! `[x]`, `[!TIP]`, HR `---`, setext underline `===`) are not part of
//! what the user copies. The matcher's per-line substring search needs
//! the projection to look like the rendered text, so cross-block
//! selections can match cleanly.
//!
//! This module is a peer of `core::md_strip` (which handles **inline**
//! markers like `**bold**`, `[link](url)`, `<kbd>…</kbd>`). The
//! projection pipeline calls `strip_block_prefix` *before*
//! `strip_md_inline` because the leading `> ` / `# ` / `- ` markers
//! gate the rest of the line — strip the gate first, then process the
//! body inline content the same way every other prose line is treated.
//!
//! Conservative by design: when a line doesn't match any recognised
//! prefix, we return it unchanged. False negatives (a marker we miss)
//! land back in the existing fuzzy / best-prefix tiers as a safety
//! net; false positives (over-stripping prose that happens to look
//! like a list marker) are the riskier failure mode and the prefix
//! patterns are anchored at the start of the line to keep that risk
//! local to the leading word(s).

use std::sync::OnceLock;

use regex::Regex;

/// Return a copy of `raw` with leading block-level markdown markers
/// removed. Lines that consist entirely of an HR rule (`---`, `***`,
/// `___`) or a setext-heading underline (`===`, `---` in suitable
/// context) project to an empty string — the user never sees those
/// glyphs in the rendered output.
///
/// **Inside** fenced code blocks the projection is literal, so
/// callers must skip this function for fenced lines.
pub fn strip_block_prefix(raw: &str) -> String {
    // Hard-empty cases: HR-only and setext-underline-only lines have
    // no rendered text contribution. We can't distinguish a setext
    // `---` underline from an HR without two-line context, but the
    // user impact is identical (both project to empty), so we
    // collapse both into the same empty rule.
    if is_hr_or_setext_underline(raw) {
        return String::new();
    }

    let mut s: &str = raw;

    // Strip blockquote prefix one or more times, then optionally an
    // alert tag (`[!TIP]` / `[!NOTE]` / etc.) which `remark-github-
    // alerts` rewrites to a styled callout — the literal tag is never
    // visible to a `getSelection()` capture.
    if let Some(stripped) = blockquote_re().captures(s) {
        s = &s[stripped.get(0).unwrap().end()..];
        if let Some(tag) = alert_tag_re().captures(s) {
            s = &s[tag.get(0).unwrap().end()..];
        }
    }

    // Task-list checkbox marker takes precedence over plain bullet —
    // both share the leading `[-*+] ` so we try the task pattern
    // first.
    if let Some(m) = task_marker_re().find(s) {
        return s[m.end()..].to_string();
    }

    if let Some(m) = bullet_re().find(s) {
        return s[m.end()..].to_string();
    }

    if let Some(m) = ordered_re().find(s) {
        return s[m.end()..].to_string();
    }

    // ATX heading — strip both the leading `#{1,6} ` and any trailing
    // closing `#`s (CommonMark §4.2 allows them; they're invisible).
    if let Some(stripped) = atx_heading_re().captures(s) {
        let body = stripped.get(1).map(|m| m.as_str()).unwrap_or("");
        return body.trim_end_matches(|c: char| c == '#' || c == ' ' || c == '\t').to_string();
    }

    s.to_string()
}

/// True when the line is purely an HR (`---`, `***`, `___`, with
/// optional spaces between glyphs) or a setext-heading underline
/// (`===…`, `---…`). Both contribute nothing to the rendered text.
///
/// Setext underlines and HRs have overlapping syntax — without
/// looking at the previous line we can't tell them apart, but the
/// projection treatment is identical so the ambiguity is harmless.
/// Lines must consist ENTIRELY of the marker (modulo leading /
/// trailing whitespace) to qualify; a line like `--- and more` is
/// prose and survives.
fn is_hr_or_setext_underline(raw: &str) -> bool {
    let trimmed = raw.trim();
    if trimmed.len() < 3 {
        return false;
    }
    // Single-character runs of -, *, _, =. The CommonMark HR also
    // allows internal spaces (`- - -`), but a setext underline
    // strictly does not — accept both because the user's selection
    // never includes either form.
    let first = trimmed.chars().next().unwrap();
    if !matches!(first, '-' | '*' | '_' | '=') {
        return false;
    }
    trimmed.chars().all(|c| c == first || c == ' ')
}

// ── Regex factories ─────────────────────────────────────────────────

fn atx_heading_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // 1-6 leading `#`s, mandatory whitespace, optional body. Group 1
    // captures the body so we can also peel trailing `#`s.
    RE.get_or_init(|| Regex::new(r"^[ \t]{0,3}#{1,6}[ \t]+(.*)$").unwrap())
}

fn blockquote_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // One or more `>` levels with intervening spaces. The CommonMark
    // grammar permits `> > >` for nested quotes; we strip every
    // leading `>` and the whitespace separating them.
    RE.get_or_init(|| Regex::new(r"^[ \t]{0,3}(?:>[ \t]*)+").unwrap())
}

fn alert_tag_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // GFM alert tag — a bracketed type marker that immediately follows
    // a blockquote prefix. `remark-github-alerts` consumes this and
    // replaces it with a styled callout, so the literal `[!TIP]` etc.
    // never appears in `getSelection()`. Case-sensitive per the GitHub
    // spec, but we permit lowercase as a courtesy.
    RE.get_or_init(|| {
        Regex::new(r"(?i)^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*").unwrap()
    })
}

fn task_marker_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // `- [ ]`, `- [x]`, `- [X]`, etc. with leading indent and bullet.
    RE.get_or_init(|| Regex::new(r"^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+").unwrap())
}

fn bullet_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // `- `, `* `, `+ ` with leading indent. Must be followed by at
    // least one whitespace; bare `-text` is prose, not a list marker.
    RE.get_or_init(|| Regex::new(r"^[ \t]*[-*+][ \t]+").unwrap())
}

fn ordered_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // `1. `, `42. `, `1) `, etc. CommonMark caps the digit count at 9
    // but we permit longer numbers — the user-visible difference is
    // marginal and the strip is cheap.
    RE.get_or_init(|| Regex::new(r"^[ \t]*\d{1,9}[.)][ \t]+").unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_atx_h1() {
        assert_eq!(strip_block_prefix("# Heading"), "Heading");
    }

    #[test]
    fn strips_atx_h6() {
        assert_eq!(strip_block_prefix("###### H6"), "H6");
    }

    #[test]
    fn strips_atx_with_trailing_hashes() {
        assert_eq!(strip_block_prefix("## Heading ##"), "Heading");
    }

    #[test]
    fn does_not_strip_atx_without_space() {
        // CommonMark: `#abc` is NOT a heading (no required space). We
        // leave it as-is so it doesn't false-positive on prose like
        // `#tagged-tweet`.
        assert_eq!(strip_block_prefix("#notaheading"), "#notaheading");
    }

    #[test]
    fn strips_blockquote_single_level() {
        assert_eq!(strip_block_prefix("> Quote text"), "Quote text");
    }

    #[test]
    fn strips_blockquote_nested_levels() {
        assert_eq!(strip_block_prefix("> > > deeply"), "deeply");
        assert_eq!(strip_block_prefix(">> double"), "double");
    }

    #[test]
    fn strips_blockquote_then_alert_tag() {
        assert_eq!(strip_block_prefix("> [!TIP]"), "");
        assert_eq!(strip_block_prefix("> [!NOTE] body"), "body");
        assert_eq!(strip_block_prefix("> [!WARNING] watch out"), "watch out");
    }

    #[test]
    fn strips_blockquote_alert_lowercase() {
        // Spec is case-sensitive, but we accept lowercase as courtesy.
        assert_eq!(strip_block_prefix("> [!tip]"), "");
    }

    #[test]
    fn strips_task_marker_unchecked() {
        assert_eq!(strip_block_prefix("- [ ] Pending"), "Pending");
    }

    #[test]
    fn strips_task_marker_checked() {
        assert_eq!(strip_block_prefix("- [x] Done"), "Done");
        assert_eq!(strip_block_prefix("- [X] Done caps"), "Done caps");
    }

    #[test]
    fn strips_indented_task_marker() {
        assert_eq!(strip_block_prefix("  - [x] Sub-task"), "Sub-task");
    }

    #[test]
    fn strips_bullet_marker_dash() {
        assert_eq!(strip_block_prefix("- item"), "item");
    }

    #[test]
    fn strips_bullet_marker_star() {
        assert_eq!(strip_block_prefix("* item"), "item");
    }

    #[test]
    fn strips_bullet_marker_plus() {
        assert_eq!(strip_block_prefix("+ item"), "item");
    }

    #[test]
    fn strips_indented_bullet() {
        assert_eq!(strip_block_prefix("  - nested"), "nested");
        assert_eq!(strip_block_prefix("    - deeply nested"), "deeply nested");
    }

    #[test]
    fn strips_ordered_list_marker_dot() {
        assert_eq!(strip_block_prefix("1. first"), "first");
        assert_eq!(strip_block_prefix("42. forty-second"), "forty-second");
    }

    #[test]
    fn strips_ordered_list_marker_paren() {
        assert_eq!(strip_block_prefix("1) first"), "first");
    }

    #[test]
    fn does_not_strip_bare_dash_in_prose() {
        // `-text` (no space) is prose, not a list marker. This guards
        // against false-positives on negative numbers etc.
        assert_eq!(strip_block_prefix("-1 means error"), "-1 means error");
    }

    #[test]
    fn hr_dashes_projects_to_empty() {
        assert_eq!(strip_block_prefix("---"), "");
        assert_eq!(strip_block_prefix("- - -"), "");
        assert_eq!(strip_block_prefix("----------"), "");
    }

    #[test]
    fn hr_stars_projects_to_empty() {
        assert_eq!(strip_block_prefix("***"), "");
    }

    #[test]
    fn hr_underscores_projects_to_empty() {
        assert_eq!(strip_block_prefix("___"), "");
    }

    #[test]
    fn setext_underline_equals_projects_to_empty() {
        assert_eq!(strip_block_prefix("==="), "");
        assert_eq!(strip_block_prefix("=========="), "");
    }

    #[test]
    fn short_dash_run_is_not_hr() {
        // CommonMark requires ≥ 3 chars for HR; `--` should stay as-is.
        assert_eq!(strip_block_prefix("--"), "--");
    }

    #[test]
    fn dashes_with_other_text_are_not_hr() {
        // Mixed content: not an HR, return unchanged.
        let s = "--- and more";
        // After our hr check fails (mixed chars), we then try other
        // prefixes. `--- and` does not match a list/heading/blockquote
        // pattern, so it survives. (The trailing `and more` is prose.)
        assert_eq!(strip_block_prefix(s), s);
    }

    #[test]
    fn no_marker_passes_through_unchanged() {
        assert_eq!(strip_block_prefix("just plain prose."), "just plain prose.");
    }

    #[test]
    fn empty_line_passes_through_unchanged() {
        assert_eq!(strip_block_prefix(""), "");
    }

    #[test]
    fn whitespace_only_line_passes_through_unchanged() {
        assert_eq!(strip_block_prefix("   "), "   ");
    }

    #[test]
    fn task_in_blockquote_strips_both() {
        // `> - [x] Done` — blockquote first, then task marker.
        assert_eq!(strip_block_prefix("> - [x] Done"), "Done");
    }

    #[test]
    fn bullet_in_blockquote_strips_both() {
        assert_eq!(strip_block_prefix("> - item"), "item");
    }

    #[test]
    fn ordered_in_blockquote_strips_both() {
        assert_eq!(strip_block_prefix("> 1. item"), "item");
    }

    #[test]
    fn heading_in_blockquote_strips_both() {
        assert_eq!(strip_block_prefix("> # Heading"), "Heading");
    }

    #[test]
    fn nested_blockquote_with_alert() {
        assert_eq!(strip_block_prefix("> > [!CAUTION] careful"), "careful");
    }
}
