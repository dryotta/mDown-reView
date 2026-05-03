//! Markdown inline-formatting stripper used by the matcher when a
//! visual-mode selection (rendered text without markers) needs to match
//! against the source line (with markers).
//!
//! When a user selects text in the visual viewer, `window.getSelection()
//! .toString()` returns the rendered text — `**bold**` shows up as
//! `bold`, `[link](url)` as `link`, and so on. The Rust matcher's step 1
//! (`line.contains(selected_text)`) fails whenever the selection spans an
//! inline-formatting marker, even though the rendered text the user sees
//! IS clearly present on that line. This stripper canonicalises a source
//! line down to its rendered form so substring search recovers.
//!
//! The algorithm is intentionally conservative — it strips only the
//! inline-formatting markers GFM users encounter most often: bold,
//! italic, bold-italic (`***`/`___`), inline code, strikethrough,
//! links, images, and autolinks. It is **not** a full CommonMark
//! tokeniser. False positives (over-stripping) are preferable to false
//! negatives (under-stripping) here because the matcher only consults
//! the stripped form when the un-stripped substring search has already
//! failed; an over-strip can at worst point to a slightly different but
//! still-plausible line, which the closest-to-original-line tiebreaker
//! handles. The matcher's downstream fuzzy step is unchanged and remains
//! the safety net for edits beyond formatting changes.

use std::sync::OnceLock;

use regex::Regex;

/// Strip GFM inline formatting markers from a single source line so the
/// rendered text becomes substring-searchable. See module docstring for
/// scope and rationale. Returns the line unchanged if no markers match.
pub fn strip_md_inline(line: &str) -> String {
    // Cheap fast-path: skip allocating + regex work for lines that
    // contain none of the marker characters we care about. The matcher
    // calls this for every candidate line, including the great majority
    // that have no inline formatting at all (plain prose, code, blank
    // lines), so the fast-path materially reduces overhead.
    if !line.bytes().any(is_marker_byte) {
        return line.to_string();
    }

    let mut out = line.to_string();

    // Order matters: strip code spans first so their content (which may
    // contain `*`/`_`/`[`/`]` chars) doesn't get re-interpreted by the
    // emphasis or link passes below. Then images (which start with `!`
    // and would otherwise be partially eaten by the link pass), then
    // links, then reference-links, then autolinks, then bold-italic,
    // bold, italic, and finally strikethrough.

    out = code_re().replace_all(&out, "$1").into_owned();
    out = image_re().replace_all(&out, "$1").into_owned();
    out = link_re().replace_all(&out, "$1").into_owned();
    out = reflink_re().replace_all(&out, "$1").into_owned();
    out = autolink_re().replace_all(&out, "$1").into_owned();
    out = bold_italic_star_re().replace_all(&out, "$1").into_owned();
    out = bold_italic_under_re().replace_all(&out, "$1").into_owned();
    out = bold_star_re().replace_all(&out, "$1").into_owned();
    out = bold_under_re().replace_all(&out, "$1").into_owned();
    // Italic patterns use a boundary-context capture (groups 1 + 3 hold
    // the surrounding non-word chars) so they are NOT eaten by the
    // replacement. Bold/code/link patterns above are simpler because
    // their delimiters are unambiguous and don't need a boundary check.
    out = italic_star_re().replace_all(&out, "$1$2$3").into_owned();
    out = italic_under_re().replace_all(&out, "$1$2$3").into_owned();
    out = strike_re().replace_all(&out, "$1").into_owned();
    // Inline HTML — strip just the tags, keep the text. Runs LAST so a
    // tag appearing inside a code span (which already had its backticks
    // peeled) doesn't get accidentally stripped above.
    out = strip_inline_html(&out);

    out
}

/// Strip inline HTML element tags (open + close + self-closing) from a
/// rendered-line string, leaving the inner text intact.
///
/// `react-markdown` renders `<kbd>Ctrl</kbd>+<kbd>K</kbd>` to "Ctrl+K";
/// the matcher's substring search needs the source line to project to
/// the same form. We deliberately only strip a small whitelist of
/// inline elements that mdownreview's sanitize schema permits — block
/// HTML (`<details>`, `<summary>`, raw `<table>`) is NOT touched here
/// because the matcher already line-splits the source.
///
/// The `<br>` element is replaced with a single space so cell content
/// like `line one<br>line two` projects to "line one line two".
///
/// Conservative by design: an unmatched tag (e.g. literal `<` not
/// followed by an allowed tag name) is left as-is. Over-stripping could
/// silently merge unrelated text; the fuzzy / best-prefix tiers are
/// safety nets when this conservative pass leaves a tag in place.
pub fn strip_inline_html(line: &str) -> String {
    if !line.contains('<') {
        return line.to_string();
    }
    let mut out = inline_html_open_re().replace_all(line, "").into_owned();
    out = inline_html_close_re().replace_all(&out, "").into_owned();
    out = inline_html_void_re().replace_all(&out, " ").into_owned();
    out
}

#[inline]
fn is_marker_byte(b: u8) -> bool {
    matches!(b, b'*' | b'_' | b'`' | b'[' | b']' | b'<' | b'>' | b'~' | b'!')
}

fn code_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // Single-or-multi backtick code spans. Captures the inner content,
    // requires matching opener/closer on the same line. `[^`]+` keeps
    // the body non-greedy and prevents crossing into a second code span.
    RE.get_or_init(|| Regex::new(r"`+([^`\n]+?)`+").unwrap())
}

fn image_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // ![alt](url) — captures alt text. Allows empty alt.
    RE.get_or_init(|| Regex::new(r"!\[([^\]]*)\]\([^)]*\)").unwrap())
}

fn link_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // [text](url) — captures link text. Allows empty text.
    RE.get_or_init(|| Regex::new(r"\[([^\]]*)\]\(([^)]*)\)").unwrap())
}

fn reflink_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // Reference-style links [text][ref] and shortcut [ref][]. Captures
    // the link text (group 1). Shortcut form `[ref]` alone is left
    // untouched because the rendered output is still `ref`.
    RE.get_or_init(|| Regex::new(r"\[([^\]]+)\]\[[^\]]*\]").unwrap())
}

fn autolink_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // <https://...> / <http://...> / <ftp://...> autolinks. Captures URL.
    RE.get_or_init(|| Regex::new(r"<((?:https?|ftp)://[^>\s]+)>").unwrap())
}

fn bold_italic_star_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // ***text***  — needs to fire BEFORE bold/italic so the inner two
    // markers don't peel off independently and leave a stray `*`.
    RE.get_or_init(|| Regex::new(r"\*\*\*([^\s*][^*\n]*?[^\s*]|[^\s*])\*\*\*").unwrap())
}

fn bold_italic_under_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"___([^\s_][^_\n]*?[^\s_]|[^\s_])___").unwrap())
}

fn bold_star_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // **text** — boundary chars require non-whitespace + non-`*` so we
    // don't eat `** `, ` **`, or empty `****`.
    RE.get_or_init(|| Regex::new(r"\*\*([^\s*][^*\n]*?[^\s*]|[^\s*])\*\*").unwrap())
}

fn bold_under_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"__([^\s_][^_\n]*?[^\s_]|[^\s_])__").unwrap())
}

fn italic_star_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // *text* — boundary chars are captured (groups 1 + 3) and re-emitted
    // by the caller so the surrounding spaces/punctuation aren't eaten.
    // The non-word boundary is required so `a*b*c` (which GFM treats as
    // literal asterisks) doesn't strip.
    RE.get_or_init(|| Regex::new(r"(^|[^\w*])\*([^\s*][^*\n]*?[^\s*]|[^\s*])\*([^\w*]|$)").unwrap())
}

fn italic_under_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(^|[^\w_])_([^\s_][^_\n]*?[^\s_]|[^\s_])_([^\w_]|$)").unwrap())
}

fn strike_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // ~~text~~ — GFM strikethrough.
    RE.get_or_init(|| Regex::new(r"~~([^~\n]+)~~").unwrap())
}

/// Whitelist of HTML elements considered "inline-safe" for the matcher.
/// Mirrors the elements `react-markdown`'s sanitize schema renders as
/// inline content. Anything outside this list is left intact so the
/// matcher's later fuzzy step can still see it.
///
/// Kept in sync (in spirit) with the inline elements allowed by
/// `src/components/viewers/markdown/sanitizeSchema.ts`. If the
/// frontend permits a new inline HTML tag, add it here so visual-mode
/// selections that span its rendered text still match the source.
const INLINE_HTML_TAGS: &str =
    r"(?:kbd|abbr|sub|sup|mark|ins|del|span|dfn|small|cite|u|s|em|strong|i|b|code|q|var|samp|time)";

fn inline_html_open_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // <tag>, <tag attr="…">, <tag attr='…'>, <tag class=foo>
        // attributes section is non-greedy and stops at first `>`.
        Regex::new(&format!(r"(?i)<{}(?:\s+[^>]*)?>", INLINE_HTML_TAGS)).unwrap()
    })
}

fn inline_html_close_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(&format!(r"(?i)</{}\s*>", INLINE_HTML_TAGS)).unwrap())
}

fn inline_html_void_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // Void / self-closing inline tags. <br> + <wbr> render as breaks /
    // word-break opportunities — replace with a single space so cells
    // and lines containing them project to space-separated text.
    RE.get_or_init(|| Regex::new(r"(?i)<(?:br|wbr)\s*/?>").unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fast_path_returns_unchanged_when_no_markers() {
        assert_eq!(strip_md_inline("plain prose only"), "plain prose only");
        assert_eq!(strip_md_inline(""), "");
        assert_eq!(strip_md_inline("   "), "   ");
    }

    #[test]
    fn strips_bold_double_star() {
        assert_eq!(strip_md_inline("Hello **world** here"), "Hello world here");
    }

    #[test]
    fn strips_bold_double_underscore() {
        assert_eq!(strip_md_inline("Hello __world__ here"), "Hello world here");
    }

    #[test]
    fn strips_italic_single_star() {
        assert_eq!(strip_md_inline("Hello *world* here"), "Hello world here");
    }

    #[test]
    fn strips_italic_single_underscore() {
        assert_eq!(strip_md_inline("Hello _world_ here"), "Hello world here");
    }

    #[test]
    fn strips_bold_italic_triple_marker() {
        assert_eq!(strip_md_inline("***bold-italic***"), "bold-italic");
        assert_eq!(strip_md_inline("___bold-italic___"), "bold-italic");
    }

    #[test]
    fn strips_inline_code() {
        assert_eq!(strip_md_inline("Use `cargo build` now"), "Use cargo build now");
    }

    #[test]
    fn strips_multi_backtick_code() {
        // Multi-backtick code spans (``…``) are stripped to bare content
        // including any inner backticks. This is a deliberate
        // simplification — proper opener/closer-length matching needs
        // multi-pass parsing the matcher can avoid because the fuzzy
        // step is the safety net for niche cases like inner backticks.
        assert_eq!(strip_md_inline("Show ``a `b` c`` literally"), "Show a b c literally");
    }

    #[test]
    fn strips_link_keeps_text() {
        assert_eq!(
            strip_md_inline("Click [here](https://example.com) please"),
            "Click here please"
        );
    }

    #[test]
    fn strips_reference_link_keeps_text() {
        assert_eq!(
            strip_md_inline("See [the repo][repo] for more"),
            "See the repo for more"
        );
    }

    #[test]
    fn strips_image_keeps_alt() {
        assert_eq!(
            strip_md_inline("Here is ![logo](./logo.svg) the logo"),
            "Here is logo the logo"
        );
    }

    #[test]
    fn strips_autolink_to_url() {
        assert_eq!(
            strip_md_inline("Visit <https://www.rust-lang.org> for docs"),
            "Visit https://www.rust-lang.org for docs"
        );
    }

    #[test]
    fn strips_strikethrough() {
        assert_eq!(strip_md_inline("~~deprecated~~ stuff"), "deprecated stuff");
    }

    #[test]
    fn strips_combined_inline_formats() {
        // Mirrors line 32 of samples/markdown/01-gfm-basics.md
        let line = "A line that mixes them: a *fast* `Vec<u8>` allocation **must not** ~~reallocate~~.";
        let stripped = strip_md_inline(line);
        assert!(
            stripped.contains("fast Vec<u8> allocation must not reallocate"),
            "stripped form should contain the rendered selection: got {stripped:?}"
        );
    }

    #[test]
    fn does_not_strip_isolated_asterisks_outside_emphasis() {
        // `**` in GFM with whitespace-bounded markers is literal — don't strip.
        assert_eq!(strip_md_inline("a ** b"), "a ** b");
        assert_eq!(strip_md_inline("** lonely"), "** lonely");
    }

    #[test]
    fn does_not_strip_arithmetic_underscore_in_words() {
        // `snake_case_var` should be preserved.
        assert_eq!(strip_md_inline("use snake_case_var here"), "use snake_case_var here");
    }

    #[test]
    fn handles_link_with_empty_text() {
        assert_eq!(strip_md_inline("Click [](url) anyway"), "Click  anyway");
    }

    #[test]
    fn preserves_lines_with_only_unmatched_markers() {
        assert_eq!(strip_md_inline("just * a star"), "just * a star");
        assert_eq!(strip_md_inline("a `lonely tick"), "a `lonely tick");
    }

    #[test]
    fn strips_nested_link_in_blockquote_text() {
        // Blockquote `>` is line-level, not inline; matcher passes the
        // raw line, so the inline stripper sees the prefix but ignores it.
        assert_eq!(
            strip_md_inline("> A longer blockquote with **emphasis**, `inline code`, and a [link](https://example.com)."),
            "> A longer blockquote with emphasis, inline code, and a link."
        );
    }

    #[test]
    fn strips_multiple_links_on_same_line() {
        assert_eq!(
            strip_md_inline("[one](u1) and [two](u2) and [three](u3)"),
            "one and two and three"
        );
    }

    // ── Inline HTML stripping (visual-mode selection across rendered HTML) ──

    #[test]
    fn strips_kbd_tags() {
        assert_eq!(strip_md_inline("Press <kbd>Ctrl</kbd>+<kbd>K</kbd>"), "Press Ctrl+K");
    }

    #[test]
    fn strips_abbr_tags_with_title_attribute() {
        assert_eq!(
            strip_md_inline(r#"An <abbr title="Inter-Process Communication">IPC</abbr> abbreviation"#),
            "An IPC abbreviation"
        );
    }

    #[test]
    fn strips_sub_and_sup_tags() {
        assert_eq!(strip_md_inline("H<sub>2</sub>O"), "H2O");
        assert_eq!(strip_md_inline("x<sup>2</sup>"), "x2");
    }

    #[test]
    fn strips_mark_ins_del_tags() {
        assert_eq!(strip_md_inline("<mark>highlighted</mark>"), "highlighted");
        assert_eq!(strip_md_inline("<ins>added</ins>"), "added");
        assert_eq!(strip_md_inline("<del>removed</del>"), "removed");
    }

    #[test]
    fn br_tag_becomes_space() {
        assert_eq!(strip_md_inline("line one<br>line two"), "line one line two");
        assert_eq!(strip_md_inline("line one<br/>line two"), "line one line two");
        assert_eq!(strip_md_inline("line one<br />line two"), "line one line two");
    }

    #[test]
    fn strips_inline_html_inside_table_cell_with_pipes() {
        // Cell content like `line one<br>line two` — the pipe at the
        // outer table boundary is left alone because it's NOT an HTML
        // tag.
        assert_eq!(
            strip_md_inline("| line one<br>line two | second |"),
            "| line one line two | second |"
        );
    }

    #[test]
    fn strips_inline_html_combined_with_markdown_markers() {
        // Mirrors line 30-31 of samples/markdown/11-kitchen-sink.md.
        let input =
            r#"an <abbr title="Inter-Process Communication">IPC</abbr> abbreviation, a keyboard hint <kbd>Ctrl</kbd>+<kbd>K</kbd>"#;
        let stripped = strip_md_inline(input);
        assert!(
            stripped.contains("an IPC abbreviation"),
            "abbr should strip: {stripped:?}"
        );
        assert!(
            stripped.contains("Ctrl+K"),
            "kbd should strip without dropping the +: {stripped:?}"
        );
    }

    #[test]
    fn does_not_strip_unknown_html_tag() {
        // Unknown / block tag is left as-is so the matcher's fuzzy /
        // best-prefix tiers can still see structure.
        assert_eq!(strip_md_inline("<details>X</details>"), "<details>X</details>");
        assert_eq!(strip_md_inline("<custom-elem>X</custom-elem>"), "<custom-elem>X</custom-elem>");
    }

    #[test]
    fn does_not_strip_lonely_lt() {
        // Just a `<` shouldn't trigger HTML stripping.
        assert_eq!(strip_md_inline("a < b"), "a < b");
    }

    #[test]
    fn strip_inline_html_directly_returns_unchanged_without_lt() {
        assert_eq!(strip_inline_html("plain text"), "plain text");
    }

    #[test]
    fn strip_inline_html_handles_attribute_with_equals() {
        assert_eq!(
            strip_inline_html(r#"<span class="hl">text</span>"#),
            "text"
        );
    }
}
