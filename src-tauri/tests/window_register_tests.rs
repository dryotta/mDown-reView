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

// ── Group B (issue #359 AC1/AC2/AC3/AC7) ───────────────────────────────────
//
// Tests for `register_window_file_inner` and `collect_canonicals_for_extend`.
// Use the `WatcherState` direct-construction pattern from
// `fs_workspace_guard_tests.rs:state_with_workspace`.

mod group_b {
    use mdown_review_lib::commands::fs::ensure_readable;
    use mdown_review_lib::commands::window_register::{
        collect_canonicals_for_extend, register_window_file_inner,
    };
    use mdown_review_lib::core::paths::canonicalize_no_verbatim;
    use mdown_review_lib::core::types::wire::PathClassification;
    use mdown_review_lib::watcher::WatcherState;
    use std::path::PathBuf;

    /// Build an empty `WatcherState` (no seeded dirs). Mirrors the harness
    /// in `fs_workspace_guard_tests.rs` minus the workspace seeding so we
    /// can prove `register_window_file` itself adds the entry.
    fn empty_state() -> WatcherState {
        let (tx, _rx) = std::sync::mpsc::sync_channel(1);
        WatcherState::new(tx)
    }

    /// Build a `WatcherState` whose `tree_watched_dirs["test"]` contains
    /// `workspace`. Local copy of `fs_workspace_guard_tests::state_with_workspace`
    /// so we don't grow a cross-test-file shared module just for this iter.
    fn state_with_workspace(workspace: &std::path::Path) -> WatcherState {
        let (tx, _rx) = std::sync::mpsc::sync_channel(1);
        let state = WatcherState::new(tx);
        let canonical = canonicalize_no_verbatim(workspace).unwrap();
        state
            .set_tree_watched_dirs(
                "test",
                canonical.to_string_lossy().into_owned(),
                vec![canonical.to_string_lossy().into_owned()],
            )
            .unwrap();
        state
    }

    fn workspace_tempdir() -> tempfile::TempDir {
        let cwd = std::env::current_dir().expect("cwd available");
        tempfile::Builder::new()
            .prefix("mdr-window-register-")
            .tempdir_in(&cwd)
            .expect("tempdir_in cwd")
    }

    fn outside_tempdir() -> tempfile::TempDir {
        let cwd = std::env::current_dir().expect("cwd available");
        tempfile::Builder::new()
            .prefix("mdr-window-register-outside-")
            .tempdir_in(&cwd)
            .expect("tempdir_in cwd")
    }

    fn write_file(dir: &std::path::Path, name: &str, contents: &[u8]) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, contents).unwrap();
        path
    }

    fn dirs_for(state: &WatcherState, label: &str) -> std::collections::HashSet<PathBuf> {
        state
            .tree_watched_dirs_snapshot()
            .get(label)
            .cloned()
            .unwrap_or_default()
    }

    // ── register_window_file ────────────────────────────────────────────────

    #[test]
    fn register_window_file_inside_folder_returns_inside_classification() {
        let workspace = workspace_tempdir();
        let state = state_with_workspace(workspace.path());
        let file = write_file(workspace.path(), "inside.md", b"# Inside");

        let result =
            register_window_file_inner("test", file.to_str().unwrap(), &state).expect("ok");
        match &result.classification {
            PathClassification::Inside { canonical } => {
                assert_eq!(canonical, &result.canonical);
            }
            other => panic!("expected Inside, got {other:?}"),
        }
        // The file's parent dir is now seeded for window "test".
        let parent = canonicalize_no_verbatim(file.parent().unwrap()).unwrap();
        assert!(dirs_for(&state, "test").contains(&parent));
    }

    #[test]
    fn register_window_file_outside_returns_outside_and_seeds_watcher() {
        // No seeded workspace — simulates a freshly-launched orphan-file
        // window. With no workspace root for the window, the
        // discriminator collapses to Inside per the file-only fallback in
        // `register_window_file_inner` (workspace_root_for_window returns
        // None → use canonical as its own root). Verifies the orphan-window
        // path: registration succeeds and the watcher gets seeded.
        let outside = outside_tempdir();
        let state = empty_state();
        let file = write_file(outside.path(), "outside.md", b"out");

        let result =
            register_window_file_inner("w1", file.to_str().unwrap(), &state).expect("ok");
        // No workspace registered → classification collapses to Inside;
        // the load-bearing assertion is the watcher seed.
        assert!(matches!(result.classification, PathClassification::Inside { .. }));
        let parent = canonicalize_no_verbatim(file.parent().unwrap()).unwrap();
        assert!(dirs_for(&state, "w1").contains(&parent));
    }

    #[test]
    fn register_window_file_outside_with_workspace_returns_outside() {
        // AC7 — with a registered workspace, an outside-workspace file
        // MUST classify Outside (not Inside). The pre-fix bug:
        // `classify(&canonical, &canonical)` collapsed to Inside for any
        // non-system path, defeating the renderer's `readOnly` derivation.
        let workspace = workspace_tempdir();
        let outside = outside_tempdir();
        let state = state_with_workspace(workspace.path());
        let file = write_file(outside.path(), "outside.md", b"out");

        let result =
            register_window_file_inner("test", file.to_str().unwrap(), &state).expect("ok");
        match &result.classification {
            PathClassification::Outside { canonical } => {
                assert_eq!(canonical, &result.canonical);
            }
            other => panic!("expected Outside, got {other:?}"),
        }
        // Watcher still seeded so the subsequent ensure_readable accepts.
        let parent = canonicalize_no_verbatim(file.parent().unwrap()).unwrap();
        assert!(dirs_for(&state, "test").contains(&parent));
    }

    #[cfg(unix)]
    #[test]
    fn register_window_file_system_path_blocked() {
        let state = empty_state();
        let err = register_window_file_inner("w1", "/etc/passwd", &state).unwrap_err();
        assert_eq!(err, "system path blocked");
        // Watcher state UNCHANGED: no entry inserted under "w1".
        assert!(dirs_for(&state, "w1").is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn register_window_file_system_path_blocked() {
        // C:\Windows\System32\drivers\etc\hosts canonicalizes cleanly on
        // Windows and matches the Windows system-prefix list (rule fired
        // by `WINDOWS_SYSTEM_PREFIXES` containing `C:\Windows\`).
        let state = empty_state();
        let err = register_window_file_inner(
            "w1",
            r"C:\Windows\System32\drivers\etc\hosts",
            &state,
        )
        .unwrap_err();
        assert_eq!(err, "system path blocked");
        assert!(dirs_for(&state, "w1").is_empty());
    }

    #[test]
    fn register_window_file_dot_dot_rejects() {
        let state = empty_state();
        // A relative path with `..` cannot canonicalize to an absolute
        // existing file → `canonicalize_no_verbatim` errors → "canonicalize failed".
        let err = register_window_file_inner("w1", "../nope/missing.md", &state).unwrap_err();
        assert_eq!(err, "canonicalize failed");
        assert!(dirs_for(&state, "w1").is_empty());
    }

    #[test]
    fn register_window_file_idempotent() {
        let workspace = workspace_tempdir();
        let state = state_with_workspace(workspace.path());
        let file = write_file(workspace.path(), "doc.md", b"x");

        register_window_file_inner("test", file.to_str().unwrap(), &state).unwrap();
        register_window_file_inner("test", file.to_str().unwrap(), &state).unwrap();

        let parent = canonicalize_no_verbatim(file.parent().unwrap()).unwrap();
        let dirs = dirs_for(&state, "test");
        // HashSet semantics — second call is a no-op insert.
        assert_eq!(dirs.iter().filter(|d| **d == parent).count(), 1);
    }

    #[test]
    fn register_window_file_window_isolation() {
        let workspace = workspace_tempdir();
        let state = state_with_workspace(workspace.path());
        let file = write_file(workspace.path(), "doc.md", b"x");

        register_window_file_inner("A", file.to_str().unwrap(), &state).unwrap();

        // Window B's tree is unchanged — registering for A must not bleed.
        assert!(dirs_for(&state, "B").is_empty());
    }

    #[test]
    fn register_window_file_then_ensure_readable_succeeds() {
        // Closes AC1/AC2 happy path: a window with no pre-seeded workspace
        // can register an outside file, and `ensure_readable` then accepts
        // that file via the seeded parent dir.
        let outside = outside_tempdir();
        let state = empty_state();
        let file = write_file(outside.path(), "note.md", b"hi");

        register_window_file_inner("orphan", file.to_str().unwrap(), &state).unwrap();
        let canonical = ensure_readable(file.to_str().unwrap(), &state).expect("readable");
        let expected = canonicalize_no_verbatim(&file).unwrap();
        assert_eq!(canonical, expected);
    }

    #[test]
    fn ensure_readable_before_register_rejects() {
        // Negative seal — without prior register, the file is rejected.
        let outside = outside_tempdir();
        let state = empty_state();
        let file = write_file(outside.path(), "note.md", b"hi");

        let err = ensure_readable(file.to_str().unwrap(), &state).unwrap_err();
        assert_eq!(err, "path not in workspace");
    }

    // ── collect_canonicals_for_extend ──────────────────────────────────────

    #[test]
    fn collect_canonicals_for_extend_returns_each_canonical() {
        let dir1 = workspace_tempdir();
        let dir2 = outside_tempdir();
        let f1 = write_file(dir1.path(), "a.md", b"a");
        let f2 = write_file(dir1.path(), "b.md", b"b");
        let f3 = write_file(dir2.path(), "c.md", b"c");

        let inputs = vec![
            f1.to_string_lossy().into_owned(),
            f2.to_string_lossy().into_owned(),
            f3.to_string_lossy().into_owned(),
        ];
        let canonicals = collect_canonicals_for_extend(&inputs).expect("ok");
        assert_eq!(canonicals.len(), 3);

        // The downstream `extend_window_scope` dedups parents via
        // `watcher_seed_dirs`. Verify the parents-set covers both dirs.
        let mut parents: Vec<PathBuf> =
            canonicals.iter().filter_map(|p| p.parent().map(PathBuf::from)).collect();
        parents.sort();
        parents.dedup();
        let mut expected = vec![
            canonicalize_no_verbatim(dir1.path()).unwrap(),
            canonicalize_no_verbatim(dir2.path()).unwrap(),
        ];
        expected.sort();
        assert_eq!(parents, expected);
    }

    #[cfg(unix)]
    #[test]
    fn collect_canonicals_for_extend_system_path_blocked_atomic() {
        let dir = workspace_tempdir();
        let f1 = write_file(dir.path(), "a.md", b"a");

        let inputs = vec![
            f1.to_string_lossy().into_owned(),
            "/etc/passwd".to_string(),
        ];
        let err = collect_canonicals_for_extend(&inputs).unwrap_err();
        assert_eq!(err, "system path blocked");
        // Atomic — caller never observes a partial vec; the helper
        // returned Err so no `extend_window_scope` dispatch occurs.
    }

    #[cfg(windows)]
    #[test]
    fn collect_canonicals_for_extend_system_path_blocked_atomic() {
        let dir = workspace_tempdir();
        let f1 = write_file(dir.path(), "a.md", b"a");

        let inputs = vec![
            f1.to_string_lossy().into_owned(),
            r"C:\Windows\System32\drivers\etc\hosts".to_string(),
        ];
        let err = collect_canonicals_for_extend(&inputs).unwrap_err();
        assert_eq!(err, "system path blocked");
    }
}

