use crate::core::fuzzy::fuzzy_score;
use crate::core::types::{MatchedComment, MrsfComment};

const FUZZY_THRESHOLD: f64 = 0.6;

/// Match comments to file lines using the 4-step re-anchoring algorithm.
///
/// For each comment:
/// 1. Exact `selected_text` substring match (original line first, then full scan)
/// 2. Line fallback when no `selected_text` is present
/// 3. Fuzzy match via Levenshtein similarity
/// 4. Orphan at clamped line or 1
pub fn match_comments(comments: &[MrsfComment], file_lines: &[&str]) -> Vec<MatchedComment> {
    let line_count = file_lines.len() as u32;

    comments
        .iter()
        .map(|comment| {
            if line_count == 0 {
                return MatchedComment {
                    comment: comment.clone(),
                    matched_line_number: 1,
                    is_orphaned: true,
                    anchored_text: None,
                };
            }

            let orig_line = comment.line;
            let selected_text = comment.selected_text.as_deref();

            // File-level comments have no line and no selected_text —
            // they are always anchored at line 1 and never orphaned (#131).
            if orig_line.is_none() && selected_text.is_none() {
                return MatchedComment {
                    comment: comment.clone(),
                    matched_line_number: 1,
                    is_orphaned: false,
                    anchored_text: None,
                };
            }

            // Step 1: Exact selected_text match
            if let Some(sel) = selected_text {
                // Try at original line first
                if let Some(ol) = orig_line {
                    if ol >= 1 && ol <= line_count && file_lines[(ol - 1) as usize].contains(sel) {
                        return MatchedComment {
                            comment: comment.clone(),
                            matched_line_number: ol,
                            is_orphaned: false,
                            anchored_text: None,
                        };
                    }
                }
                // Search entire file
                for (i, line) in file_lines.iter().enumerate() {
                    if line.contains(sel) {
                        let new_line = (i as u32) + 1;
                        let mut c = comment.clone();
                        c.line = Some(new_line);
                        return MatchedComment {
                            comment: c,
                            matched_line_number: new_line,
                            is_orphaned: false,
                            anchored_text: None,
                        };
                    }
                }
            }

            // Step 2: Line/column fallback
            if let Some(ol) = orig_line {
                if ol >= 1 && ol <= line_count {
                    if selected_text.is_some() {
                        // Step 3: Fuzzy match (selected_text provided but exact failed)
                        if let Some(sel) = selected_text {
                            if let Some(fuzzy) = find_fuzzy_match(file_lines, sel, ol) {
                                let mut c = comment.clone();
                                c.line = Some(fuzzy.line);
                                return MatchedComment {
                                    comment: c,
                                    matched_line_number: fuzzy.line,
                                    is_orphaned: false,
                                    anchored_text: Some(fuzzy.anchored_text),
                                };
                            }
                        }
                        // Had selected_text but couldn't find it → orphan
                        return MatchedComment {
                            comment: comment.clone(),
                            matched_line_number: ol,
                            is_orphaned: true,
                            anchored_text: None,
                        };
                    }
                    // Pure line fallback (no selected_text)
                    return MatchedComment {
                        comment: comment.clone(),
                        matched_line_number: ol,
                        is_orphaned: false,
                        anchored_text: None,
                    };
                }
            }

            // Step 3: Fuzzy match (no valid line)
            if let Some(sel) = selected_text {
                let center = orig_line.unwrap_or(1);
                if let Some(fuzzy) = find_fuzzy_match(file_lines, sel, center) {
                    let mut c = comment.clone();
                    c.line = Some(fuzzy.line);
                    return MatchedComment {
                        comment: c,
                        matched_line_number: fuzzy.line,
                        is_orphaned: false,
                        anchored_text: Some(fuzzy.anchored_text),
                    };
                }
            }

            // Step 4: Orphan
            let fallback_line = match orig_line {
                Some(ol) => ol.min(line_count),
                None => 1,
            };
            MatchedComment {
                comment: comment.clone(),
                matched_line_number: fallback_line,
                is_orphaned: true,
                anchored_text: None,
            }
        })
        .collect()
}

struct FuzzyMatch {
    line: u32,
    anchored_text: String,
}

fn find_fuzzy_match(
    file_lines: &[&str],
    selected_text: &str,
    center_line: u32,
) -> Option<FuzzyMatch> {
    let mut best_line: Option<u32> = None;
    let mut best_score: f64 = 0.0;
    let mut best_text = String::new();

    for (i, file_line) in file_lines.iter().enumerate() {
        let score = fuzzy_score(selected_text, file_line);
        if score >= FUZZY_THRESHOLD && score > best_score {
            best_score = score;
            best_line = Some((i as u32) + 1);
            best_text = file_line.to_string();
        } else if score >= FUZZY_THRESHOLD
            && (score - best_score).abs() < f64::EPSILON
            && best_line.is_some()
        {
            let center_idx = (center_line as i64) - 1;
            let new_dist = ((i as i64) - center_idx).unsigned_abs();
            let old_dist = ((best_line.unwrap() as i64 - 1) - center_idx).unsigned_abs();
            if new_dist < old_dist {
                best_line = Some((i as u32) + 1);
                best_text = file_line.to_string();
            }
        }
    }

    best_line.map(|line| FuzzyMatch {
        line,
        anchored_text: best_text,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_comment(id: &str, line: Option<u32>, selected_text: Option<&str>) -> MrsfComment {
        MrsfComment {
            id: id.to_string(),
            author: "test".to_string(),
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            text: "comment text".to_string(),
            resolved: false,
            line,
            end_line: None,
            start_column: None,
            end_column: None,
            selected_text: selected_text.map(|s| s.to_string()),
            anchored_text: None,
            selected_text_hash: None,
            commit: None,
            comment_type: None,
            severity: None,
            reply_to: None,
            ..Default::default()
        }
    }

    #[test]
    fn exact_match_at_original_line() {
        let comments = vec![make_comment("c1", Some(2), Some("hello world"))];
        let lines = vec!["first line", "hello world here", "third line"];
        let result = match_comments(&comments, &lines);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].matched_line_number, 2);
        assert!(!result[0].is_orphaned);
    }

    #[test]
    fn exact_match_elsewhere() {
        let comments = vec![make_comment("c1", Some(1), Some("hello world"))];
        let lines = vec!["first line", "second line", "hello world here"];
        let result = match_comments(&comments, &lines);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].matched_line_number, 3);
        assert!(!result[0].is_orphaned);
        assert_eq!(result[0].comment.line, Some(3));
    }

    #[test]
    fn line_fallback_no_selected_text() {
        let comments = vec![make_comment("c1", Some(2), None)];
        let lines = vec!["first", "second", "third"];
        let result = match_comments(&comments, &lines);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].matched_line_number, 2);
        assert!(!result[0].is_orphaned);
    }

    #[test]
    fn fuzzy_match_above_threshold() {
        let comments = vec![make_comment("c1", Some(1), Some("hello warld"))];
        let lines = vec!["first line", "hello world", "third line"];
        let result = match_comments(&comments, &lines);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].matched_line_number, 2);
        assert!(!result[0].is_orphaned);
        assert!(result[0].anchored_text.is_some());
        assert_eq!(result[0].anchored_text.as_deref(), Some("hello world"));
    }

    #[test]
    fn fuzzy_match_below_threshold_orphan() {
        let comments = vec![make_comment(
            "c1",
            Some(1),
            Some("completely different text xyz"),
        )];
        let lines = vec!["aaa", "bbb", "ccc"];
        let result = match_comments(&comments, &lines);
        assert_eq!(result.len(), 1);
        assert!(result[0].is_orphaned);
        assert_eq!(result[0].matched_line_number, 1);
    }

    #[test]
    fn empty_file_orphans_all() {
        let comments = vec![
            make_comment("c1", Some(5), Some("something")),
            make_comment("c2", None, None),
        ];
        let lines: Vec<&str> = vec![];
        let result = match_comments(&comments, &lines);
        assert_eq!(result.len(), 2);
        assert!(result[0].is_orphaned);
        assert_eq!(result[0].matched_line_number, 1);
        assert!(result[1].is_orphaned);
        assert_eq!(result[1].matched_line_number, 1);
    }

    #[test]
    fn empty_comments_returns_empty() {
        let comments: Vec<MrsfComment> = vec![];
        let lines = vec!["line one", "line two"];
        let result = match_comments(&comments, &lines);
        assert!(result.is_empty());
    }

    #[test]
    fn case_insensitive_fuzzy() {
        // "Hello World" vs "hello world" → exact match after lowering → score 1.0
        // But "Hello World" is selected_text, and file has "HELLO WORLD" on line 2.
        // Exact substring match is case-sensitive, so it won't match at step 1.
        // Fuzzy score("Hello World", "HELLO WORLD") → 1.0 after lowering → matches.
        let comments = vec![make_comment("c1", Some(1), Some("Hello World"))];
        let lines = vec!["first line", "HELLO WORLD", "third line"];
        let result = match_comments(&comments, &lines);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].matched_line_number, 2);
        assert!(!result[0].is_orphaned);
        assert!(result[0].anchored_text.is_some());
    }

    #[test]
    fn prefer_closest_line_on_equal_score() {
        // Use texts that are NOT substring matches but get equal Levenshtein scores.
        // fuzzy_score("abcdef", "abcXef"): lev distance = 1, max_len = 6, score = 5/6 ≈ 0.833
        // fuzzy_score("abcdef", "abcYef"): same score = 0.833
        // Line 1 (idx 0) dist from center 3 = |0 - 2| = 2
        // Line 4 (idx 3) dist from center 3 = |3 - 2| = 1 → closer, should win
        let comments = vec![make_comment("c1", Some(3), Some("abcdef"))];
        let lines = vec!["abcXef", "something", "else", "abcYef"];
        let result = match_comments(&comments, &lines);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].matched_line_number, 4);
        assert!(!result[0].is_orphaned);
    }

    #[test]
    fn orphan_fallback_line_clamped() {
        let comments = vec![make_comment("c1", Some(100), None)];
        let lines = vec!["only", "three", "lines"];
        // line 100 > line_count 3, so step 2 doesn't apply → step 4 orphan
        // fallback_line = min(100, 3) = 3
        let result = match_comments(&comments, &lines);
        assert_eq!(result.len(), 1);
        assert!(result[0].is_orphaned);
        assert_eq!(result[0].matched_line_number, 3);
    }

    #[test]
    fn file_level_comment_never_orphaned() {
        // File-level comments (no line, no selected_text) should never show
        // the orphan warning — they are anchored to the file itself (#131).
        let comments = vec![make_comment("c1", None, None)];
        let lines = vec!["some content", "more content"];
        let result = match_comments(&comments, &lines);
        assert_eq!(result.len(), 1);
        assert!(!result[0].is_orphaned);
        assert_eq!(result[0].matched_line_number, 1);
    }

    // --- Tests for levenshtein and fuzzy_score live in core::fuzzy ---
}
