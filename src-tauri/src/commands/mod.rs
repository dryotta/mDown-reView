//! IPC command surface.
//!
//! Each submodule groups related `#[tauri::command]` handlers. This module
//! re-exports them flat so `lib.rs::shared_commands!` and integration tests
//! can keep using `commands::xxx` paths.

pub mod cli_shim;
pub mod comments;
pub mod default_handler;
pub mod folder_context;
pub mod fs;
pub mod html;
pub mod launch;
pub mod onboarding;
pub mod remote_asset;
pub mod search;

// ── Re-export core types so existing code (lib.rs, tests) still compiles ──
pub use crate::core::types::{
    CommentAnchor, CommentThread, DirEntry, LaunchArgs, MatchedComment, MrsfComment, MrsfSidecar,
};

// ── Flat re-exports of every command + public helper ──────────────────────
pub use comments::{
    add_comment, add_reply, compute_anchor_hash, delete_comment, edit_comment, get_file_comments,
    get_unresolved_counts, mutate_sidecar_or_create, set_comment_resolved, CommentsChangedEvent,
};
pub use fs::{check_path_exists, read_binary_file, read_dir, read_text_file, update_tree_watched_dirs, TextFileResult};
pub use html::{compute_fold_regions, resolve_html_assets, FoldRegion};
pub use launch::{get_launch_args, get_log_path, scan_review_files, parse_launch_args, push_pending, drain_pending, PendingArgsState};
#[cfg(debug_assertions)]
pub use launch::set_root_via_test;
pub use remote_asset::fetch_remote_asset;
pub use search::{parse_kql, search_in_document, strip_json_comments, KqlPipelineStep, SearchMatch};

/// True for `<file>.review.yaml` / `<file>.review.json` sidecar names.
/// Shared by `fs::read_dir` (filtering) and `launch::set_root_via_test`.
pub(crate) fn is_sidecar_file(name: &str) -> bool {
    name.ends_with(".review.yaml") || name.ends_with(".review.json")
}
