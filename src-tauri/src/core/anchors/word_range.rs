use super::{compute_selected_text_hash, MatchOutcome};
use crate::core::types::WordRangePayload;

/// Resolve a [`WordRangePayload`] against the file's lines. The targeted
/// line is checked first via `line_text_hash` for an exact match; if the
/// line drifted we fall back to a snippet substring search across all lines
/// (`Fuzzy`). Anything else is `Orphan`.
pub(crate) fn resolve(p: &WordRangePayload, lines: &[String]) -> MatchOutcome {
    let idx = (p.line.saturating_sub(1)) as usize;
    let Some(line_text) = lines.get(idx) else {
        return MatchOutcome::Orphan;
    };

    if compute_selected_text_hash(line_text) == p.line_text_hash {
        return MatchOutcome::Exact;
    }

    for l in lines {
        if l.contains(p.snippet.as_str()) {
            return MatchOutcome::Fuzzy;
        }
    }
    MatchOutcome::Orphan
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(line: u32, snippet: &str, hash: &str) -> WordRangePayload {
        WordRangePayload {
            start_word: 0,
            end_word: 1,
            line,
            snippet: snippet.into(),
            line_text_hash: hash.into(),
        }
    }

    #[test]
    fn hash_matches_exact() {
        let lines = vec!["alpha beta gamma".to_string(), "second line".to_string()];
        let h = compute_selected_text_hash(&lines[0]);
        assert_eq!(
            resolve(&payload(1, "alpha", &h), &lines),
            MatchOutcome::Exact
        );
    }

    #[test]
    fn hash_differs_snippet_found_fuzzy() {
        let lines = vec!["original line".to_string(), "needle in haystack".to_string()];
        let stale = "0".repeat(64);
        assert_eq!(
            resolve(&payload(1, "needle", &stale), &lines),
            MatchOutcome::Fuzzy
        );
    }

    #[test]
    fn hash_differs_snippet_missing_orphan() {
        let lines = vec!["something else entirely".to_string()];
        let stale = "0".repeat(64);
        assert_eq!(
            resolve(&payload(1, "needle", &stale), &lines),
            MatchOutcome::Orphan
        );
    }

    #[test]
    fn line_out_of_bounds_orphan() {
        let lines = vec!["only line".to_string()];
        let stale = "0".repeat(64);
        assert_eq!(
            resolve(&payload(99, "anything", &stale), &lines),
            MatchOutcome::Orphan
        );
    }
}
