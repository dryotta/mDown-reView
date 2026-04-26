//! Regression suite for issue #112 — comment-mutation commands MUST
//! emit `comments-changed` to the renderer's "main"-window listener
//! channel via `Emitter::emit_to(self, "main", …)` per
//! `docs/design-patterns.md` rule 4 (Rust emits window-scoped events,
//! never app-wide broadcasts), and they must SKIP the emit on no-op
//! patches to avoid renderer event storms.
//!
//! These tests exercise the `*_inner` variants of each command, which
//! delegate to a `CommentsEmitter` trait — the production impl is
//! `AppHandle<R>` and uses `Emitter::emit_to(self, "main", …)`. The
//! `MockEmitter` here intercepts at the trait boundary, so the contract
//! these tests guard is "the wrappers DO call `emit_comments_changed`
//! exactly once per real mutation, and zero times per no-op."
//!
//! The "use `.emit_to("main", …)` not `.emit(...)`" half of the contract
//! is enforced by the trait impl itself — see
//! `commands/comments/mod.rs::impl<R: Runtime> CommentsEmitter for AppHandle<R>`.
//!
//! Why not `tauri::test::mock_app()` for end-to-end emit verification?
//! The `tauri = features = ["test"]` dev-dep pulls webview2/wry GUI DLLs
//! into the integration-test binary which fail to load on the dev
//! Windows host (STATUS_ENTRYPOINT_NOT_FOUND). The trait seam keeps
//! these tests fast and platform-portable.
//!
//! Verification command (revert + re-run to confirm fail-then-pass):
//!   # In src/commands/comments/mod.rs replace the `with_sidecar_*`
//!   # `emitter.emit_comments_changed(file_path)` calls with `()`.
//!   cargo test --test comments_emit_test
//!   # tests fail; re-apply the emit calls; cargo test → green.

use mdown_review_lib::commands::{
    add_comment_inner, add_reply_inner, delete_comment_inner, edit_comment_inner,
    mutate_sidecar_or_create, update_comment_inner, CommentPatch, CommentsEmitter, MrsfComment,
    NewCommentAnchor,
};
use mdown_review_lib::core::sidecar::load_sidecar;
use mdown_review_lib::core::types::{Anchor, MrsfSidecar};
use mdown_review_lib::watcher::WatcherState;
use std::path::Path;
use std::sync::Mutex;
use tempfile::TempDir;

// ── Mock emitter ───────────────────────────────────────────────────────────

#[derive(Default)]
struct MockEmitter {
    events: Mutex<Vec<String>>,
}

impl MockEmitter {
    fn count(&self) -> usize {
        self.events.lock().unwrap().len()
    }
    fn paths(&self) -> Vec<String> {
        self.events.lock().unwrap().clone()
    }
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
            canonical.to_string_lossy().into_owned(),
            vec![canonical.to_string_lossy().into_owned()],
        )
        .unwrap();
    state
}

fn make_comment(id: &str) -> MrsfComment {
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

fn seed_with_comment(dir: &Path, name: &str, comment_id: &str) -> String {
    let canonical = std::fs::canonicalize(dir).unwrap();
    let file_path = canonical.join(name);
    std::fs::write(&file_path, b"seed").unwrap();
    let file_path_str = file_path.to_string_lossy().into_owned();
    mutate_sidecar_or_create(&file_path_str, Some(name.into()), |sc: &mut MrsfSidecar| {
        sc.comments.push(make_comment(comment_id));
        Ok(())
    })
    .unwrap();
    file_path_str
}

fn fresh_file(dir: &Path, name: &str) -> String {
    let canonical = std::fs::canonicalize(dir).unwrap();
    let file_path = canonical.join(name);
    std::fs::write(&file_path, b"seed").unwrap();
    file_path.to_string_lossy().into_owned()
}

// ── add_comment ────────────────────────────────────────────────────────────

#[test]
fn add_comment_emits_once_with_correct_file_path() {
    let dir = TempDir::new().unwrap();
    let state = watcher_allowing(dir.path());
    let emitter = MockEmitter::default();
    let file_path = fresh_file(dir.path(), "doc.md");

    add_comment_inner(
        &emitter,
        &state,
        file_path.clone(),
        "Tester".into(),
        "hello".into(),
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
    .unwrap();

    assert_eq!(emitter.count(), 1, "add_comment must emit exactly once");
    assert_eq!(emitter.paths(), vec![file_path]);
}

// ── add_reply ──────────────────────────────────────────────────────────────

#[test]
fn add_reply_emits_once() {
    let dir = TempDir::new().unwrap();
    let state = watcher_allowing(dir.path());
    let emitter = MockEmitter::default();
    let file_path = seed_with_comment(dir.path(), "doc.md", "c1");

    add_reply_inner(
        &emitter,
        &state,
        file_path.clone(),
        "c1".into(),
        "Tester".into(),
        "reply".into(),
    )
    .unwrap();

    assert_eq!(emitter.count(), 1);
    assert_eq!(emitter.paths()[0], file_path);
}

// ── edit_comment ───────────────────────────────────────────────────────────

#[test]
fn edit_comment_emits_once() {
    let dir = TempDir::new().unwrap();
    let state = watcher_allowing(dir.path());
    let emitter = MockEmitter::default();
    let file_path = seed_with_comment(dir.path(), "doc.md", "c1");

    edit_comment_inner(
        &emitter,
        &state,
        file_path.clone(),
        "c1".into(),
        "edited".into(),
    )
    .unwrap();

    assert_eq!(emitter.count(), 1);
    assert_eq!(emitter.paths()[0], file_path);
}

// ── delete_comment ─────────────────────────────────────────────────────────

#[test]
fn delete_comment_emits_once() {
    let dir = TempDir::new().unwrap();
    let state = watcher_allowing(dir.path());
    let emitter = MockEmitter::default();
    let file_path = seed_with_comment(dir.path(), "doc.md", "c1");

    delete_comment_inner(&emitter, &state, file_path.clone(), "c1".into()).unwrap();

    assert_eq!(emitter.count(), 1);
    assert_eq!(emitter.paths()[0], file_path);
}

// ── update_comment (SetResolved) ───────────────────────────────────────────

#[test]
fn update_comment_set_resolved_emits_when_changed() {
    let dir = TempDir::new().unwrap();
    let state = watcher_allowing(dir.path());
    let emitter = MockEmitter::default();
    let file_path = seed_with_comment(dir.path(), "doc.md", "c1");

    update_comment_inner(
        &emitter,
        &state,
        file_path.clone(),
        "c1".into(),
        CommentPatch::SetResolved { resolved: true },
    )
    .unwrap();

    assert_eq!(emitter.count(), 1);
    let saved = load_sidecar(&file_path).unwrap().unwrap();
    assert!(saved.comments[0].resolved);
}

#[test]
fn update_comment_set_resolved_no_op_does_not_emit() {
    // Pre-condition: comment is unresolved. Sending `SetResolved { false }`
    // is a no-op — it must NOT emit (chained-command storm prevention).
    let dir = TempDir::new().unwrap();
    let state = watcher_allowing(dir.path());
    let emitter = MockEmitter::default();
    let file_path = seed_with_comment(dir.path(), "doc.md", "c1");

    update_comment_inner(
        &emitter,
        &state,
        file_path,
        "c1".into(),
        CommentPatch::SetResolved { resolved: false },
    )
    .unwrap();

    assert_eq!(
        emitter.count(),
        0,
        "SetResolved no-op must not emit (apply layer + IPC layer both gate on `bool`)"
    );
}

#[test]
fn update_comment_move_anchor_no_op_does_not_emit() {
    // MoveAnchor with the SAME anchor as the existing one → no-op.
    let dir = TempDir::new().unwrap();
    let state = watcher_allowing(dir.path());
    let emitter = MockEmitter::default();
    let file_path = seed_with_comment(dir.path(), "doc.md", "c1");

    let same = Anchor::Line {
        line: 1,
        end_line: None,
        start_column: None,
        end_column: None,
        selected_text: None,
        selected_text_hash: None,
    };
    update_comment_inner(
        &emitter,
        &state,
        file_path,
        "c1".into(),
        CommentPatch::MoveAnchor { new_anchor: same },
    )
    .unwrap();

    assert_eq!(emitter.count(), 0, "equal-anchor MoveAnchor must not emit");
}
