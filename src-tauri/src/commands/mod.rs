//! IPC command surface.
//!
//! Each submodule groups related `#[tauri::command]` handlers. This module
//! re-exports them flat so `lib.rs::shared_commands!` and integration tests
//! can keep using `commands::xxx` paths.

pub mod cli_shim;
pub mod comments;
pub mod config;
pub mod default_handler;
pub mod folder_context;
pub mod fs;
pub mod html;
pub mod launch;
pub mod onboarding;
pub mod remote_asset;
pub mod search;
pub mod system;
pub mod word_tokens;

// ── Re-export core types so existing code (lib.rs, tests) still compiles ──
pub use crate::core::types::{
    CommentAnchor, CommentThread, DirEntry, LaunchArgs, MatchedComment, MrsfComment, MrsfSidecar,
};

// ── Flat re-exports of every command + public helper ──────────────────────
pub use comments::{
    add_comment, add_comment_inner, add_reply, add_reply_inner, check_workspace_for,
    compute_anchor_hash, delete_comment, delete_comment_inner, edit_comment, edit_comment_inner,
    export_review_summary, export_review_summary_inner, get_file_badges, get_file_badges_inner,
    get_file_comments, get_file_comments_inner, mutate_sidecar_or_create, update_comment,
    update_comment_apply, update_comment_inner, CommentPatch, CommentsChangedEvent, CommentsEmitter,
    FileBadge, NewCommentAnchor, TaggedNewAnchor,
};
pub use config::{set_author, set_author_at, validate_author, ConfigError};
pub use fs::{
    check_path_exists, read_binary_file, read_dir, read_text_file, stat_file, stat_file_inner,
    update_tree_watched_dirs, FileStat, TextFileResult,
};
pub use html::{compute_fold_regions, resolve_html_assets, FoldRegion};
#[cfg(debug_assertions)]
pub use launch::set_root_via_test;
pub use launch::{
    drain_pending, get_launch_args, get_log_path, parse_launch_args, push_pending,
    scan_review_files, PendingArgsState,
};
pub use remote_asset::fetch_remote_asset;
pub use search::{
    parse_kql, search_in_document, strip_json_comments, KqlPipelineStep, SearchMatch,
};
pub use system::{reveal_in_folder, SystemError};
pub use word_tokens::tokenize_words;

/// True for `<file>.review.yaml` / `<file>.review.json` sidecar names.
/// Shared by `fs::read_dir` (filtering) and `launch::set_root_via_test`.
pub(crate) fn is_sidecar_file(name: &str) -> bool {
    name.ends_with(".review.yaml") || name.ends_with(".review.json")
}
