//! Group A foundation tests for `extend_window_scope` / `ScopeGrant`
//! (issue #359, AC5 + AC6).
//!
//! `extend_window_scope` itself takes a `tauri::Manager` so it can pull
//! `asset_protocol_scope()`; `tauri::test::mock_app()` is unusable on
//! the dev Windows host (precedent: `comments_emit_test.rs`,
//! `watcher_emit_test.rs`). The asset-scope wiring is verified by the
//! native E2E layer (Group E, future iterations).
//!
//! What we test here is the load-bearing dispatch the chokepoint owns:
//! `ScopeGrant::Folder` → recursive single-dir watcher seed;
//! `ScopeGrant::FilesParents` → deduplicated parent watcher seed.
//! That dispatch is exposed via `watcher_seed_dirs`, which is the exact
//! list `extend_window_scope` hands to
//! `WatcherState::seed_window_workspace`. The
//! `seed_window_workspace` → `tree_watched_dirs` set-semantics path is
//! covered by `WatcherState`'s own internal tests (HashSet-backed).

use mdown_review_lib::window_scope::{watcher_seed_dirs, ScopeGrant};
use std::path::PathBuf;

#[test]
fn extend_window_scope_dispatches_folder_variant() {
    let p = PathBuf::from("/projects/myapp");
    let grant = ScopeGrant::Folder(p.clone());

    // Folder grants seed exactly the single canonical dir; the watcher
    // entry for a window's label will therefore contain `p` after
    // `extend_window_scope` is called.
    assert_eq!(watcher_seed_dirs(&grant), vec![p]);
}

#[test]
fn extend_window_scope_dispatches_files_parents_variant() {
    let p1 = PathBuf::from("/projects/a");
    let p2 = PathBuf::from("/projects/b");
    let grant = ScopeGrant::FilesParents(vec![
        p1.join("a.md"),
        p1.join("b.md"),
        p2.join("c.md"),
    ]);

    let dirs = watcher_seed_dirs(&grant);

    // Deduplicated to {p1, p2}, sorted for deterministic comparison.
    let mut expected = vec![p1, p2];
    expected.sort();
    assert_eq!(dirs, expected);
}

#[test]
fn extend_window_scope_files_parents_idempotent() {
    let p1 = PathBuf::from("/projects/a");
    let p2 = PathBuf::from("/projects/b");
    let files = vec![p1.join("a.md"), p1.join("b.md"), p2.join("c.md")];
    let grant = ScopeGrant::FilesParents(files);

    // Calling `watcher_seed_dirs` twice on the same grant yields
    // identical outputs — the dispatch is referentially transparent, so
    // `seed_window_workspace` (HashSet-backed) sees the same dir set
    // both times and the final allowlist contains no duplicates.
    let first = watcher_seed_dirs(&grant);
    let second = watcher_seed_dirs(&grant);
    assert_eq!(first, second);

    let mut want = vec![p1, p2];
    want.sort();
    assert_eq!(first, want);
}

#[test]
fn files_parents_empty_payload_yields_empty_seed() {
    let grant = ScopeGrant::FilesParents(vec![]);
    assert!(watcher_seed_dirs(&grant).is_empty());
}

