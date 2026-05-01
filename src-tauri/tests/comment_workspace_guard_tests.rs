//! Integration tests for AC3 of issue #338: comment-mutation IPCs reject
//! canonical paths outside `tree_watched_dirs` with the typed
//! `CommentError::OutsideWorkspace` variant — NOT a magic string sentinel.
//!
//! Group A2 of the tiered link & asset policy migration. Pairs with
//! `commands_integration.rs::workspace_guard_rejects_outside_path_for_every_retrofitted_command`
//! (which exercises the test seam `check_workspace_for`); these tests
//! drive each `*_inner` entry point end-to-end so the migration of the
//! return-type signature is exercised on the actual mutation path.
//!
//! Why a new file (not merged into `comments_emit_test.rs`)? That suite's
//! charter is "emit-once on real mutation, zero on no-op" — adding error
//! paths there would dilute the contract. Per `docs/test-strategy.md`
//! one suite, one contract.

use mdown_review_lib::commands::{
    add_comment_inner, add_reply_inner, delete_comment_inner, edit_comment_inner,
    mutate_sidecar_or_create, update_comment_inner, CommentError, CommentPatch, CommentsEmitter,
    MrsfComment, NewCommentAnchor,
};
use mdown_review_lib::core::types::{Anchor, MrsfSidecar};
use mdown_review_lib::watcher::{SidecarConfigState, WatcherState};
use std::path::Path;
use std::sync::Mutex;

// ── Mock emitter — never invoked because every call rejects pre-emit ───────

#[derive(Default)]
struct MockEmitter {
    events: Mutex<Vec<String>>,
}

impl CommentsEmitter for MockEmitter {
    fn emit_comments_changed(&self, file_path: &str) {
        self.events.lock().unwrap().push(file_path.to_string());
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────

fn watcher_allowing(dir: &Path) -> WatcherState {
    let canonical = std::fs::canonicalize(dir).unwrap();
    let (tx, _rx) = std::sync::mpsc::sync_channel(1);
    let state = WatcherState::new(tx);
    state
        .set_tree_watched_dirs(
            "test",
            canonical.to_string_lossy().into_owned(),
            vec![canonical.to_string_lossy().into_owned()],
        )
        .unwrap();
    state
}

/// Workspace dir under CWD so the system-locations DENY list (which
/// would catch `%TEMP%\…\AppData\…` on Windows in Group B) doesn't fire.
/// Mirrors `fs_workspace_guard_tests::workspace_tempdir`.
fn cwd_tempdir(prefix: &str) -> tempfile::TempDir {
    let cwd = std::env::current_dir().expect("cwd available");
    tempfile::Builder::new()
        .prefix(prefix)
        .tempdir_in(&cwd)
        .expect("tempdir_in cwd")
}

fn make_seed_comment(id: &str) -> MrsfComment {
    MrsfComment {
        id: id.into(),
        author: "Tester".into(),
        timestamp: "2026-04-25T12:00:00-07:00".into(),
        text: "seed".into(),
        resolved: false,
        line: Some(1),
        anchor: Anchor::Line {
            line: 1,
            end_line: None,
            start_column: None,
            end_column: None,
            selected_text: None,
            selected_text_hash: None,
        },
        ..Default::default()
    }
}

/// Seed a sidecar inside `dir` (BYPASSING the workspace guard via the pure
/// helper) so `update_comment_inner` / `delete_comment_inner` etc. find a
/// real sidecar to mutate when run on the inside-workspace happy path.
fn seed_sidecar(dir: &Path, name: &str, comment_id: &str) -> String {
    let canonical = std::fs::canonicalize(dir).unwrap();
    let file_path = canonical.join(name);
    std::fs::write(&file_path, b"seed").unwrap();
    let file_path_str = file_path.to_string_lossy().into_owned();
    mutate_sidecar_or_create(
        &file_path_str,
        Some(name.into()),
        &SidecarConfigState::new(),
        |sc: &mut MrsfSidecar| {
            sc.comments.push(make_seed_comment(comment_id));
            Ok(())
        },
    )
    .unwrap();
    file_path_str
}

fn outside_file(dir: &Path, name: &str) -> String {
    let canonical = std::fs::canonicalize(dir).unwrap();
    let file = canonical.join(name);
    std::fs::write(&file, b"x").unwrap();
    file.to_string_lossy().into_owned()
}

fn assert_outside_workspace(err: CommentError, expected_substr: &str) {
    match err {
        CommentError::OutsideWorkspace { path } => assert!(
            path.contains(expected_substr),
            "OutsideWorkspace path missing `{expected_substr}`: got `{path}`",
        ),
        other => panic!("expected OutsideWorkspace, got {other:?}"),
    }
}

// ── Per-IPC outside-workspace rejection ─────────────────────────────────────

#[test]
fn add_comment_outside_workspace_returns_typed_error() {
    let workspace = cwd_tempdir("mdr-comment-guard-ws-");
    let outside = cwd_tempdir("mdr-comment-guard-outside-");
    let state = watcher_allowing(workspace.path());
    let emitter = MockEmitter::default();
    let file = outside_file(outside.path(), "doc.md");

    let err = add_comment_inner(
        &emitter,
        &state,
        &SidecarConfigState::new(),
        file.clone(),
        "Tester".into(),
        "hi".into(),
        Some(NewCommentAnchor::Legacy(
            mdown_review_lib::core::types::CommentAnchor {
                line: 1,
                end_line: None,
                start_column: None,
                end_column: None,
                selected_text: None,
                selected_text_hash: None,
            },
        )),
        None,
        None,
        Some("doc.md".into()),
    )
    .unwrap_err();

    assert_outside_workspace(err, "doc.md");
    assert_eq!(
        emitter.events.lock().unwrap().len(),
        0,
        "rejection must NOT emit comments-changed",
    );
}

#[test]
fn add_reply_outside_workspace_returns_typed_error() {
    let workspace = cwd_tempdir("mdr-comment-guard-ws-");
    let outside = cwd_tempdir("mdr-comment-guard-outside-");
    let state = watcher_allowing(workspace.path());
    let emitter = MockEmitter::default();
    let file = outside_file(outside.path(), "doc.md");

    let err = add_reply_inner(
        &emitter,
        &state,
        &SidecarConfigState::new(),
        file,
        "c1".into(),
        "Tester".into(),
        "reply".into(),
    )
    .unwrap_err();

    assert_outside_workspace(err, "doc.md");
}

#[test]
fn edit_comment_outside_workspace_returns_typed_error() {
    let workspace = cwd_tempdir("mdr-comment-guard-ws-");
    let outside = cwd_tempdir("mdr-comment-guard-outside-");
    let state = watcher_allowing(workspace.path());
    let emitter = MockEmitter::default();
    let file = outside_file(outside.path(), "doc.md");

    let err = edit_comment_inner(
        &emitter,
        &state,
        &SidecarConfigState::new(),
        file,
        "c1".into(),
        "edited".into(),
    )
    .unwrap_err();

    assert_outside_workspace(err, "doc.md");
}

#[test]
fn delete_comment_outside_workspace_returns_typed_error() {
    let workspace = cwd_tempdir("mdr-comment-guard-ws-");
    let outside = cwd_tempdir("mdr-comment-guard-outside-");
    let state = watcher_allowing(workspace.path());
    let emitter = MockEmitter::default();
    let file = outside_file(outside.path(), "doc.md");

    let err = delete_comment_inner(
        &emitter,
        &state,
        &SidecarConfigState::new(),
        file,
        "c1".into(),
    )
    .unwrap_err();

    assert_outside_workspace(err, "doc.md");
}

#[test]
fn update_comment_outside_workspace_returns_typed_error() {
    let workspace = cwd_tempdir("mdr-comment-guard-ws-");
    let outside = cwd_tempdir("mdr-comment-guard-outside-");
    let state = watcher_allowing(workspace.path());
    let emitter = MockEmitter::default();
    let file = outside_file(outside.path(), "doc.md");

    let err = update_comment_inner(
        &emitter,
        &state,
        &SidecarConfigState::new(),
        file,
        "c1".into(),
        CommentPatch::SetResolved { resolved: true },
    )
    .unwrap_err();

    assert_outside_workspace(err, "doc.md");
}

// ── Sanity: inside-workspace path still succeeds ────────────────────────────

#[test]
fn add_comment_inside_workspace_succeeds() {
    let workspace = cwd_tempdir("mdr-comment-guard-ws-");
    let state = watcher_allowing(workspace.path());
    let emitter = MockEmitter::default();
    let canonical = std::fs::canonicalize(workspace.path()).unwrap();
    let file_path_buf = canonical.join("doc.md");
    std::fs::write(&file_path_buf, b"x").unwrap();
    let file_path = file_path_buf.to_string_lossy().into_owned();

    add_comment_inner(
        &emitter,
        &state,
        &SidecarConfigState::new(),
        file_path,
        "Tester".into(),
        "hi".into(),
        Some(NewCommentAnchor::Legacy(
            mdown_review_lib::core::types::CommentAnchor {
                line: 1,
                end_line: None,
                start_column: None,
                end_column: None,
                selected_text: None,
                selected_text_hash: None,
            },
        )),
        None,
        None,
        Some("doc.md".into()),
    )
    .expect("inside-workspace add must succeed");

    assert_eq!(emitter.events.lock().unwrap().len(), 1);
}

#[test]
fn update_comment_inside_workspace_succeeds() {
    let workspace = cwd_tempdir("mdr-comment-guard-ws-");
    let state = watcher_allowing(workspace.path());
    let emitter = MockEmitter::default();
    let file_path = seed_sidecar(workspace.path(), "doc.md", "c1");

    update_comment_inner(
        &emitter,
        &state,
        &SidecarConfigState::new(),
        file_path,
        "c1".into(),
        CommentPatch::SetResolved { resolved: true },
    )
    .expect("inside-workspace update must succeed");

    assert_eq!(emitter.events.lock().unwrap().len(), 1);
}
