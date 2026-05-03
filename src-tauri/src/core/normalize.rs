//! Text normalization used by the multi-line selection matcher.
//!
//! The visual-mode (rendered markdown) selection matcher needs to compare
//! text the user **saw on screen** (`window.getSelection().toString()`)
//! against the **source bytes** of the markdown file. Three classes of
//! mismatch wreck a naïve `source.contains(selection)`:
//!
//! 1. **Whitespace** — rendered text usually collapses runs of
//!    whitespace; source can carry tabs, NBSP, U+2028 (LS), U+2029 (PS),
//!    or hard-wrap soft line-breaks. CR/LF noise creeps in on Windows.
//! 2. **Smart punctuation** — autocorrect / paste-from-web turns ASCII
//!    `'`, `"`, `-` into `\u{2018}\u{2019}\u{201C}\u{201D}\u{2013}\u{2014}`.
//!    Either side may carry either form depending on what was authored
//!    and what `react-markdown` rendered.
//! 3. **Inline-formatting markers + inline HTML** — handled by
//!    `core::md_strip` (strips `**bold**`, `<kbd>…</kbd>`, etc.); not
//!    addressed here.
//!
//! Two intentionally separate normalizers live in this module:
//!
//! - [`normalize_whitespace`] — only collapses whitespace and folds
//!   "weird" spaces to ASCII space. Cheap; safe to apply universally.
//! - [`normalize_lossy`] — also folds smart quotes/dashes to ASCII.
//!   Used as a *fallback* form so the strict raw byte form gets first
//!   crack at exact matching before we pay the over-folding tax.
//!
//! Both functions return `String` (not `&str`) because the dominant
//! caller is the `RenderedProjection` builder, which discards the
//! input after normalization. Stable across calls / O(n) per call.

/// Collapse all runs of whitespace (spaces, tabs, CR, LF, NBSP,
/// ideographic space, line separators) into a single ASCII space, and
/// trim leading + trailing whitespace.
///
/// Used by both the projection builder and the query normalizer so
/// rendered-text selections that pass through `getSelection().toString()`
/// (which the browser already collapses) match source bytes after the
/// projection's own collapse.
pub fn normalize_whitespace(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut last_was_space = true; // suppresses leading whitespace
    for c in input.chars() {
        if is_normalizable_whitespace(c) {
            if !last_was_space {
                out.push(' ');
                last_was_space = true;
            }
        } else {
            out.push(c);
            last_was_space = false;
        }
    }
    // Trim trailing space (added by the loop above).
    if out.ends_with(' ') {
        out.pop();
    }
    out
}

/// Stricter normalization for fallback substring search: applies
/// [`normalize_whitespace`] **and** folds smart punctuation back to
/// ASCII equivalents.
///
/// Folded characters:
///   `\u{00A0}`   non-breaking space            → ` `
///   `\u{2013}`   en dash                       → `-`
///   `\u{2014}`   em dash                       → `-`
///   `\u{2010}` to `\u{2015}` (other dashes)    → `-`
///   `\u{2018}`, `\u{2019}` curly single quote → `'`
///   `\u{201A}`, `\u{201B}` low/high single   → `'`
///   `\u{201C}`, `\u{201D}` curly double quote → `"`
///   `\u{201E}`, `\u{201F}` low/high double  → `"`
///   `\u{2026}`   horizontal ellipsis           → `...`
///   `\u{00AB}`, `\u{00BB}` guillemets         → `"`
///   `\u{2039}`, `\u{203A}` single guillemets  → `'`
///
/// Applied AFTER whitespace normalization so the smart-quote pass
/// only has to look at one character at a time.
pub fn normalize_lossy(input: &str) -> String {
    let ws = normalize_whitespace(input);
    let mut out = String::with_capacity(ws.len());
    for c in ws.chars() {
        match c {
            // Curly single quotes / variants
            '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}'
            | '\u{2039}' | '\u{203A}' | '\u{0060}' | '\u{00B4}' => out.push('\''),
            // Curly double quotes / guillemets
            '\u{201C}' | '\u{201D}' | '\u{201E}' | '\u{201F}'
            | '\u{00AB}' | '\u{00BB}' => out.push('"'),
            // Dash variants
            '\u{2010}' | '\u{2011}' | '\u{2012}' | '\u{2013}' | '\u{2014}' | '\u{2015}'
            | '\u{2212}' => out.push('-'),
            // Ellipsis → three dots so a selection rendered as "..."
            // matches a source containing the single-glyph form.
            '\u{2026}' => out.push_str("..."),
            other => out.push(other),
        }
    }
    out
}

/// Whitespace that should collapse to a single ASCII space. Mirrors the
/// browser's default rendering of selectable text:
///   ASCII space, tab, CR, LF, NBSP, NEL, ideographic space, OSM/EM/EN
///   spaces, line/paragraph separators, zero-width whitespace.
#[inline]
fn is_normalizable_whitespace(c: char) -> bool {
    matches!(
        c,
        ' ' | '\t' | '\r' | '\n'
        | '\u{0085}' // NEL
        | '\u{00A0}' // NBSP
        | '\u{1680}' // OGHAM SPACE
        | '\u{2000}'..='\u{200A}' // EN/EM/THIN/HAIR/etc spaces
        | '\u{2028}' | '\u{2029}' // LS / PS
        | '\u{202F}' | '\u{205F}' // narrow NBSP / medium math
        | '\u{3000}' // ideographic space
        | '\u{FEFF}' // ZERO-WIDTH NO-BREAK SPACE / BOM
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collapses_runs_of_whitespace_to_single_space() {
        assert_eq!(normalize_whitespace("a   b\t\tc"), "a b c");
    }

    #[test]
    fn collapses_newlines_to_single_space() {
        assert_eq!(normalize_whitespace("first\nsecond"), "first second");
        assert_eq!(normalize_whitespace("a\r\nb"), "a b");
    }

    #[test]
    fn trims_leading_and_trailing_whitespace() {
        assert_eq!(normalize_whitespace("   hello   "), "hello");
        assert_eq!(normalize_whitespace("\nleading"), "leading");
        assert_eq!(normalize_whitespace("trailing\n"), "trailing");
    }

    #[test]
    fn folds_nbsp_and_other_unicode_spaces_to_ascii_space() {
        // NBSP, ideographic space, line separator
        let s = "a\u{00A0}b\u{3000}c\u{2028}d";
        assert_eq!(normalize_whitespace(s), "a b c d");
    }

    #[test]
    fn returns_empty_for_only_whitespace() {
        assert_eq!(normalize_whitespace("   \t\n  "), "");
        assert_eq!(normalize_whitespace(""), "");
    }

    #[test]
    fn lossy_folds_smart_quotes_to_ascii() {
        assert_eq!(normalize_lossy("\u{201C}hi\u{201D}"), "\"hi\"");
        assert_eq!(normalize_lossy("don\u{2019}t"), "don't");
    }

    #[test]
    fn lossy_folds_dashes_to_ascii_hyphen() {
        assert_eq!(normalize_lossy("a\u{2014}b"), "a-b");
        assert_eq!(normalize_lossy("a\u{2013}b"), "a-b");
        assert_eq!(normalize_lossy("a\u{2212}b"), "a-b");
    }

    #[test]
    fn lossy_expands_ellipsis() {
        assert_eq!(normalize_lossy("wait\u{2026}"), "wait...");
    }

    #[test]
    fn lossy_keeps_normal_punctuation_and_alphanumerics() {
        assert_eq!(normalize_lossy("Hello, world! 42"), "Hello, world! 42");
    }

    #[test]
    fn whitespace_does_not_eat_smart_quotes() {
        // Whitespace pass alone must not touch quotes.
        assert_eq!(normalize_whitespace("\u{201C}hi\u{201D}"), "\u{201C}hi\u{201D}");
    }

    #[test]
    fn lossy_idempotent_when_no_smart_chars_present() {
        let s = "plain ascii text";
        assert_eq!(normalize_lossy(s), s);
    }
}
