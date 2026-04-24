use sha2::{Digest, Sha256};

/// MRSF §6.2: max selected_text length
pub const SELECTED_TEXT_MAX_LENGTH: usize = 4096;

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
}
