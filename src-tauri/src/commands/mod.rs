//! IPC command surface.
//!
//! Each submodule groups related `#[tauri::command]` handlers. This module
//! re-exports them flat so `lib.rs::shared_commands!` and integration tests
//! can keep using `commands::xxx` paths.

pub mod cli_shim;
pub mod close_flush;
pub mod comments;
pub mod config;
pub mod default_handler;
pub mod file_viewer_prefs;
pub mod fs;
pub mod fs_write;
pub mod html;
pub mod launch;
pub mod onboarding;
pub mod open_file_registry;
pub mod path_classify;
pub mod remote_asset;
pub mod search;
pub mod startup;
pub mod system;
pub mod sidecar_config;
pub mod window_register;
pub mod word_tokens;

// ── Re-export core types so existing code (lib.rs, tests) still compiles ──
pub use crate::core::types::{
    CommentAnchor, CommentThread, DirEntry, LaunchArgs, MatchedComment, MrsfComment, MrsfSidecar,
};

// ── Flat re-exports of every command + public helper ──────────────────────
pub use comments::{
    add_comment, add_comment_inner, add_reply, add_reply_inner, check_workspace_for,
    compute_anchor_hash, delete_comment, delete_comment_inner, edit_comment, edit_comment_inner,
    get_file_badges, get_file_badges_inner, get_file_comments, get_file_comments_inner,
    mutate_sidecar_or_create, update_comment, update_comment_apply, update_comment_inner,
    CommentPatch, CommentsChangedEvent, CommentsEmitter, CommentError, FileBadge, GetFileCommentsResult,
    NewCommentAnchor, TaggedNewAnchor,
};
pub use close_flush::{
    close_flush_complete, flush_pending_writes_before_close, mark_close_flush_ready,
    CloseFlushState,
};
pub use config::{set_author, set_author_at, validate_author, ConfigError};
pub use file_viewer_prefs::{get_file_viewer_pref, set_file_viewer_pref, FileViewerPref};
pub use fs::{
    check_path_exists, ensure_readable, read_binary_file, read_binary_file_inner, read_dir,
    read_dir_inner, read_text_file, read_text_file_inner, stat_file, stat_file_inner,
    update_tree_watched_dirs, FileStat, ReadDirResult, TextFileResult,
};
pub use fs_write::{write_workspace_binary, write_workspace_text};
pub use html::{compute_fold_regions, resolve_html_assets, FoldRegion};
#[cfg(debug_assertions)]
pub use launch::{reset_window_scope_for_test, set_root_via_test};
pub use launch::{
    get_launch_args, get_log_path, parse_launch_args, parse_trace_flag,
    scan_review_files,
};
pub use open_file_registry::{
    claim_open_file, release_open_file, release_open_files, ClaimResult, OpenFileRegistry,
};
pub use path_classify::{path_classify, path_classify_inner, workspace_root_for_window};
pub use remote_asset::fetch_remote_asset;
pub use search::{
    parse_kql, search_in_document, strip_json_comments, KqlPipelineStep, SearchMatch,
};
pub use startup::record_startup_phase;
pub use system::{reveal_in_folder, SystemError};
pub use sidecar_config::{
    get_sidecar_config, migrate_sidecars_cmd, set_sidecar_config, MigrateSidecarsResult,
    SidecarConfigResult,
};
pub use word_tokens::tokenize_words;
pub use window_register::{
    collect_canonicals_for_extend, extend_window_scope_files, register_window_file,
    register_window_file_inner, register_window_folder, unregister_window_folder,
    RegisterWindowFileResult,
};

/// True for `<file>.review.yaml` / `<file>.review.json` sidecar names.
/// Shared by `fs::read_dir` (filtering) and `launch::set_root_via_test`.
pub(crate) fn is_sidecar_file(name: &str) -> bool {
    name.ends_with(".review.yaml") || name.ends_with(".review.json")
}
