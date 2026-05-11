//! Typed error for comment-mutation IPCs.
//!
//! Issue #338 / AC3: replaces the magic-string `"path not in workspace"`
//! sentinel with a tagged Specta-exposed enum so the renderer can pattern-match
//! on `kind === "outside-workspace"` instead of grepping. The
//! `OutsideWorkspace` variant carries the offending path so the renderer can
//! self-heal (e.g. set `tab.readOnly = true`) without a separate IPC
//! round-trip — this is the Group B foundation for AC3 (workspace-rejection
//! self-heal).
//!
//! Rust-internal cases (`Io`) are kept as a catch-all variant so existing
//! string-only error returns from helpers like `with_sidecar_mut` /
//! `update_comment_apply` continue to flow through `?` via the
//! `From<String>` blanket below — only the `OutsideWorkspace` case is tagged.
//! Future iters can split `Io` further as call-site value emerges.
//!
//! ## Why no `thiserror`
//! `cli_shim.rs` already establishes the pattern of manual `Display`
//! impls to avoid pulling `thiserror` into the production dep tree (Lean
//! pillar — `docs/principles.md`). We mirror that here; the variants are
//! few enough that the boilerplate is trivial.

use serde::Serialize;
use specta::Type;

/// Tagged error returned by comment-mutation IPCs. Discriminated with an
/// internal `kind` tag (kebab-case on the wire) so the TS side can branch
/// on `err.kind` without parsing prose.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum CommentError {
    /// Canonical path outside the per-window workspace allowlist.
    /// AC3 of #338: the renderer surfaces this as a tab-level "read-only"
    /// indicator. The path is included so the consumer can self-heal the
    /// corresponding tab without a separate IPC round-trip.
    OutsideWorkspace { path: String },

    /// I/O or sidecar-shape failure. Catch-all for now; future iters may
    /// split this further. Carries the original error text so the renderer
    /// can surface it verbatim in a toast (matches the pre-#338 string
    /// surface — no information lost).
    Io { message: String },
}

impl std::fmt::Display for CommentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CommentError::OutsideWorkspace { path } => {
                write!(f, "outside workspace: {path}")
            }
            CommentError::Io { message } => write!(f, "io: {message}"),
        }
    }
}

impl std::error::Error for CommentError {}

impl From<String> for CommentError {
    /// Map legacy magic strings emitted by helpers (e.g. `with_sidecar_mut`,
    /// `update_comment_apply`) into the typed variant. Single-direction +
    /// audit-friendly: any future helper that returns the literal
    /// `"path not in workspace"` is automatically converted with no
    /// caller-site changes.
    ///
    /// In practice `enforce_workspace_path` now emits
    /// `CommentError::OutsideWorkspace` directly with the offending path,
    /// so the legacy-string fallback here only fires if a non-canonical
    /// helper sneaks the sentinel in. Kept as a safety net.
    fn from(message: String) -> Self {
        if message == "path not in workspace" {
            CommentError::OutsideWorkspace { path: String::new() }
        } else {
            CommentError::Io { message }
        }
    }
}

impl From<&str> for CommentError {
    fn from(message: &str) -> Self {
        CommentError::from(message.to_string())
    }
}

/// One-way fallback for non-migrated callers (e.g. `get_file_comments`
/// still returns `Result<_, String>` because it's a read, not a mutation,
/// and the spec scopes Group A2 to the 5 mutation IPCs). Lets
/// `enforce_workspace_path(...)?` continue to compile in those callers
/// **and preserves the exact pre-#338 string surface** so the renderer's
/// existing string matches keep working until they migrate in a later
/// wave. Mapping mirrors the inverse of `From<String> for CommentError`
/// above so the conversions round-trip.
impl From<CommentError> for String {
    fn from(err: CommentError) -> Self {
        match err {
            CommentError::OutsideWorkspace { .. } => "path not in workspace".to_string(),
            CommentError::Io { message } => message,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outside_workspace_serializes_with_kebab_kind_tag() {
        let err = CommentError::OutsideWorkspace { path: "/tmp/x".into() };
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("\"kind\":\"outside-workspace\""), "got: {json}");
        assert!(json.contains("\"path\":\"/tmp/x\""), "got: {json}");
    }

    #[test]
    fn io_serializes_with_kebab_kind_tag() {
        let err = CommentError::Io { message: "boom".into() };
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("\"kind\":\"io\""), "got: {json}");
        assert!(json.contains("\"message\":\"boom\""), "got: {json}");
    }

    #[test]
    fn from_string_legacy_workspace_sentinel_maps_to_outside_workspace() {
        let err: CommentError = "path not in workspace".to_string().into();
        match err {
            CommentError::OutsideWorkspace { path } => assert_eq!(path, ""),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn from_string_unknown_falls_back_to_io() {
        let err: CommentError = "sidecar not found".to_string().into();
        match err {
            CommentError::Io { message } => assert_eq!(message, "sidecar not found"),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn into_string_preserves_legacy_workspace_sentinel() {
        let s: String = CommentError::OutsideWorkspace { path: "/x".into() }.into();
        assert_eq!(s, "path not in workspace");
    }

    #[test]
    fn into_string_io_preserves_message() {
        let s: String = CommentError::Io { message: "boom".into() }.into();
        assert_eq!(s, "boom");
    }
}
