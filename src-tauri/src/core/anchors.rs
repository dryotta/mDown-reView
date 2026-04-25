use sha2::{Digest, Sha256};

use crate::core::types::Anchor;

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

/// Resolve a Line anchor — wraps the existing line-targeting algorithm
/// (kept in `crate::core::matching`). Group A wires the dispatch surface;
/// the dispatch from the matcher will land in Group B.
// B-wave: real heuristics land in iter <n>; for now the line algorithm
// is the matcher's responsibility, this stub just classifies outcomes.
pub fn resolve_line(anchor: &Anchor) -> MatchOutcome {
    debug_assert!(matches!(anchor, Anchor::Line { .. }));
    MatchOutcome::Exact
}

/// Resolve a File anchor — always exact (whole-file scope).
pub fn resolve_file(_anchor: &Anchor) -> MatchOutcome {
    MatchOutcome::Exact
}

// B-wave: real heuristics land in iter <n>.
pub fn resolve_image_rect(_anchor: &Anchor) -> MatchOutcome {
    MatchOutcome::FileLevel
}

// B-wave: real heuristics land in iter <n>.
pub fn resolve_csv_cell(_anchor: &Anchor) -> MatchOutcome {
    MatchOutcome::FileLevel
}

// B-wave: real heuristics land in iter <n>.
pub fn resolve_json_path(_anchor: &Anchor) -> MatchOutcome {
    MatchOutcome::FileLevel
}

// B-wave: real heuristics land in iter <n>.
pub fn resolve_html_range(_anchor: &Anchor) -> MatchOutcome {
    MatchOutcome::FileLevel
}

// B-wave: real heuristics land in iter <n>.
pub fn resolve_html_element(_anchor: &Anchor) -> MatchOutcome {
    MatchOutcome::FileLevel
}

/// Stub matcher for [`Anchor::WordRange`]. Iter 3 ships only the wire
/// variant + Rust tokenizer; the real word-anchored heuristic (UAX #29
/// stream + fuzzy-on-line-text-hash recovery) is deferred to iter 4. Until
/// then the resolver returns `FileLevel`, matching the rung the other
/// typed-variant stubs use.
pub fn resolve_word_range(_anchor: &Anchor) -> MatchOutcome {
    MatchOutcome::FileLevel
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
        assert_eq!(anchor.selected_text_hash.as_deref(), Some(expected_hash.as_str()));
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

    // ── B7: per-variant stub-dispatch tests ───────────────────────────────
    //
    // The five non-line resolvers are FileLevel stubs in iter 2 (real
    // heuristics land in a later wave). These tests pin the dispatch
    // contract so a future drift between the matcher and the per-variant
    // dispatch fails loudly instead of silently down-grading anchors.

    use crate::core::types::{
        Anchor, CsvCellAnchor, HtmlElementAnchor, HtmlRangeAnchor, ImageRectAnchor,
        JsonPathAnchor, WordRangePayload,
    };

    #[test]
    fn resolve_image_rect_returns_file_level() {
        let a = Anchor::ImageRect(ImageRectAnchor {
            x_pct: 0.0,
            y_pct: 0.0,
            w_pct: None,
            h_pct: None,
        });
        assert_eq!(resolve_image_rect(&a), MatchOutcome::FileLevel);
    }

    #[test]
    fn resolve_csv_cell_returns_file_level() {
        let a = Anchor::CsvCell(CsvCellAnchor {
            row_idx: 0,
            col_idx: 0,
            col_header: "h".into(),
            primary_key_col: None,
            primary_key_value: None,
        });
        assert_eq!(resolve_csv_cell(&a), MatchOutcome::FileLevel);
    }

    #[test]
    fn resolve_json_path_returns_file_level() {
        let a = Anchor::JsonPath(JsonPathAnchor {
            json_path: "$.a".into(),
            scalar_text: None,
        });
        assert_eq!(resolve_json_path(&a), MatchOutcome::FileLevel);
    }

    #[test]
    fn resolve_html_range_returns_file_level() {
        let a = Anchor::HtmlRange(HtmlRangeAnchor {
            selector_path: "p".into(),
            start_offset: 0,
            end_offset: 0,
            selected_text: "".into(),
        });
        assert_eq!(resolve_html_range(&a), MatchOutcome::FileLevel);
    }

    #[test]
    fn resolve_html_element_returns_file_level() {
        let a = Anchor::HtmlElement(HtmlElementAnchor {
            selector_path: "div".into(),
            tag: "div".into(),
            text_preview: "".into(),
        });
        assert_eq!(resolve_html_element(&a), MatchOutcome::FileLevel);
    }

    #[test]
    fn resolve_word_range_returns_file_level() {
        let a = Anchor::WordRange(WordRangePayload {
            start_word: 0,
            end_word: 1,
            line: 1,
            snippet: "hello world".into(),
            line_text_hash: "0".repeat(64),
        });
        assert_eq!(resolve_word_range(&a), MatchOutcome::FileLevel);
    }
}
