//! Severity ordering + thread-level aggregation.
//!
//! MRSF stores severity as an optional lowercase string `"low" | "medium" | "high"`.
//! This module promotes those strings to a typed `Severity` enum with a strict
//! ordering (`High > Medium > Low > None`) and exposes helpers for picking the
//! "worst" severity across a comment thread (`max_severity`).

use crate::core::types::CommentThread;

/// Total order of severity for badge selection. `None` is the absence of any
/// severity tag — comments with no severity sort below `Low`.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    None,
    Low,
    Medium,
    High,
}

impl Severity {
    /// Parse the MRSF on-disk representation. Unknown strings (forward-compat
    /// or typos) collapse to `None` rather than failing — UI degrades silently
    /// rather than the whole sidecar refusing to load.
    ///
    /// Named `from_optional_str` (not `from_str`) to avoid the
    /// `std::str::FromStr::from_str` trait-method confusion: this helper
    /// accepts `Option<&str>` and is total (no `Result`), which would not
    /// satisfy `FromStr` anyway.
    pub fn from_optional_str(s: Option<&str>) -> Self {
        match s.map(str::to_ascii_lowercase).as_deref() {
            Some("high") => Severity::High,
            Some("medium") => Severity::Medium,
            Some("low") => Severity::Low,
            _ => Severity::None,
        }
    }
}

/// Compute the highest severity present in a thread (root + replies). Resolved
/// comments are still considered — caller filters resolved threads upstream
/// (the badge surfaces unresolved counts only).
pub fn max_severity(thread: &CommentThread) -> Severity {
    let mut best = Severity::from_optional_str(thread.root.comment.severity.as_deref());
    for reply in &thread.replies {
        let s = Severity::from_optional_str(reply.comment.severity.as_deref());
        if s > best {
            best = s;
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::types::{MatchedComment, MrsfComment};

    fn matched(severity: Option<&str>) -> MatchedComment {
        MatchedComment {
            comment: MrsfComment {
                id: "x".into(),
                author: "t".into(),
                timestamp: "2025-01-01T00:00:00Z".into(),
                text: String::new(),
                resolved: false,
                severity: severity.map(str::to_string),
                ..Default::default()
            },
            matched_line_number: 1,
            is_orphaned: false,
            anchored_text: None,
        }
    }

    #[test]
    fn ordering_high_beats_medium_beats_low_beats_none() {
        assert!(Severity::High > Severity::Medium);
        assert!(Severity::Medium > Severity::Low);
        assert!(Severity::Low > Severity::None);
    }

    #[test]
    fn parse_is_case_insensitive_and_lenient() {
        assert_eq!(Severity::from_optional_str(Some("HIGH")), Severity::High);
        assert_eq!(
            Severity::from_optional_str(Some("Medium")),
            Severity::Medium
        );
        assert_eq!(Severity::from_optional_str(Some("low")), Severity::Low);
        assert_eq!(Severity::from_optional_str(None), Severity::None);
        assert_eq!(Severity::from_optional_str(Some("oops")), Severity::None);
    }

    #[test]
    fn max_severity_picks_worst_in_thread() {
        let thread = CommentThread {
            root: matched(Some("low")),
            replies: vec![matched(Some("high")), matched(Some("medium"))],
        };
        assert_eq!(max_severity(&thread), Severity::High);
    }

    #[test]
    fn max_severity_none_when_all_unset() {
        let thread = CommentThread {
            root: matched(None),
            replies: vec![matched(None)],
        };
        assert_eq!(max_severity(&thread), Severity::None);
    }
}
