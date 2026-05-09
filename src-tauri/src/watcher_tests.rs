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
            "test",
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
            "test",
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
        .set_tree_watched_dirs("test", root.to_string_lossy().into_owned(), dirs)
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
            "test",
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
        .set_tree_watched_dirs("test", messy_root, vec![messy_dir])
        .expect("non-canonical inputs must be normalized, not rejected");
    // The stored set must contain the canonical form of `sub`.
    let stored = state.tree_watched_dirs.lock().unwrap();
    assert!(stored.get("test").unwrap().contains(&canonicalize_no_verbatim(&sub).unwrap()));
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

#[test]
fn per_window_isolation() {
    let dir_a = tempfile::tempdir().unwrap();
    let dir_b = tempfile::tempdir().unwrap();
    let root_a = canonicalize_no_verbatim(dir_a.path()).unwrap();
    let root_b = canonicalize_no_verbatim(dir_b.path()).unwrap();
    let state = make_state();

    state
        .set_tree_watched_dirs(
            "window-a",
            root_a.to_string_lossy().into_owned(),
            vec![root_a.to_string_lossy().into_owned()],
        )
        .unwrap();
    state
        .set_tree_watched_dirs(
            "window-b",
            root_b.to_string_lossy().into_owned(),
            vec![root_b.to_string_lossy().into_owned()],
        )
        .unwrap();

    // Both stored independently.
    {
        let guard = state.tree_watched_dirs.lock().unwrap();
        assert!(guard.get("window-a").unwrap().contains(&root_a));
        assert!(guard.get("window-b").unwrap().contains(&root_b));
        assert!(!guard.get("window-a").unwrap().contains(&root_b));
    }

    // Remove window-a; window-b survives.
    state.remove_window("window-a");
    {
        let guard = state.tree_watched_dirs.lock().unwrap();
        assert!(!guard.contains_key("window-a"));
        assert!(guard.get("window-b").unwrap().contains(&root_b));
    }
}

#[test]
fn is_path_allowed_checks_all_windows() {
    let dir_a = tempfile::tempdir().unwrap();
    let dir_b = tempfile::tempdir().unwrap();
    let root_a = canonicalize_no_verbatim(dir_a.path()).unwrap();
    let root_b = canonicalize_no_verbatim(dir_b.path()).unwrap();
    let state = make_state();

    // Create files inside each workspace.
    let file_a = root_a.join("a.md");
    let file_b = root_b.join("b.md");
    std::fs::write(&file_a, "a").unwrap();
    std::fs::write(&file_b, "b").unwrap();

    state
        .set_tree_watched_dirs(
            "win-a",
            root_a.to_string_lossy().into_owned(),
            vec![root_a.to_string_lossy().into_owned()],
        )
        .unwrap();
    state
        .set_tree_watched_dirs(
            "win-b",
            root_b.to_string_lossy().into_owned(),
            vec![root_b.to_string_lossy().into_owned()],
        )
        .unwrap();

    // Both files allowed via their respective windows.
    assert!(state.is_path_allowed(&file_a));
    assert!(state.is_path_allowed(&file_b));

    // After removing win-a, file_a is no longer allowed.
    state.remove_window("win-a");
    assert!(!state.is_path_allowed(&file_a));
    assert!(state.is_path_allowed(&file_b));
}

#[test]
fn extra_watched_dirs_includes_workspace_roots_and_sidecar_dirs() {
    let dir = tempfile::tempdir().unwrap();
    let ws = canonicalize_no_verbatim(dir.path()).unwrap();

    // Create a sidecar_root directory
    let sr_dir = ws.join(".reviews");
    std::fs::create_dir(&sr_dir).unwrap();
    let sr_canonical = canonicalize_no_verbatim(&sr_dir).unwrap();

    let state = super::SidecarConfigState::new();
    // Register workspace with sidecar_root
    state.set_config(ws.clone(), Some(std::path::PathBuf::from(".reviews")));

    let dirs = state.extra_watched_dirs();

    // Must include both the workspace root and the sidecar_root dir
    assert!(
        dirs.contains(&ws),
        "extra_watched_dirs must include the workspace root"
    );
    assert!(
        dirs.contains(&sr_canonical),
        "extra_watched_dirs must include the resolved sidecar_root dir"
    );
}

#[test]
fn extra_watched_dirs_empty_when_no_configs() {
    let state = super::SidecarConfigState::new();
    assert!(
        state.extra_watched_dirs().is_empty(),
        "extra_watched_dirs must be empty when no configs are registered"
    );
}

#[test]
fn extra_watched_dirs_skips_nonexistent_sidecar_root() {
    let dir = tempfile::tempdir().unwrap();
    let ws = canonicalize_no_verbatim(dir.path()).unwrap();

    let state = super::SidecarConfigState::new();
    // sidecar_root dir doesn't exist on disk
    state.set_config(ws.clone(), Some(std::path::PathBuf::from(".nonexistent")));

    let dirs = state.extra_watched_dirs();
    // Workspace root is included, but the nonexistent sidecar dir is not
    assert!(dirs.contains(&ws));
    assert_eq!(dirs.len(), 1, "only the workspace root should be present");
}

/// Pins the JSON wire shape that the frontend's `EventPayloads` interface
/// (`src/lib/tauri-events.ts`) and the shared fixtures
/// (`src/__tests__/fixtures/ipc-event-fixtures.ts`) depend on. If a Rust
/// refactor changes the field name, type, or `kind` value set, this test
/// fails loudly  surfacing what would otherwise be a silent
/// test-pass/production-fail gap (the bug class iter-1/iter-3 of #298 hit).
///
/// Cross-references:
///  - `FileChangeEvent` struct at `src-tauri/src/watcher.rs:212`
///  - `FolderChangeEvent` struct at `src-tauri/src/watcher.rs:219`
///  - `kind` classification at `src-tauri/src/watcher.rs:489-496`
///  - Emit sites: `:313` (file-changed) and `:333-337` (folder-changed)
#[test]
fn ipc_event_payloads_serialize_to_frontend_contract() {
    use serde_json::json;

    // file-changed { path, kind }  all three kind values from
    // src-tauri/src/watcher.rs:489-496 ("content" | "review" | "deleted").
    assert_eq!(
        serde_json::to_value(FileChangeEvent {
            path: "/workspace/notes.md".to_string(),
            kind: "content".to_string(),
        })
        .unwrap(),
        json!({ "path": "/workspace/notes.md", "kind": "content" }),
        "FileChangeEvent kind=content wire shape drifted from frontend contract"
    );

    assert_eq!(
        serde_json::to_value(FileChangeEvent {
            path: "/workspace/notes.md.review.yaml".to_string(),
            kind: "review".to_string(),
        })
        .unwrap(),
        json!({ "path": "/workspace/notes.md.review.yaml", "kind": "review" }),
        "FileChangeEvent kind=review (.yaml sidecar) wire shape drifted"
    );

    assert_eq!(
        serde_json::to_value(FileChangeEvent {
            path: "/workspace/notes.md.review.json".to_string(),
            kind: "review".to_string(),
        })
        .unwrap(),
        json!({ "path": "/workspace/notes.md.review.json", "kind": "review" }),
        "FileChangeEvent kind=review (.json sidecar) wire shape drifted"
    );

    assert_eq!(
        serde_json::to_value(FileChangeEvent {
            path: "/workspace/notes.md".to_string(),
            kind: "deleted".to_string(),
        })
        .unwrap(),
        json!({ "path": "/workspace/notes.md", "kind": "deleted" }),
        "FileChangeEvent kind=deleted wire shape drifted"
    );

    // folder-changed { path }  emit at watcher.rs:333-337 (per-window) and
    // commands/sidecar_config.rs:64-66 (broadcast).
    assert_eq!(
        serde_json::to_value(FolderChangeEvent {
            path: "/workspace".to_string(),
        })
        .unwrap(),
        json!({ "path": "/workspace" }),
        "FolderChangeEvent wire shape drifted from frontend contract"
    );
}

#[test]
fn reset_window_scope_clears_both_maps_for_label() {
    let state = make_state();
    let dir = tempfile::tempdir().unwrap();
    let canonical = canonicalize_no_verbatim(dir.path()).unwrap();

    state.seed_window_workspace("main", vec![canonical.clone()]);
    assert!(state.is_path_allowed(&canonical), "precondition: seed succeeds");

    state.reset_window_scope("main");
    assert!(
        !state.is_path_allowed(&canonical),
        "post-reset: tree_watched_dirs[main] should be empty"
    );
}

#[test]
fn reset_window_scope_does_not_affect_other_windows() {
    let state = make_state();
    let dir_main = tempfile::tempdir().unwrap();
    let dir_secondary = tempfile::tempdir().unwrap();
    let canonical_main = canonicalize_no_verbatim(dir_main.path()).unwrap();
    let canonical_secondary = canonicalize_no_verbatim(dir_secondary.path()).unwrap();

    state.seed_window_workspace("main", vec![canonical_main.clone()]);
    state.seed_window_workspace("secondary", vec![canonical_secondary.clone()]);

    state.reset_window_scope("main");

    assert!(
        !state.is_path_allowed(&canonical_main),
        "main's tree_watched_dirs entry should be cleared"
    );
    assert!(
        state.is_path_allowed(&canonical_secondary),
        "secondary's tree_watched_dirs entry should remain"
    );
}

#[test]
fn reset_window_scope_idempotent_on_unseeded_label() {
    let state = make_state();
    state.reset_window_scope("never-seeded");
    // No assertion needed — the test fails iff reset panics or deadlocks.
}
