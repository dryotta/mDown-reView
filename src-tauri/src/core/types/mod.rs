//! MRSF v1.1 public types. Wire-format serde lives in [`wire`].

use serde::{Deserialize, Serialize};

mod wire;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LaunchArgs {
    pub files: Vec<String>,
    pub folders: Vec<String>,
}

// ── MRSF v1.1 anchor enum ──────────────────────────────────────────────────
//
// Tagged anchor type. Wire format is hand-rolled in `wire.rs`: the v1.0
// `Line` shape stays flat at the comment level (no `anchor_kind`), while
// every other variant is emitted as `anchor_kind` + matching payload object.
//
// `Serialize`/`Deserialize` are routed through `wire::AnchorRepr` (tagged
// `anchor_kind` + `anchor_data`) so standalone `Anchor` payloads — e.g. the
// `CommentPatch::MoveAnchor { new_anchor }` IPC field — share the exact
// same on-the-wire shape that `anchor_history` entries use. The comment-
// level flat-line representation lives in `wire::MrsfCommentRepr`.
//
// Intentionally NOT `Default` — every construction site must pick a variant
// explicitly. Use [`MrsfComment::new_legacy_line`] for legacy line callers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(try_from = "wire::AnchorRepr", into = "wire::AnchorRepr")]
pub enum Anchor {
    Line {
        line: u32,
        end_line: Option<u32>,
        start_column: Option<u32>,
        end_column: Option<u32>,
        selected_text: Option<String>,
        selected_text_hash: Option<String>,
    },
    File,
    ImageRect(ImageRectAnchor),
    CsvCell(CsvCellAnchor),
    JsonPath(JsonPathAnchor),
    HtmlRange(HtmlRangeAnchor),
    HtmlElement(HtmlElementAnchor),
    WordRange(WordRangePayload),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ImageRectAnchor {
    pub x_pct: f32,
    pub y_pct: f32,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub w_pct: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub h_pct: Option<f32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CsvCellAnchor {
    pub row_idx: u32,
    pub col_idx: u32,
    pub col_header: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub primary_key_col: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub primary_key_value: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct JsonPathAnchor {
    pub json_path: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub scalar_text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct HtmlRangeAnchor {
    pub selector_path: String,
    pub start_offset: u32,
    pub end_offset: u32,
    pub selected_text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct HtmlElementAnchor {
    pub selector_path: String,
    pub tag: String,
    pub text_preview: String,
}

/// v1.1 word-range anchor payload (Group D-wire, iter 3). Targets a contiguous
/// run of UAX #29 word tokens on a single line. `start_word` / `end_word` are
/// 0-based indices into the line's word stream produced by
/// [`crate::core::word_tokens::tokenize_words`]; `snippet` is a small
/// human-readable preview and `line_text_hash` is the lowercase-hex sha256 of
/// the anchored line at capture time (used by the resolver to detect drift).
///
/// Hardening lives in [`WordRangePayload::sanitize`], called at the wire→domain
/// conversion boundary so attackers can't smuggle bidi confusables, oversize
/// blobs, NUL bytes, or non-hex hashes into in-memory anchors.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WordRangePayload {
    pub start_word: u32,
    pub end_word: u32,
    pub line: u32,
    pub snippet: String,
    pub line_text_hash: String,
}

/// Hard cap on the on-wire `snippet` byte length (NOT char count). Bytes are
/// the right unit because every multi-byte char would otherwise let an
/// attacker store ~4× more text than the budget implies.
pub const WORD_RANGE_SNIPPET_MAX_BYTES: usize = 4096;

impl WordRangePayload {
    /// Strip-on-ingest sanitisation + validation. Mutates `snippet` to remove
    /// bidi/zero-width chars (lossy is acceptable per security pre-consult),
    /// then asserts the hardening limits (snippet ≤ 4 KB, no NUL, hash matches
    /// `^[0-9a-f]{64}$`). Run from [`wire`] at the wire→domain boundary.
    pub fn sanitize(&mut self) -> Result<(), String> {
        self.snippet = strip_bidi_zw(&self.snippet);
        if self.snippet.len() > WORD_RANGE_SNIPPET_MAX_BYTES {
            return Err(format!(
                "word_range snippet exceeds {WORD_RANGE_SNIPPET_MAX_BYTES} byte cap ({} bytes)",
                self.snippet.len()
            ));
        }
        if self.snippet.contains('\0') {
            return Err("word_range snippet contains NUL byte".to_string());
        }
        static HASH_RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
        let re = HASH_RE.get_or_init(|| regex::Regex::new(r"^[0-9a-f]{64}$").unwrap());
        if !re.is_match(&self.line_text_hash) {
            return Err(format!(
                "word_range line_text_hash must match ^[0-9a-f]{{64}}$ (got `{}`)",
                self.line_text_hash
            ));
        }
        Ok(())
    }
}

/// Strip Unicode bidi-override and zero-width formatting chars: U+202A-202E
/// (LRO/RLO/PDF/LRE/RLE), U+2066-2069 (LRI/RLI/FSI/PDI), U+200B-200D
/// (ZWSP/ZWNJ/ZWJ), U+FEFF (BOM). These are the classic "Trojan Source"
/// confusables that let attackers visually misrepresent stored text.
fn strip_bidi_zw(s: &str) -> String {
    s.chars()
        .filter(|&c| {
            !matches!(
                c,
                '\u{202A}'..='\u{202E}'
                    | '\u{2066}'..='\u{2069}'
                    | '\u{200B}'..='\u{200D}'
                    | '\u{FEFF}'
            )
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Reaction {
    pub user: String,
    pub kind: String,
    pub ts: String,
}

// ── Comment ────────────────────────────────────────────────────────────────

/// In-memory MRSF comment. Wire serde lives in [`wire::MrsfCommentRepr`].
///
/// `anchor` is the canonical anchor source. Legacy flat line fields
/// (`line`, `end_line`, `start_column`, `end_column`, `selected_text`,
/// `selected_text_hash`, `anchored_text`) are kept on the struct because
/// existing matchers/exporters/threads still read them; for `Anchor::Line`
/// they MUST stay in sync with the variant payload (the serde repr enforces
/// this on round-trip).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(try_from = "wire::MrsfCommentRepr", into = "wire::MrsfCommentRepr")]
pub struct MrsfComment {
    pub id: String,
    pub author: String,
    pub timestamp: String,
    pub text: String,
    pub resolved: bool,
    pub line: Option<u32>,
    pub end_line: Option<u32>,
    pub start_column: Option<u32>,
    pub end_column: Option<u32>,
    pub selected_text: Option<String>,
    pub anchored_text: Option<String>,
    pub selected_text_hash: Option<String>,
    pub commit: Option<String>,
    pub comment_type: Option<String>,
    pub severity: Option<String>,
    pub reply_to: Option<String>,
    pub anchor: Anchor,
    pub anchor_history: Option<Vec<Anchor>>,
    pub reactions: Option<Vec<Reaction>>,
}

impl Default for MrsfComment {
    fn default() -> Self {
        Self {
            id: String::new(),
            author: String::new(),
            timestamp: String::new(),
            text: String::new(),
            resolved: false,
            line: None,
            end_line: None,
            start_column: None,
            end_column: None,
            selected_text: None,
            anchored_text: None,
            selected_text_hash: None,
            commit: None,
            comment_type: None,
            severity: None,
            reply_to: None,
            anchor: Anchor::Line {
                line: 0,
                end_line: None,
                start_column: None,
                end_column: None,
                selected_text: None,
                selected_text_hash: None,
            },
            anchor_history: None,
            reactions: None,
        }
    }
}

impl MrsfComment {
    /// FIFO-clamp anchor history to 3 entries. Pushes `prev` to the back,
    /// dropping the oldest if full. The cap is intentional: anchor history
    /// is bounded to keep sidecars small (advisory: bounded mutation).
    pub fn push_anchor_history(&mut self, prev: Anchor) {
        const CAP: usize = 3;
        match self.anchor_history {
            Some(ref mut h) => {
                if h.len() == CAP {
                    h.remove(0);
                }
                h.push(prev);
            }
            None => self.anchor_history = Some(vec![prev]),
        }
    }

    /// Construct a v1.0-shaped legacy line comment. Both the flat line
    /// fields and `anchor` are populated identically so downstream readers
    /// (which still consume the flat fields) and the serde wire format
    /// stay coherent.
    #[allow(clippy::too_many_arguments)]
    pub fn new_legacy_line(
        id: String,
        author: String,
        timestamp: String,
        text: String,
        resolved: bool,
        line: Option<u32>,
        end_line: Option<u32>,
        start_column: Option<u32>,
        end_column: Option<u32>,
        selected_text: Option<String>,
        selected_text_hash: Option<String>,
    ) -> Self {
        Self {
            id,
            author,
            timestamp,
            text,
            resolved,
            line,
            end_line,
            start_column,
            end_column,
            selected_text: selected_text.clone(),
            anchored_text: None,
            selected_text_hash: selected_text_hash.clone(),
            commit: None,
            comment_type: None,
            severity: None,
            reply_to: None,
            anchor: Anchor::Line {
                line: line.unwrap_or(0),
                end_line,
                start_column,
                end_column,
                selected_text,
                selected_text_hash,
            },
            anchor_history: None,
            reactions: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MrsfSidecar {
    pub mrsf_version: String,
    pub document: String,
    pub comments: Vec<MrsfComment>,
}

/// Anchor specification for creating new comments.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommentAnchor {
    pub line: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_column: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_column: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_text_hash: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchedComment {
    #[serde(flatten)]
    pub comment: MrsfComment,
    pub matched_line_number: u32,
    pub is_orphaned: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchored_text: Option<String>,
}

/// A thread: root comment with replies sorted by timestamp.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommentThread {
    pub root: MatchedComment,
    pub replies: Vec<MatchedComment>,
}

/// Mutations applied via `patch_comment`.
pub enum CommentMutation {
    SetResolved(bool),
    AddResponse {
        author: String,
        text: String,
        timestamp: String,
    },
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
