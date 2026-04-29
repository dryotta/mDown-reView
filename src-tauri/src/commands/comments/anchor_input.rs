//! Wire-format anchor types for `add_comment`.
//!
//! Extracted from `mod.rs` to stay under the 400-LOC budget (arch rule 23).

use crate::core::types::{Anchor, CommentAnchor, WordRangePayload};
use serde::Deserialize;

/// Wire-format anchor for `add_comment`. Accepts BOTH the legacy flat
/// `{ line, ... }` shape used by line-anchored composers and the tagged
/// `{ kind: "...", ... }` shape introduced for file-level + typed
/// anchors (Group A/B). Untagged so the JS chokepoint (`addComment` in
/// `lib/tauri-commands.ts`) does not have to convert.
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(untagged)]
pub enum NewCommentAnchor {
    Tagged(TaggedNewAnchor),
    Legacy(CommentAnchor),
}

/// Tagged variant of [`NewCommentAnchor`]. Mirrors the TS `Anchor` union
/// in `src/lib/anchor-derive.ts` — discriminator is `kind`, payload fields
/// are flattened alongside it (internally tagged).
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TaggedNewAnchor {
    Line {
        line: u32,
        #[serde(default)]
        end_line: Option<u32>,
        #[serde(default)]
        start_column: Option<u32>,
        #[serde(default)]
        end_column: Option<u32>,
        #[serde(default)]
        selected_text: Option<String>,
        #[serde(default)]
        selected_text_hash: Option<String>,
    },
    File,
    WordRange(WordRangePayload),
}

impl NewCommentAnchor {
    /// Convert into the canonical in-memory [`Anchor`] enum + a legacy
    /// flat [`CommentAnchor`] (used by `create_comment` to populate the
    /// MrsfComment's flat line fields). For non-Line variants, the flat
    /// fields are left as the default — callers must not rely on them.
    /// Exposed `pub` for integration tests of `add_comment`'s anchor
    /// dispatch (the `#[tauri::command]` itself can't be invoked outside
    /// a Tauri runtime).
    pub fn into_anchor_pair(self) -> (Anchor, Option<CommentAnchor>) {
        match self {
            NewCommentAnchor::Legacy(c) => {
                let anchor = Anchor::Line {
                    line: c.line,
                    end_line: c.end_line,
                    start_column: c.start_column,
                    end_column: c.end_column,
                    selected_text: c.selected_text.clone(),
                    selected_text_hash: c.selected_text_hash.clone(),
                };
                (anchor, Some(c))
            }
            NewCommentAnchor::Tagged(TaggedNewAnchor::Line {
                line,
                end_line,
                start_column,
                end_column,
                selected_text,
                selected_text_hash,
            }) => {
                let flat = CommentAnchor {
                    line,
                    end_line,
                    start_column,
                    end_column,
                    selected_text: selected_text.clone(),
                    selected_text_hash: selected_text_hash.clone(),
                };
                let anchor = Anchor::Line {
                    line,
                    end_line,
                    start_column,
                    end_column,
                    selected_text,
                    selected_text_hash,
                };
                (anchor, Some(flat))
            }
            NewCommentAnchor::Tagged(TaggedNewAnchor::File) => (Anchor::File, None),
            NewCommentAnchor::Tagged(TaggedNewAnchor::WordRange(p)) => (Anchor::WordRange(p), None),
        }
    }
}
