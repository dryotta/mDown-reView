//! UAX #29 word tokenisation for the Group D-wire WordRange anchor.
//!
//! Produces a deterministic, language-agnostic word stream so the WordRange
//! anchor variant can refer to "word N..M on line K" across drift. Wraps
//! `unicode-segmentation`'s `UnicodeSegmentation::split_word_bound_indices`
//! and filters out segments that are pure whitespace or pure punctuation
//! (the UAX #29 algorithm yields one segment per boundary, including those
//! that are purely separators — a "word" stream callers actually want is
//! word-like only).
//!
//! Lives in core (no Tauri dep) so the IPC handler in
//! [`crate::commands::word_tokens`] is a one-line shim and the matcher
//! (iter 4) can call the same function.

use serde::{Deserialize, Serialize};
use unicode_segmentation::UnicodeSegmentation;

/// One word-like segment produced by [`tokenize_words`]. Byte offsets are
/// indexes into the original UTF-8 input — the renderer can map back to
/// rendered glyphs trivially.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WordSpan {
    pub start: u32,
    pub end: u32,
    pub text: String,
}

/// Tokenise `s` into UAX #29 word-like segments. Pure-whitespace and
/// pure-punctuation segments are dropped. Empty / whitespace-only inputs
/// yield an empty `Vec`.
pub fn tokenize_words(s: &str) -> Vec<WordSpan> {
    s.split_word_bound_indices()
        .filter_map(|(start, word)| {
            if word.is_empty() || word.chars().all(|c| !is_word_char(c)) {
                return None;
            }
            Some(WordSpan {
                start: start as u32,
                end: (start + word.len()) as u32,
                text: word.to_string(),
            })
        })
        .collect()
}

/// "Word-like" character predicate: alphanumeric, marks (combining), or
/// any non-ASCII non-whitespace non-punctuation char (catches CJK ideographs
/// and emoji that UAX #29 hands back as their own segments). Conservative
/// by design — a segment with even one word-like char survives the filter.
fn is_word_char(c: char) -> bool {
    if c.is_alphanumeric() {
        return true;
    }
    // Drop ASCII whitespace and ASCII punctuation; keep everything else
    // (CJK, emoji, combining marks, etc.).
    if c.is_ascii() {
        return false;
    }
    !c.is_whitespace()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_two_words() {
        let v = tokenize_words("hello world");
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].text, "hello");
        assert_eq!(v[0].start, 0);
        assert_eq!(v[0].end, 5);
        assert_eq!(v[1].text, "world");
        assert_eq!(v[1].start, 6);
        assert_eq!(v[1].end, 11);
    }

    #[test]
    fn cjk_segments_per_uax29() {
        // UAX #29 keeps Han runs as a single segment by default; the point
        // here is "we get at least one non-empty span and offsets are valid".
        let v = tokenize_words("日本語テスト");
        assert!(!v.is_empty(), "CJK input must produce at least one span");
        for span in &v {
            assert!(span.end > span.start);
            assert!(!span.text.is_empty());
        }
    }

    #[test]
    fn emoji_zwj_family_then_word() {
        let v = tokenize_words("👨\u{200D}👩\u{200D}👦 family");
        // Emoji ZWJ sequence is one segment, "family" is another.
        let texts: Vec<&str> = v.iter().map(|s| s.text.as_str()).collect();
        assert!(texts.contains(&"family"));
        assert!(v.iter().any(|s| s.text.contains('👨')));
    }

    #[test]
    fn rtl_word_then_ascii_word() {
        let v = tokenize_words("مرحبا world");
        let texts: Vec<&str> = v.iter().map(|s| s.text.as_str()).collect();
        assert!(texts.contains(&"مرحبا"));
        assert!(texts.contains(&"world"));
    }

    #[test]
    fn empty_string_yields_empty() {
        assert!(tokenize_words("").is_empty());
    }

    #[test]
    fn whitespace_only_yields_empty() {
        assert!(tokenize_words("   \t\n  ").is_empty());
    }

    #[test]
    fn hyphenation_default_uax29() {
        // UAX #29 default treats `-` as a word boundary, so "a-b" is two
        // word segments separated by punctuation. Pin the contract.
        let v = tokenize_words("a-b");
        let texts: Vec<&str> = v.iter().map(|s| s.text.as_str()).collect();
        assert_eq!(texts, vec!["a", "b"]);
    }
}
