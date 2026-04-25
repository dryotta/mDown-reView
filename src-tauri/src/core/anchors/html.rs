use std::sync::OnceLock;

use regex::Regex;

use super::MatchOutcome;
use crate::core::types::{HtmlElementAnchor, HtmlRangeAnchor};

/// One parsed HTML element: tag name (lowercased) and inner text with any
/// nested tags stripped. Built once per file via [`extract_tags`].
pub(crate) struct HtmlTag {
    pub tag: String,
    pub text_content: String,
}

static OPEN_RE: OnceLock<Regex> = OnceLock::new();
static STRIP_RE: OnceLock<Regex> = OnceLock::new();

fn open_re() -> &'static Regex {
    // No backreferences (regex crate limitation): match opener only;
    // closers are paired up below in [`extract_tags`] by case-insensitive
    // `</tag` substring search.
    OPEN_RE.get_or_init(|| Regex::new(r"(?si)<(\w+)[^>]*>").unwrap())
}

fn strip_re() -> &'static Regex {
    STRIP_RE.get_or_init(|| Regex::new(r"<[^>]+>").unwrap())
}

fn strip_inner_tags(s: &str) -> String {
    strip_re().replace_all(s, "").to_string()
}

/// Best-effort tag extractor — not a real HTML parser, just enough to
/// recover element/text pairs for anchor matching. Lean: regex over a
/// tokenizer is ~30 lines vs. pulling `html5ever`.
pub(crate) fn extract_tags(bytes: &[u8]) -> Vec<HtmlTag> {
    let text = String::from_utf8_lossy(bytes);
    let s: &str = text.as_ref();
    let lower = s.to_ascii_lowercase();
    let mut out = Vec::new();
    for cap in open_re().captures_iter(s) {
        let opener = cap.get(0).expect("regex always captures group 0");
        let tag = cap[1].to_ascii_lowercase();
        let after_start = opener.end();
        let needle = format!("</{tag}");
        if let Some(rel) = lower[after_start..].find(&needle) {
            let close_pos = after_start + rel;
            out.push(HtmlTag {
                tag,
                text_content: strip_inner_tags(&s[after_start..close_pos]),
            });
        }
    }
    out
}

/// Resolve an [`HtmlElementAnchor`]: tag + preview text must match.
pub(crate) fn resolve_element(p: &HtmlElementAnchor, tags: &[HtmlTag]) -> MatchOutcome {
    let tag_lower = p.tag.to_ascii_lowercase();
    for t in tags {
        if t.tag == tag_lower && t.text_content.contains(p.text_preview.as_str()) {
            return MatchOutcome::Exact;
        }
    }
    if tags.iter().any(|t| t.tag == tag_lower) {
        MatchOutcome::FileLevel
    } else {
        MatchOutcome::Orphan
    }
}

/// Resolve an [`HtmlRangeAnchor`]: search the joined text content of all
/// extracted tags for the recorded selection.
pub(crate) fn resolve_range(p: &HtmlRangeAnchor, tags: &[HtmlTag]) -> MatchOutcome {
    if p.selected_text.is_empty() {
        return MatchOutcome::FileLevel;
    }
    let full = tags
        .iter()
        .map(|t| t.text_content.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    if full.contains(p.selected_text.as_str()) {
        MatchOutcome::Exact
    } else if !tags.is_empty() {
        MatchOutcome::FileLevel
    } else {
        MatchOutcome::Orphan
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn html_tags() -> Vec<HtmlTag> {
        extract_tags(b"<html><body><p>Hello world</p><div>Greetings, friend.</div></body></html>")
    }

    fn elem(tag: &str, preview: &str) -> HtmlElementAnchor {
        HtmlElementAnchor {
            selector_path: String::new(),
            tag: tag.into(),
            text_preview: preview.into(),
        }
    }

    fn range(text: &str) -> HtmlRangeAnchor {
        HtmlRangeAnchor {
            selector_path: String::new(),
            start_offset: 0,
            end_offset: 0,
            selected_text: text.into(),
        }
    }

    // ── element ─────────────────────────────────────────────────────────

    #[test]
    fn tag_and_text_match_exact() {
        assert_eq!(
            resolve_element(&elem("p", "Hello"), &html_tags()),
            MatchOutcome::Exact
        );
    }

    #[test]
    fn tag_exists_text_changed_file_level() {
        assert_eq!(
            resolve_element(&elem("p", "Goodbye"), &html_tags()),
            MatchOutcome::FileLevel
        );
    }

    #[test]
    fn tag_missing_orphan() {
        assert_eq!(
            resolve_element(&elem("section", "anything"), &html_tags()),
            MatchOutcome::Orphan
        );
    }

    #[test]
    fn case_insensitive_tag_exact() {
        let tags = extract_tags(b"<DIV>Big shouty text</DIV>");
        assert_eq!(
            resolve_element(&elem("div", "Big shouty"), &tags),
            MatchOutcome::Exact
        );
    }

    // ── range ───────────────────────────────────────────────────────────

    #[test]
    fn text_found_exact() {
        assert_eq!(
            resolve_range(&range("Hello world"), &html_tags()),
            MatchOutcome::Exact
        );
    }

    #[test]
    fn text_missing_tags_exist_file_level() {
        assert_eq!(
            resolve_range(&range("nowhere to be found"), &html_tags()),
            MatchOutcome::FileLevel
        );
    }

    #[test]
    fn empty_doc_orphan() {
        assert_eq!(resolve_range(&range("anything"), &[]), MatchOutcome::Orphan);
    }

    #[test]
    fn empty_selected_text_file_level() {
        assert_eq!(
            resolve_range(&range(""), &html_tags()),
            MatchOutcome::FileLevel
        );
    }
}
