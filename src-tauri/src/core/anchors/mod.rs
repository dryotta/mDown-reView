use std::cell::OnceCell;

#[cfg(test)]
use std::cell::Cell;

use sha2::{Digest, Sha256};

use crate::core::types::Anchor;

mod csv_cell;
mod html;
mod image_rect;
mod json_path;
mod word_range;

#[cfg(test)]
thread_local! {
    /// Test-only counter incremented every time `LazyParsedDoc::lines()`
    /// initializes its `OnceCell` line cache. Per-thread so concurrent unit
    /// tests cannot pollute each other's reads (cargo runs tests in
    /// parallel by default; a `static AtomicUsize` raced).
    pub static LINES_INIT_COUNT: Cell<usize> = const { Cell::new(0) };
}

/// Per-file lazily-parsed view of bytes used by [`resolve_anchor`]. Each
/// representation (UTF-8 line split, CSV, JSON, HTML tag soup) is computed
/// at most once via [`OnceCell`]: callers may resolve N anchors against
/// the same file without re-parsing.
///
/// Single-thread only (`OnceCell` from `std::cell`). `get_file_comments`
/// is a synchronous Tauri command that runs on its calling thread; if a
/// future caller needs cross-thread sharing, swap to `std::sync::OnceLock`.
pub struct LazyParsedDoc {
    bytes: Vec<u8>,
    line_cache: OnceCell<Vec<String>>,
    csv_cache: OnceCell<Option<csv_cell::CsvDoc>>,
    json_cache: OnceCell<Option<serde_json::Value>>,
    html_cache: OnceCell<Vec<html::HtmlTag>>,
}

impl LazyParsedDoc {
    pub fn new(bytes: Vec<u8>) -> Self {
        Self {
            bytes,
            line_cache: OnceCell::new(),
            csv_cache: OnceCell::new(),
            json_cache: OnceCell::new(),
            html_cache: OnceCell::new(),
        }
    }

    pub fn lines(&self) -> &[String] {
        self.line_cache.get_or_init(|| {
            #[cfg(test)]
            LINES_INIT_COUNT.with(|c| c.set(c.get() + 1));
            String::from_utf8_lossy(&self.bytes)
                .lines()
                .map(|l| l.to_string())
                .collect()
        })
    }

    pub(crate) fn csv(&self) -> Option<&csv_cell::CsvDoc> {
        self.csv_cache
            .get_or_init(|| csv_cell::parse_csv(&self.bytes).ok())
            .as_ref()
    }

    pub(crate) fn json(&self) -> Option<&serde_json::Value> {
        self.json_cache
            .get_or_init(|| serde_json::from_slice(&self.bytes).ok())
            .as_ref()
    }

    pub(crate) fn html_tags(&self) -> &[html::HtmlTag] {
        self.html_cache
            .get_or_init(|| html::extract_tags(&self.bytes))
    }
}

/// Dispatcher for typed anchors. Line/File arms are kept for completeness,
/// but the production hot-path (`get_file_comments`) routes those two
/// variants through the existing `match_comments` batch algorithm and only
/// calls this dispatcher for the typed anchor variants.
pub fn resolve_anchor(anchor: &Anchor, doc: &LazyParsedDoc) -> MatchOutcome {
    match anchor {
        Anchor::Line { .. } => resolve_line(anchor, doc.lines()),
        Anchor::File => MatchOutcome::Exact,
        Anchor::ImageRect(p) => image_rect::resolve(p),
        Anchor::CsvCell(p) => csv_cell::resolve(p, doc.csv()),
        Anchor::JsonPath(p) => json_path::resolve(p, doc.json()),
        Anchor::HtmlRange(p) => html::resolve_range(p, doc.html_tags()),
        Anchor::HtmlElement(p) => html::resolve_element(p, doc.html_tags()),
        Anchor::WordRange(p) => word_range::resolve(p, doc.lines()),
    }
}

/// MRSF §6.2: max selected_text length
pub const SELECTED_TEXT_MAX_LENGTH: usize = 4096;

/// Outcome of a single anchor-resolve attempt. Per spec §7: every variant
/// falls back to `Anchor::File` and then `Orphan` if all match strategies
/// fail. The `FileLevel` rung is the soft fallback before orphaning.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MatchOutcome {
    Exact,
    Fuzzy,
    FileLevel,
    Orphan,
}

/// Resolve a Line anchor. The dispatcher includes this for completeness;
/// the line-targeting heuristic itself lives in `crate::core::matching`,
/// which `get_file_comments` continues to call as a batch algorithm.
pub fn resolve_line(anchor: &Anchor, _lines: &[String]) -> MatchOutcome {
    debug_assert!(matches!(anchor, Anchor::Line { .. }));
    MatchOutcome::Exact
}

/// Resolve a File anchor — always exact (whole-file scope).
pub fn resolve_file(_anchor: &Anchor) -> MatchOutcome {
    MatchOutcome::Exact
}

/// Compute SHA-256 hash of selected text, returned as lowercase hex string.
pub fn compute_selected_text_hash(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    let result = hasher.finalize();
    format!("{:x}", result)
}

/// Truncate selected_text to SELECTED_TEXT_MAX_LENGTH chars.
pub fn truncate_selected_text(text: &str) -> String {
    if text.chars().count() <= SELECTED_TEXT_MAX_LENGTH {
        return text.to_string();
    }
    text.chars().take(SELECTED_TEXT_MAX_LENGTH).collect()
}

/// Validate and clamp targeting fields per MRSF §7.1.
/// Returns corrected (line, end_line, start_column, end_column).
pub fn validate_targeting_fields(
    line: u32,
    end_line: u32,
    start_column: u32,
    end_column: u32,
) -> (u32, u32, u32, u32) {
    let clamped_end_line = if end_line < line { line } else { end_line };

    let clamped_end_column = if line == clamped_end_line && end_column < start_column {
        start_column
    } else {
        end_column
    };

    (line, clamped_end_line, start_column, clamped_end_column)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::types::CommentAnchor;

    fn create_line_anchor(line: u32) -> CommentAnchor {
        CommentAnchor {
            line,
            end_line: None,
            start_column: None,
            end_column: None,
            selected_text: None,
            selected_text_hash: None,
        }
    }

    fn create_selection_anchor(
        start_line: u32,
        end_line: u32,
        start_column: u32,
        end_column: u32,
        selected_text: &str,
    ) -> CommentAnchor {
        let (line, clamped_end_line, clamped_start_column, clamped_end_column) =
            validate_targeting_fields(start_line, end_line, start_column, end_column);
        let truncated = truncate_selected_text(selected_text);
        let hash = compute_selected_text_hash(&truncated);

        CommentAnchor {
            line,
            end_line: Some(clamped_end_line),
            start_column: Some(clamped_start_column),
            end_column: Some(clamped_end_column),
            selected_text: Some(truncated),
            selected_text_hash: Some(hash),
        }
    }

    #[test]
    fn sha256_known_value() {
        let hash = compute_selected_text_hash("hello");
        assert_eq!(
            hash,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn sha256_empty_string() {
        let hash = compute_selected_text_hash("");
        assert_eq!(
            hash,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn line_anchor_has_no_optionals() {
        let anchor = create_line_anchor(5);
        assert_eq!(anchor.line, 5);
        assert!(anchor.end_line.is_none());
        assert!(anchor.start_column.is_none());
        assert!(anchor.end_column.is_none());
        assert!(anchor.selected_text.is_none());
        assert!(anchor.selected_text_hash.is_none());
    }

    #[test]
    fn selection_anchor_basic() {
        let anchor = create_selection_anchor(10, 20, 1, 15, "some text");
        assert_eq!(anchor.line, 10);
        assert_eq!(anchor.end_line, Some(20));
        assert_eq!(anchor.start_column, Some(1));
        assert_eq!(anchor.end_column, Some(15));
        assert_eq!(anchor.selected_text.as_deref(), Some("some text"));
        assert!(anchor.selected_text_hash.is_some());
    }

    #[test]
    fn selection_anchor_truncates_text() {
        let long_text: String = "a".repeat(5000);
        let anchor = create_selection_anchor(1, 1, 0, 0, &long_text);
        assert_eq!(
            anchor.selected_text.as_ref().unwrap().chars().count(),
            SELECTED_TEXT_MAX_LENGTH
        );
    }

    #[test]
    fn selection_anchor_computes_hash() {
        let text = "hello world";
        let anchor = create_selection_anchor(1, 2, 0, 5, text);
        let expected_hash = compute_selected_text_hash(text);
        assert_eq!(
            anchor.selected_text_hash.as_deref(),
            Some(expected_hash.as_str())
        );
    }

    #[test]
    fn validate_clamps_end_line() {
        let (line, end_line, start_col, end_col) = validate_targeting_fields(10, 5, 0, 0);
        assert_eq!(line, 10);
        assert_eq!(end_line, 10);
        assert_eq!(start_col, 0);
        assert_eq!(end_col, 0);
    }

    #[test]
    fn validate_clamps_end_column_same_line() {
        let (line, end_line, start_col, end_col) = validate_targeting_fields(10, 10, 8, 3);
        assert_eq!(line, 10);
        assert_eq!(end_line, 10);
        assert_eq!(start_col, 8);
        assert_eq!(end_col, 8);
    }

    #[test]
    fn validate_no_clamp_different_lines() {
        let (line, end_line, start_col, end_col) = validate_targeting_fields(10, 20, 8, 3);
        assert_eq!(line, 10);
        assert_eq!(end_line, 20);
        assert_eq!(start_col, 8);
        assert_eq!(end_col, 3);
    }

    #[test]
    fn truncate_preserves_short_text() {
        let text = "short text";
        assert_eq!(truncate_selected_text(text), text);
    }
}

#[cfg(test)]
mod dispatch_tests {
    use super::*;
    use crate::core::types::{
        CsvCellAnchor, HtmlElementAnchor, HtmlRangeAnchor, ImageRectAnchor, JsonPathAnchor,
        WordRangePayload,
    };

    #[test]
    fn dispatch_image_rect() {
        let anchor = Anchor::ImageRect(ImageRectAnchor {
            x_pct: 0.25,
            y_pct: 0.5,
            w_pct: Some(0.1),
            h_pct: Some(0.1),
        });
        let doc = LazyParsedDoc::new(Vec::new());
        assert_eq!(resolve_anchor(&anchor, &doc), MatchOutcome::Exact);
    }

    #[test]
    fn dispatch_csv_cell_no_doc() {
        // Non-CSV bytes (parse_csv only fails on non-UTF8; an HTML blob is
        // technically valid UTF-8 and parses as a single 1-row CSV with a
        // huge first cell, so the cell at (5,5) does NOT exist → Orphan).
        let anchor = Anchor::CsvCell(CsvCellAnchor {
            row_idx: 5,
            col_idx: 5,
            col_header: "name".into(),
            primary_key_col: None,
            primary_key_value: None,
        });
        let doc = LazyParsedDoc::new(b"<html><body>not csv</body></html>".to_vec());
        assert_eq!(resolve_anchor(&anchor, &doc), MatchOutcome::Orphan);
    }

    #[test]
    fn dispatch_json_path_with_doc() {
        // CSV-formatted bytes are not valid JSON → Orphan.
        let csv_bytes = b"id,name\n1,Alice\n".to_vec();
        let csv_doc = LazyParsedDoc::new(csv_bytes);
        let anchor = Anchor::JsonPath(JsonPathAnchor {
            json_path: "$.user.name".into(),
            scalar_text: None,
        });
        assert_eq!(resolve_anchor(&anchor, &csv_doc), MatchOutcome::Orphan);

        // Real JSON with a matching path → Exact.
        let json_bytes = br#"{"user":{"name":"Alice"}}"#.to_vec();
        let json_doc = LazyParsedDoc::new(json_bytes);
        assert_eq!(resolve_anchor(&anchor, &json_doc), MatchOutcome::Exact);
    }

    #[test]
    fn dispatch_html_range_with_text() {
        let bytes = b"<html><body><p>Hello world</p></body></html>".to_vec();
        let doc = LazyParsedDoc::new(bytes);
        let anchor = Anchor::HtmlRange(HtmlRangeAnchor {
            selector_path: String::new(),
            start_offset: 0,
            end_offset: 0,
            selected_text: "Hello world".into(),
        });
        assert_eq!(resolve_anchor(&anchor, &doc), MatchOutcome::Exact);
    }

    #[test]
    fn dispatch_html_element_tag_match() {
        let bytes = b"<html><body><p>Hello world</p></body></html>".to_vec();
        let doc = LazyParsedDoc::new(bytes);
        let anchor = Anchor::HtmlElement(HtmlElementAnchor {
            selector_path: String::new(),
            tag: "p".into(),
            text_preview: "Hello".into(),
        });
        assert_eq!(resolve_anchor(&anchor, &doc), MatchOutcome::Exact);
    }

    #[test]
    fn dispatch_word_range_hash_match() {
        let line_text = "alpha beta gamma";
        let bytes = format!("{line_text}\n").into_bytes();
        let doc = LazyParsedDoc::new(bytes);
        let anchor = Anchor::WordRange(WordRangePayload {
            start_word: 0,
            end_word: 1,
            line: 1,
            snippet: "alpha".into(),
            line_text_hash: compute_selected_text_hash(line_text),
        });
        assert_eq!(resolve_anchor(&anchor, &doc), MatchOutcome::Exact);
    }

    #[test]
    fn lazy_parsed_doc_caches_results() {
        let doc = LazyParsedDoc::new(b"line one\nline two\n".to_vec());
        let first: *const [String] = doc.lines();
        let second: *const [String] = doc.lines();
        // Both calls return the same backing slice — the OnceCell is hit
        // exactly once.
        assert!(std::ptr::eq(first, second));
    }
}
