//! Pure string-distance primitives used by the matching pipeline.
//!
//! Extracted from `matching.rs` to keep that module under the 400-line
//! per-file budget defined in `docs/architecture.md` (rule 23).

/// Fuzzy similarity score: 1.0 = identical, 0.0 = completely different.
/// Substring containment returns 0.9.
pub fn fuzzy_score(a: &str, b: &str) -> f64 {
    let al = a.to_lowercase();
    let al = al.trim();
    let bl = b.to_lowercase();
    let bl = bl.trim();

    if al == bl {
        return 1.0;
    }
    if bl.contains(al) || al.contains(bl) {
        return 0.9;
    }

    let max_len = al.len().max(bl.len());
    if max_len == 0 {
        return 1.0;
    }
    let dist = levenshtein(al, bl);
    1.0 - (dist as f64) / (max_len as f64)
}

/// Levenshtein distance using single-row DP, O(min(m,n)) memory.
pub fn levenshtein(a: &str, b: &str) -> usize {
    let a_chars: Vec<char> = a.chars().collect();
    let b_chars: Vec<char> = b.chars().collect();

    // Ensure b is the shorter side for O(min(m,n)) memory
    let (a_chars, b_chars) = if a_chars.len() < b_chars.len() {
        (b_chars, a_chars)
    } else {
        (a_chars, b_chars)
    };

    let m = a_chars.len();
    let n = b_chars.len();

    let mut prev: Vec<usize> = (0..=n).collect();
    let mut curr = vec![0; n + 1];

    for i in 1..=m {
        curr[0] = i;
        for j in 1..=n {
            let cost = if a_chars[i - 1] == b_chars[j - 1] {
                0
            } else {
                1
            };
            curr[j] = (prev[j] + 1).min(curr[j - 1] + 1).min(prev[j - 1] + cost);
        }
        std::mem::swap(&mut prev, &mut curr);
    }

    prev[n]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levenshtein_identical() {
        assert_eq!(levenshtein("abc", "abc"), 0);
    }

    #[test]
    fn levenshtein_empty() {
        assert_eq!(levenshtein("", "abc"), 3);
        assert_eq!(levenshtein("abc", ""), 3);
        assert_eq!(levenshtein("", ""), 0);
    }

    #[test]
    fn levenshtein_known_values() {
        assert_eq!(levenshtein("kitten", "sitting"), 3);
        assert_eq!(levenshtein("saturday", "sunday"), 3);
    }

    #[test]
    fn fuzzy_score_identical() {
        let s = fuzzy_score("hello", "hello");
        assert!((s - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn fuzzy_score_substring() {
        let s = fuzzy_score("hello", "say hello world");
        assert!((s - 0.9).abs() < f64::EPSILON);
    }

    #[test]
    fn fuzzy_score_empty_strings() {
        let s = fuzzy_score("", "");
        assert!((s - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn fuzzy_score_case_insensitive() {
        let s = fuzzy_score("Hello", "HELLO");
        assert!((s - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn fuzzy_score_trims_whitespace() {
        let s = fuzzy_score("  hello  ", "hello");
        assert!((s - 1.0).abs() < f64::EPSILON);
    }
}
