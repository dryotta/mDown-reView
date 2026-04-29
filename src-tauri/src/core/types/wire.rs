//! Wire-format serde repr for [`MrsfComment`] and [`Anchor`].
//!
//! `MrsfCommentRepr` mirrors the MRSF on-disk JSON/YAML schema (flat line
//! fields + optional `anchor_kind` discriminator + per-variant payload
//! object). `From`/`Into` conversions move between the public ergonomic
//! `MrsfComment` (with tagged `anchor: Anchor`) and the wire repr while
//! enforcing two invariants:
//!
//!   1. v1.0 sidecars (no `anchor_kind`, only flat `line`/`end_line`/…)
//!      round-trip byte-identically — `Anchor::Line` with no v1.1 markers
//!      serialises with NO `anchor_kind` field.
//!   2. `anchor_kind` discriminator and payload field MUST agree on read
//!      (e.g. `anchor_kind: "image_rect"` requires `image_rect: {...}`).

use serde::{Deserialize, Serialize};

use super::{
    Anchor, CsvCellAnchor, HtmlElementAnchor, HtmlRangeAnchor, ImageRectAnchor, JsonPathAnchor,
    MrsfComment, Reaction, WordRangePayload,
};
// Note: CsvCellAnchor, HtmlElementAnchor, HtmlRangeAnchor, ImageRectAnchor,
// JsonPathAnchor are still imported for MrsfCommentRepr backward compat fields.

/// `Default` is derived purely as the base for struct-update syntax in
/// [`From<MrsfComment> for MrsfCommentRepr`] — this lets the per-variant
/// arms enumerate only the fields they actually populate (rather than
/// repeating ~12 `None`s per arm). All required `String` / `bool` fields
/// default to empty/false, which is harmless because every conversion
/// path overwrites them.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub(super) struct MrsfCommentRepr {
    pub id: String,
    pub author: String,
    pub timestamp: String,
    pub text: String,
    pub resolved: bool,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub end_line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub start_column: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub end_column: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub selected_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub anchored_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub selected_text_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub commit: Option<String>,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none", default)]
    pub comment_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub severity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub reply_to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub anchor_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub image_rect: Option<ImageRectAnchor>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub csv_cell: Option<CsvCellAnchor>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub json_path: Option<JsonPathAnchor>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub html_range: Option<HtmlRangeAnchor>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub html_element: Option<HtmlElementAnchor>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub word_range: Option<WordRangePayload>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub anchor_history: Option<Vec<AnchorRepr>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub reactions: Option<Vec<Reaction>>,
}

/// Wire form for an Anchor inside `anchor_history`. Tagged via
/// `anchor_kind` + `anchor_data` payload — simpler than the flat layout
/// the top-level comment uses, since history entries don't share the
/// comment's flat line fields.
#[derive(Debug, Clone)]
pub(super) enum AnchorRepr {
    Line(LineAnchorPayload),
    File,
    WordRange(WordRangePayload),
    Unknown {
        kind: String,
        data: serde_json::Value,
    },
}

impl<'de> serde::Deserialize<'de> for AnchorRepr {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(serde::Deserialize)]
        struct RawAnchor {
            anchor_kind: String,
            #[serde(default)]
            anchor_data: serde_json::Value,
        }
        let raw = RawAnchor::deserialize(deserializer)?;
        match raw.anchor_kind.as_str() {
            "line" => {
                let payload: LineAnchorPayload = serde_json::from_value(raw.anchor_data)
                    .map_err(serde::de::Error::custom)?;
                Ok(AnchorRepr::Line(payload))
            }
            "file" => Ok(AnchorRepr::File),
            "word_range" => {
                let payload: WordRangePayload = serde_json::from_value(raw.anchor_data)
                    .map_err(serde::de::Error::custom)?;
                Ok(AnchorRepr::WordRange(payload))
            }
            other => Ok(AnchorRepr::Unknown {
                kind: other.to_string(),
                data: raw.anchor_data,
            }),
        }
    }
}

impl serde::Serialize for AnchorRepr {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        match self {
            AnchorRepr::Line(p) => {
                let mut map = serializer.serialize_map(Some(2))?;
                map.serialize_entry("anchor_kind", "line")?;
                map.serialize_entry("anchor_data", p)?;
                map.end()
            }
            AnchorRepr::File => {
                let mut map = serializer.serialize_map(Some(1))?;
                map.serialize_entry("anchor_kind", "file")?;
                map.end()
            }
            AnchorRepr::WordRange(p) => {
                let mut map = serializer.serialize_map(Some(2))?;
                map.serialize_entry("anchor_kind", "word_range")?;
                map.serialize_entry("anchor_data", p)?;
                map.end()
            }
            AnchorRepr::Unknown { kind, data } => {
                let mut map = serializer.serialize_map(Some(2))?;
                map.serialize_entry("anchor_kind", kind)?;
                map.serialize_entry("anchor_data", data)?;
                map.end()
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub(super) struct LineAnchorPayload {
    pub line: u32,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub end_line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub start_column: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub end_column: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub selected_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub selected_text_hash: Option<String>,
}

impl From<Anchor> for AnchorRepr {
    fn from(a: Anchor) -> Self {
        match a {
            Anchor::Line {
                line,
                end_line,
                start_column,
                end_column,
                selected_text,
                selected_text_hash,
            } => AnchorRepr::Line(LineAnchorPayload {
                line,
                end_line,
                start_column,
                end_column,
                selected_text,
                selected_text_hash,
            }),
            Anchor::File => AnchorRepr::File,
            Anchor::Unknown { kind, data } => AnchorRepr::Unknown { kind, data },
            Anchor::WordRange(p) => AnchorRepr::WordRange(p),
        }
    }
}

impl TryFrom<AnchorRepr> for Anchor {
    type Error = String;

    fn try_from(r: AnchorRepr) -> Result<Self, Self::Error> {
        Ok(match r {
            AnchorRepr::Line(p) => Anchor::Line {
                line: p.line,
                end_line: p.end_line,
                start_column: p.start_column,
                end_column: p.end_column,
                selected_text: p
                    .selected_text
                    .map(|s| crate::core::anchors::truncate_selected_text(&s)),
                selected_text_hash: p.selected_text_hash,
            },
            AnchorRepr::File => Anchor::File,
            AnchorRepr::Unknown { kind, data } => Anchor::Unknown { kind, data },
            AnchorRepr::WordRange(mut p) => {
                p.sanitize()?;
                Anchor::WordRange(p)
            }
        })
    }
}

/// Single error builder for every (kind, payload_count) mismatch. Tests
/// only assert on the `"anchor_kind/payload mismatch"` substring, so the
/// detail is purely diagnostic.
fn mismatch(detail: impl AsRef<str>) -> String {
    format!("anchor_kind/payload mismatch: {}", detail.as_ref())
}

/// Deserialise: pick the Anchor variant from the wire repr. Validates that
/// the discriminator and payload match. Returns a typed serde error on
/// mismatch so `serde_json::from_str` propagates it as a parse failure.
impl TryFrom<&MrsfCommentRepr> for Anchor {
    type Error = String;

    fn try_from(r: &MrsfCommentRepr) -> Result<Self, Self::Error> {
        // Helper: count how many payload sibling fields are populated.
        let payload_count = [
            r.image_rect.is_some(),
            r.csv_cell.is_some(),
            r.json_path.is_some(),
            r.html_range.is_some(),
            r.html_element.is_some(),
            r.word_range.is_some(),
        ]
        .iter()
        .filter(|x| **x)
        .count();

        let line_anchor = || Anchor::Line {
            line: r.line.unwrap_or(0),
            end_line: r.end_line,
            start_column: r.start_column,
            end_column: r.end_column,
            selected_text: r
                .selected_text
                .as_deref()
                .map(crate::core::anchors::truncate_selected_text),
            selected_text_hash: r.selected_text_hash.clone(),
        };

        // Macro-free lookup: typed variants must have `payload_count == 1`
        // AND the matching payload populated. Anything else is a schema
        // violation; v1.0 (no discriminator) and `line`/`file` must have
        // zero payload siblings.
        match (r.anchor_kind.as_deref(), payload_count) {
            (None, 0) => Ok(line_anchor()),
            (None, _) => Err(mismatch("payload present without anchor_kind")),
            (Some("line"), 0) => Ok(line_anchor()),
            (Some("line"), _) => Err(mismatch("anchor_kind=line with payload sibling")),
            (Some("file"), 0) => {
                // MRSF §6/§7: file-level comments MUST NOT carry any flat
                // targeting fields. Reject explicit `anchor_kind: "file"`
                // sidecars that smuggle `line`/`selected_text`/etc — they
                // are internally inconsistent and would behave ambiguously
                // downstream (matchers, UI labels, badge counts).
                if r.line.is_some()
                    || r.end_line.is_some()
                    || r.start_column.is_some()
                    || r.end_column.is_some()
                    || r.selected_text.is_some()
                    || r.selected_text_hash.is_some()
                {
                    return Err(mismatch(
                        "anchor_kind=file with flat targeting fields (line/end_line/start_column/end_column/selected_text/selected_text_hash)",
                    ));
                }
                Ok(Anchor::File)
            }
            (Some("file"), _) => Err(mismatch("anchor_kind=file with payload sibling")),
            (Some("word_range"), 1) => {
                let mut p = r.word_range.clone().ok_or_else(|| {
                    mismatch("anchor_kind=word_range but word_range field missing")
                })?;
                p.sanitize()?;
                Ok(Anchor::WordRange(p))
            }
            (Some("word_range"), _) => Err(mismatch(
                "anchor_kind=word_range with wrong payload sibling count",
            )),
            // Known-but-deleted anchor types → Unknown (backward compat)
            (Some(kind @ ("image_rect" | "csv_cell" | "json_path" | "html_range" | "html_element")), _) => {
                let data = match kind {
                    "image_rect" => r.image_rect.as_ref().map(|p| serde_json::to_value(p).unwrap_or_default()),
                    "csv_cell" => r.csv_cell.as_ref().map(|p| serde_json::to_value(p).unwrap_or_default()),
                    "json_path" => r.json_path.as_ref().map(|p| serde_json::to_value(p).unwrap_or_default()),
                    "html_range" => r.html_range.as_ref().map(|p| serde_json::to_value(p).unwrap_or_default()),
                    "html_element" => r.html_element.as_ref().map(|p| serde_json::to_value(p).unwrap_or_default()),
                    _ => unreachable!(),
                };
                Ok(Anchor::Unknown {
                    kind: kind.to_string(),
                    data: data.unwrap_or(serde_json::Value::Null),
                })
            }
            // Truly unknown anchor kinds
            (Some(other), _) => Ok(Anchor::Unknown {
                kind: other.to_string(),
                data: serde_json::Value::Null,
            }),
        }
    }
}

impl TryFrom<MrsfCommentRepr> for MrsfComment {
    type Error = String;

    fn try_from(r: MrsfCommentRepr) -> Result<Self, Self::Error> {
        let anchor: Anchor = (&r).try_into()?;
        // Belt-and-braces: when the resolved anchor is `File`, scrub the
        // legacy flat targeting fields from the in-memory comment. The
        // wire-level guard in `TryFrom<&MrsfCommentRepr> for Anchor`
        // already rejects sidecars where these fields disagree with
        // `anchor_kind: "file"`, but if a future caller hand-builds a
        // `MrsfCommentRepr` and bypasses that guard (e.g. via the public
        // `From<MrsfComment>` round-trip) we still want a consistent
        // in-memory shape. This mirrors the chokepoint scrubbing in
        // `add_comment_inner` for non-Line anchors.
        let is_file_anchor = matches!(anchor, Anchor::File);
        Ok(MrsfComment {
            id: r.id,
            author: r.author,
            timestamp: r.timestamp,
            text: r.text,
            resolved: r.resolved,
            line: if is_file_anchor { None } else { r.line },
            end_line: if is_file_anchor { None } else { r.end_line },
            start_column: if is_file_anchor { None } else { r.start_column },
            end_column: if is_file_anchor { None } else { r.end_column },
            selected_text: if is_file_anchor { None } else { r.selected_text },
            anchored_text: r.anchored_text,
            selected_text_hash: if is_file_anchor { None } else { r.selected_text_hash },
            commit: r.commit,
            comment_type: r.comment_type,
            severity: r.severity,
            reply_to: r.reply_to,
            anchor,
            anchor_history: r
                .anchor_history
                .map(|v| {
                    v.into_iter()
                        .map(TryInto::try_into)
                        .collect::<Result<Vec<_>, _>>()
                })
                .transpose()?,
            reactions: r.reactions,
        })
    }
}

impl From<MrsfComment> for MrsfCommentRepr {
    fn from(c: MrsfComment) -> Self {
        // Decide wire shape from the anchor variant.
        let has_v1_1_markers =
            c.anchor_history.as_ref().is_some_and(|h| !h.is_empty()) || c.reactions.is_some();

        // `base` carries every comment-level field that's variant-agnostic.
        // Per-arm `MrsfCommentRepr { ..base }` then overlays only the
        // anchor-specific fields. This collapses ~165 LOC of 12-tuple
        // matching into one short match.
        //
        // Partial-move discipline: `base` consumes the agnostic fields of
        // `c`; the variant arms below access only the *remaining* fields
        // (`c.anchor`, plus — for the Line arm — `c.line`, `c.end_line`,
        // `c.start_column`, `c.end_column`, `c.selected_text`,
        // `c.selected_text_hash`). Rust's disjoint-field move rules
        // permit this.
        let base = MrsfCommentRepr {
            id: c.id,
            author: c.author,
            timestamp: c.timestamp,
            text: c.text,
            resolved: c.resolved,
            anchored_text: c.anchored_text,
            commit: c.commit,
            comment_type: c.comment_type,
            severity: c.severity,
            reply_to: c.reply_to,
            anchor_history: c
                .anchor_history
                .map(|v| v.into_iter().map(Into::into).collect()),
            reactions: c.reactions,
            ..Default::default()
        };

        match c.anchor {
            Anchor::Line { .. } => MrsfCommentRepr {
                // v1.0 byte-identity path: omit `anchor_kind` entirely
                // when no v1.1 markers are present. With v1.1 markers
                // we must emit `"line"` so readers can distinguish from
                // a stray flat-line decode.
                anchor_kind: if has_v1_1_markers {
                    Some("line".to_string())
                } else {
                    None
                },
                line: c.line,
                end_line: c.end_line,
                start_column: c.start_column,
                end_column: c.end_column,
                selected_text: c.selected_text,
                selected_text_hash: c.selected_text_hash,
                ..base
            },
            Anchor::File => MrsfCommentRepr {
                anchor_kind: Some("file".into()),
                ..base
            },
            Anchor::Unknown { kind, data } => {
                let mut repr = MrsfCommentRepr {
                    anchor_kind: Some(kind.clone()),
                    ..base
                };
                // Restore flat fields for known-but-deleted kinds (round-trip fidelity)
                match kind.as_str() {
                    "image_rect" => repr.image_rect = serde_json::from_value(data).ok(),
                    "csv_cell" => repr.csv_cell = serde_json::from_value(data).ok(),
                    "json_path" => repr.json_path = serde_json::from_value(data).ok(),
                    "html_range" => repr.html_range = serde_json::from_value(data).ok(),
                    "html_element" => repr.html_element = serde_json::from_value(data).ok(),
                    _ => {} // truly unknown kind — no flat field to restore
                }
                repr
            },
            Anchor::WordRange(p) => MrsfCommentRepr {
                anchor_kind: Some("word_range".into()),
                word_range: Some(p),
                ..base
            },
        }
    }
}
