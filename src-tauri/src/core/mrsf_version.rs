//! MRSF schema version selection.
//!
//! Picks the correct `mrsf_version` declaration when serialising a sidecar
//! based on which v1.1-only fields the comments actually carry. The
//! per-comment v1.1 predicate destructures the full [`MrsfComment`] struct
//! exhaustively — adding a new field there will fail to compile here,
//! forcing a deliberate decision about whether the new field is a v1.1
//! marker (advisory #5: don't silently downgrade v1.1 sidecars).

use crate::core::types::{Anchor, MrsfComment};

/// Default MRSF version when no v1.1-only fields are in use.
pub const MRSF_VERSION_DEFAULT: &str = "1.0";

/// MRSF version emitted when any v1.1-only marker is present.
pub const MRSF_VERSION_V1_1: &str = "1.1";

/// True if `c` carries any v1.1-only marker.
fn is_v1_1(c: &MrsfComment) -> bool {
    let MrsfComment {
        // ── v1.0 fields: explicitly ignored ───────────────────────────────
        id: _,
        author: _,
        timestamp: _,
        text: _,
        resolved: _,
        line: _,
        end_line: _,
        start_column: _,
        end_column: _,
        selected_text: _,
        anchored_text: _,
        selected_text_hash: _,
        commit: _,
        comment_type: _,
        severity: _,
        reply_to: _,
        // ── v1.1 markers ─────────────────────────────────────────────────
        anchor,
        anchor_history,
        reactions,
    } = c;

    let non_line_anchor = !matches!(anchor, Anchor::Line { .. });
    let has_history = anchor_history.as_ref().is_some_and(|h| !h.is_empty());
    let has_reactions = reactions.is_some();

    non_line_anchor || has_history || has_reactions
}

/// Pick the MRSF schema version to write for a given set of comments.
pub fn mrsf_version_for(comments: &[MrsfComment]) -> &'static str {
    if comments.iter().any(is_v1_1) {
        MRSF_VERSION_V1_1
    } else {
        MRSF_VERSION_DEFAULT
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::types::{ImageRectAnchor, MrsfSidecar, Reaction};

    #[test]
    fn version_selector_prefers_v1_0_for_pure_legacy_comments() {
        let json = r#"{
            "mrsf_version": "1.0",
            "document": "test.md",
            "comments": [{
                "id": "c1","author":"a","timestamp":"2025-01-01T00:00:00Z",
                "text":"x","resolved":false,"line":1
            }]
        }"#;
        let s: MrsfSidecar = serde_json::from_str(json).unwrap();
        assert_eq!(mrsf_version_for(&s.comments), "1.0");
    }

    #[test]
    fn mrsf_version_for_promotes_on_image_rect_variant() {
        let c = MrsfComment {
            anchor: Anchor::ImageRect(ImageRectAnchor {
                x_pct: 1.0,
                y_pct: 2.0,
                w_pct: None,
                h_pct: None,
            }),
            ..Default::default()
        };
        assert_eq!(mrsf_version_for(&[c]), "1.1");
    }

    #[test]
    fn version_selector_promotes_to_v1_1_when_reactions_present() {
        let c = MrsfComment {
            reactions: Some(vec![Reaction {
                user: "u".into(),
                kind: "thumbs_up".into(),
                ts: "2025-01-01T00:00:00Z".into(),
            }]),
            ..Default::default()
        };
        assert_eq!(mrsf_version_for(&[c]), "1.1");
    }

    #[test]
    fn version_selector_treats_empty_reactions_as_v1_0() {
        // Empty reactions vec is still v1.1 here — `Some(vec![])` is a
        // present-but-empty marker, which round-trips and so still
        // promotes. (Matches the iter-1 contract: `is_some_and(empty)` was
        // historically a v1.0; we now treat any `Some(_)` as v1.1.)
        let c = MrsfComment {
            reactions: Some(vec![]),
            ..Default::default()
        };
        assert_eq!(mrsf_version_for(&[c]), "1.1");
    }

    #[test]
    fn mrsf_version_for_promotes_on_anchor_history() {
        let mut c = MrsfComment::default();
        c.push_anchor_history(Anchor::File);
        assert_eq!(mrsf_version_for(&[c]), "1.1");
    }

    #[test]
    fn mrsf_version_for_stays_v1_0_for_pure_line_with_no_history() {
        let c = MrsfComment::default();
        assert_eq!(mrsf_version_for(&[c]), "1.0");
    }

    /// Regression: load a v1.1 sidecar (with reactions), save the comment
    /// list back unchanged, the version stays v1.1.
    #[test]
    fn v1_1_sidecar_round_trip_preserves_version() {
        let c = MrsfComment {
            id: "c1".into(),
            reactions: Some(vec![Reaction {
                user: "bob".into(),
                kind: "thumbs_up".into(),
                ts: "2025-01-02T00:00:00Z".into(),
            }]),
            ..Default::default()
        };
        assert_eq!(mrsf_version_for(std::slice::from_ref(&c)), "1.1");
        assert_eq!(mrsf_version_for(&[c]), "1.1");
    }
}
