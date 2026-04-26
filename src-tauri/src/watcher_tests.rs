use super::*;
use std::sync::mpsc::sync_channel;

fn make_state() -> WatcherState {
    let (tx, _rx) = sync_channel(1);
    WatcherState::new(tx)
}

#[test]
fn update_tree_watched_dirs_canonicalizes_and_rejects_outside_root() {
    let root_dir = tempfile::tempdir().unwrap();
    let outside_dir = tempfile::tempdir().unwrap();
    let root = canonicalize_no_verbatim(root_dir.path()).unwrap();
    let outside = canonicalize_no_verbatim(outside_dir.path()).unwrap();
    let state = make_state();

    let err = state
        .set_tree_watched_dirs(
            root.to_string_lossy().into_owned(),
            vec![outside.to_string_lossy().into_owned()],
        )
        .unwrap_err();
    assert!(err.contains("outside root"), "unexpected error: {}", err);

    // Sanity: a dir inside root is accepted.
    let inside = root.join("sub");
    std::fs::create_dir(&inside).unwrap();
    let inside_canonical = canonicalize_no_verbatim(&inside).unwrap();
    state
        .set_tree_watched_dirs(
            root.to_string_lossy().into_owned(),
            vec![inside_canonical.to_string_lossy().into_owned()],
        )
        .expect("inside-root dir should be accepted");
}

#[test]
fn update_tree_watched_dirs_rejects_over_cap() {
    let root_dir = tempfile::tempdir().unwrap();
    let root = canonicalize_no_verbatim(root_dir.path()).unwrap();
    let dirs: Vec<String> = (0..MAX_TREE_WATCHED_DIRS + 1)
        .map(|i| root.join(format!("d{}", i)).to_string_lossy().into_owned())
        .collect();
    let state = make_state();

    let err = state
        .set_tree_watched_dirs(root.to_string_lossy().into_owned(), dirs)
        .unwrap_err();
    assert!(err.contains("too many"), "unexpected error: {}", err);
}

#[test]
fn update_tree_watched_dirs_rejects_non_directory() {
    let root_dir = tempfile::tempdir().unwrap();
    let root = canonicalize_no_verbatim(root_dir.path()).unwrap();
    let file_path = root.join("file.txt");
    std::fs::write(&file_path, "hi").unwrap();
    let file_canonical = canonicalize_no_verbatim(&file_path).unwrap();
    let state = make_state();

    let err = state
        .set_tree_watched_dirs(
            root.to_string_lossy().into_owned(),
            vec![file_canonical.to_string_lossy().into_owned()],
        )
        .unwrap_err();
    assert!(err.contains("not a directory"), "unexpected error: {}", err);
}

/// Regression: on Windows, `canonicalize` returns `\\?\C:\...` UNC form, but
/// the frontend passes `C:\...` (sourced from `read_dir`/dialog). The watcher
/// must accept these by canonicalizing internally rather than rejecting any
/// input that doesn't already equal its canonical form. (issue #40)
#[test]
fn accepts_non_canonical_input_via_canonicalization() {
    let dir = tempfile::tempdir().unwrap();
    let sub = dir.path().join("a");
    std::fs::create_dir(&sub).unwrap();
    let state = make_state();
    // Pass the raw, non-canonical paths (whatever tempdir gave us — on
    // Windows these will lack the `\\?\` UNC prefix that canonicalize adds).
    let messy_root = dir.path().to_string_lossy().into_owned();
    let messy_dir = sub.to_string_lossy().into_owned();
    state
        .set_tree_watched_dirs(messy_root, vec![messy_dir])
        .expect("non-canonical inputs must be normalized, not rejected");
    // The stored set must contain the canonical form of `sub`.
    let stored = state.tree_watched_dirs.lock().unwrap();
    assert!(stored.contains(&canonicalize_no_verbatim(&sub).unwrap()));
}

#[test]
fn folder_changed_emitted_for_writes_in_watched_dir() {
    let root_dir = tempfile::tempdir().unwrap();
    let root = canonicalize_no_verbatim(root_dir.path()).unwrap();
    let mut tree_dirs = HashSet::new();
    tree_dirs.insert(root.clone());
    let watched_paths = HashSet::new();

    // Simulate a notify event for a new file inside the watched dir.
    let new_file = root.join("new.md");
    std::fs::write(&new_file, "x").unwrap();
    let new_file_canonical = canonicalize_no_verbatim(&new_file).unwrap();

    let (file_event, folder_dir) = classify_event(&new_file_canonical, &watched_paths, &tree_dirs);
    assert!(
        file_event.is_none(),
        "file-changed must not fire for non-watched file"
    );
    assert_eq!(
        folder_dir.as_deref(),
        Some(root.as_path()),
        "folder-changed must use the canonical dir from tree_dirs"
    );
}

#[test]
fn file_changed_still_fires_for_watched_paths_independently() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("a.md");
    std::fs::write(&file, "x").unwrap();
    let canonical = canonicalize_no_verbatim(&file).unwrap();

    let mut watched_paths = HashSet::new();
    watched_paths.insert(canonical.clone());
    // Empty tree_dirs — folder-changed should NOT fire even though parent exists.
    let tree_dirs = HashSet::new();

    let (file_event, folder_dir) = classify_event(&canonical, &watched_paths, &tree_dirs);
    let ev = file_event.expect("file-changed should fire for watched path");
    assert_eq!(ev.kind, "content");
    assert!(
        folder_dir.is_none(),
        "folder-changed must not fire when parent is not in tree_dirs"
    );
}
