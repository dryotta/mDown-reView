//! Integration tests for the `path_classify` IPC (issue #338, Group A1).
//!
//! Exercises [`path_classify_inner`] (the pure core, decoupled from
//! `tauri::Window` / `tauri::State`) plus [`workspace_root_for_window`] for
//! the per-window state lookup. The wire-level `path_classify` command itself
//! is a thin shim over these two; testing them directly avoids the cost of a
//! full `tauri::test::mock_app()` while still covering every branch
//! (canonicalize-fail, no-workspace-registered, every Tier variant).

use mdown_review_lib::commands::path_classify::{path_classify_inner, workspace_root_for_window};
use mdown_review_lib::core::paths::canonicalize_no_verbatim;
use mdown_review_lib::core::types::wire::PathClassification;
#[cfg(unix)]
use mdown_review_lib::core::types::wire::PathClassificationFlavor;
use mdown_review_lib::watcher::WatcherState;
use std::path::PathBuf;

// ── helpers ────────────────────────────────────────────────────────────────

/// Mirrors `fs_workspace_guard_tests::workspace_tempdir` — pin the tempdir
/// to the `src-tauri/` crate dir on every OS so the workspace path itself
/// doesn't trip `\AppData\` (Windows) or any system blocklist prefix.
fn workspace_tempdir() -> tempfile::TempDir {
    let cwd = std::env::current_dir().expect("cwd available");
    tempfile::Builder::new()
        .prefix("mdr-path-classify-")
        .tempdir_in(&cwd)
        .expect("tempdir_in cwd")
}

fn outside_tempdir() -> tempfile::TempDir {
    let cwd = std::env::current_dir().expect("cwd available");
    tempfile::Builder::new()
        .prefix("mdr-path-classify-outside-")
        .tempdir_in(&cwd)
        .expect("tempdir_in cwd")
}

fn write_file(dir: &std::path::Path, name: &str, contents: &[u8]) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, contents).unwrap();
    path
}

fn state_with_window(label: &str, dirs: Vec<PathBuf>) -> WatcherState {
    let (tx, _rx) = std::sync::mpsc::sync_channel(1);
    let state = WatcherState::new(tx);
    // `set_tree_watched_dirs` is the public API used by fs IPC; mirrors the
    // pattern in `fs_workspace_guard_tests::state_with_workspace`.
    let root = dirs[0].to_string_lossy().into_owned();
    let dir_strs: Vec<String> = dirs.iter().map(|p| p.to_string_lossy().into_owned()).collect();
    state.set_tree_watched_dirs(label, root, dir_strs).expect("set_tree_watched_dirs");
    state
}

// ── tests ──────────────────────────────────────────────────────────────────

#[test]
fn test_classify_inside_workspace() {
    let workspace = workspace_tempdir();
    let ws_canon = canonicalize_no_verbatim(workspace.path()).unwrap();
    let file = write_file(workspace.path(), "doc.md", b"# Hi");

    let res = path_classify_inner(file.to_str().unwrap(), None, &ws_canon).unwrap();
    let file_canon = canonicalize_no_verbatim(&file).unwrap();
    let expected = file_canon.to_string_lossy().into_owned();
    match res {
        PathClassification::Inside { canonical } => assert_eq!(canonical, expected),
        other => panic!("expected Inside, got {other:?}"),
    }
}

#[test]
fn test_classify_outside_workspace() {
    let workspace = workspace_tempdir();
    let outside = outside_tempdir();
    let ws_canon = canonicalize_no_verbatim(workspace.path()).unwrap();
    let file = write_file(outside.path(), "neighbor.md", b"hi");

    let res = path_classify_inner(file.to_str().unwrap(), None, &ws_canon).unwrap();
    let file_canon = canonicalize_no_verbatim(&file).unwrap();
    let expected = file_canon.to_string_lossy().into_owned();
    match res {
        PathClassification::Outside { canonical } => assert_eq!(canonical, expected),
        other => panic!("expected Outside, got {other:?}"),
    }
}

#[cfg(unix)]
#[test]
fn test_classify_system_etc_omits_canonical() {
    // `/etc/hosts` exists on every supported unix and is in the POSIX
    // system-prefix list. The wire shape MUST NOT echo the canonical path
    // back (defense-in-depth — tier-3 placeholders never leak system paths).
    let workspace = workspace_tempdir();
    let ws_canon = canonicalize_no_verbatim(workspace.path()).unwrap();

    let res = path_classify_inner("/etc/hosts", None, &ws_canon).unwrap();
    match res {
        PathClassification::System { flavor } => {
            assert_eq!(flavor, PathClassificationFlavor::Posix);
        }
        other => panic!("expected System, got {other:?}"),
    }

    // Defensive: round-trip through serde and verify the JSON has NO
    // `canonical` key on the System variant.
    let res = path_classify_inner("/etc/hosts", None, &ws_canon).unwrap();
    let json = serde_json::to_string(&res).unwrap();
    assert!(
        !json.contains("canonical"),
        "System variant must not echo canonical, got {json}"
    );
    assert!(json.contains("\"tier\":\"system\""), "got {json}");
    assert!(json.contains("\"flavor\":\"posix\""), "got {json}");
}

#[test]
fn test_classify_no_workspace_registered() {
    let state = {
        let (tx, _rx) = std::sync::mpsc::sync_channel(1);
        WatcherState::new(tx)
    };
    assert!(
        workspace_root_for_window(&state, "missing-window").is_none(),
        "expected None for window with no watched dirs"
    );
}

#[test]
fn test_classify_relative_with_base_dir_resolves_inside_workspace() {
    let workspace = workspace_tempdir();
    let ws_canon = canonicalize_no_verbatim(workspace.path()).unwrap();
    let sub = workspace.path().join("sub");
    std::fs::create_dir_all(&sub).unwrap();
    let sibling = write_file(workspace.path(), "sibling.md", b"hi");

    // From workspace/sub, ../sibling.md should resolve to workspace/sibling.md.
    let base_str = sub.to_string_lossy().into_owned();
    let res = path_classify_inner("../sibling.md", Some(&base_str), &ws_canon).unwrap();
    let expected = canonicalize_no_verbatim(&sibling)
        .unwrap()
        .to_string_lossy()
        .into_owned();
    match res {
        PathClassification::Inside { canonical } => assert_eq!(canonical, expected),
        other => panic!("expected Inside, got {other:?}"),
    }
}

#[test]
fn test_classify_canonicalize_failure() {
    let workspace = workspace_tempdir();
    let ws_canon = canonicalize_no_verbatim(workspace.path()).unwrap();

    let bogus = workspace.path().join("does-not-exist-xyz.md");
    let err = path_classify_inner(bogus.to_str().unwrap(), None, &ws_canon).unwrap_err();
    assert!(
        err.starts_with("canonicalize failed:"),
        "unexpected error: {err}"
    );
}

#[test]
fn test_workspace_root_for_window_returns_min_entry() {
    let workspace = workspace_tempdir();
    let ws_canon = canonicalize_no_verbatim(workspace.path()).unwrap();
    let sub = workspace.path().join("zzz_sub");
    std::fs::create_dir_all(&sub).unwrap();
    let sub_canon = canonicalize_no_verbatim(&sub).unwrap();

    let state = state_with_window("win-A", vec![ws_canon.clone(), sub_canon]);
    let resolved = workspace_root_for_window(&state, "win-A").expect("registered");
    assert_eq!(resolved, ws_canon, "lex-smallest must be the workspace root");
}
