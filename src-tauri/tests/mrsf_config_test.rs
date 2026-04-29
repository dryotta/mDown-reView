//! Integration tests for .mrsf.yaml sidecar_root redirection.
//! Proves the end-to-end flow: config load → path resolve → sidecar I/O.

use mdown_review_lib::commands::comments::{
    get_file_comments_inner, get_file_badges_inner, mutate_sidecar_or_create, BadgeCache,
};
use mdown_review_lib::core::paths::{canonicalize_no_verbatim, ensure_sidecar_parent, load_mrsf_config, resolve_sidecar_for_file};
use mdown_review_lib::core::sidecar::config::SidecarConfigState;
use mdown_review_lib::core::sidecar::{load_sidecar_at, save_sidecar_at};
use mdown_review_lib::core::types::MrsfComment;
use mdown_review_lib::watcher::WatcherState;
use std::path::PathBuf;
use tempfile::tempdir;

/// Helper: create a minimal `MrsfComment` for testing.
fn create_test_comment(id: &str, text: &str) -> MrsfComment {
    MrsfComment {
        id: id.to_string(),
        author: "test".to_string(),
        text: text.to_string(),
        timestamp: "2024-01-01T00:00:00Z".to_string(),
        ..Default::default()
    }
}

#[test]
fn save_then_load_under_sidecar_root() {
    let dir = tempdir().unwrap();
    let ws = canonicalize_no_verbatim(dir.path()).unwrap();

    // Write .mrsf.yaml
    std::fs::write(ws.join(".mrsf.yaml"), "sidecar_root: .reviews\n").unwrap();

    // Load config
    let config = load_mrsf_config(&ws).unwrap();
    assert_eq!(config, Some(PathBuf::from(".reviews")));

    // Create a source file
    let src_dir = ws.join("docs");
    std::fs::create_dir_all(&src_dir).unwrap();
    std::fs::write(src_dir.join("readme.md"), "# Hello").unwrap();

    // Resolve sidecar path
    let file_path = src_dir.join("readme.md");
    let sidecar = resolve_sidecar_for_file(&ws, &file_path, &config).unwrap();

    // Should point into .reviews/docs/readme.md.review.yaml
    assert!(
        sidecar.to_string_lossy().contains(".reviews"),
        "sidecar path should contain .reviews, got: {}",
        sidecar.display()
    );
    assert!(
        sidecar.to_string_lossy().ends_with("readme.md.review.yaml"),
        "sidecar path should end with readme.md.review.yaml, got: {}",
        sidecar.display()
    );

    // Ensure parent dirs exist
    ensure_sidecar_parent(&ws, &sidecar).unwrap();

    // Save a comment
    let comment = create_test_comment("c1", "Test comment");
    save_sidecar_at(&sidecar, "readme.md", &[comment]).unwrap();

    // Verify file landed in .reviews dir
    assert!(sidecar.exists(), "sidecar should exist at {}", sidecar.display());
    assert!(
        !file_path.with_extension("md.review.yaml").exists(),
        "sidecar should NOT be co-located with source file"
    );

    // Load it back via load_sidecar_at
    let yaml_str = sidecar.to_string_lossy().to_string();
    let json_str = yaml_str.replace(".review.yaml", ".review.json");
    let loaded = load_sidecar_at(&yaml_str, &json_str).unwrap();
    assert!(loaded.is_some(), "loaded sidecar should be Some");
    let loaded = loaded.unwrap();
    assert_eq!(loaded.comments.len(), 1);
    assert_eq!(loaded.comments[0].id, "c1");
}

#[test]
fn colocated_ignored_when_sidecar_root_set() {
    let dir = tempdir().unwrap();
    let ws = canonicalize_no_verbatim(dir.path()).unwrap();

    // Create a co-located sidecar
    std::fs::write(ws.join("readme.md"), "# Hello").unwrap();
    std::fs::write(
        ws.join("readme.md.review.yaml"),
        "mrsf_version: '1.0'\ndocument: readme.md\ncomments: []\n",
    )
    .unwrap();

    // Now configure sidecar_root
    let config = Some(PathBuf::from(".reviews"));

    // Resolve should point to .reviews, NOT the co-located file
    let file_path = ws.join("readme.md");
    let sidecar = resolve_sidecar_for_file(&ws, &file_path, &config).unwrap();
    assert!(
        sidecar.to_string_lossy().contains(".reviews"),
        "sidecar path should redirect to .reviews, got: {}",
        sidecar.display()
    );

    // load_sidecar_at with the redirected paths should find nothing
    let yaml_str = sidecar.to_string_lossy().to_string();
    let json_str = yaml_str.replace(".review.yaml", ".review.json");
    let loaded = load_sidecar_at(&yaml_str, &json_str).unwrap();
    assert!(loaded.is_none(), "co-located sidecar should be ignored");
}

#[test]
fn json_fallback_under_sidecar_root() {
    let dir = tempdir().unwrap();
    let ws = canonicalize_no_verbatim(dir.path()).unwrap();
    let config = Some(PathBuf::from(".reviews"));

    // Create source file
    std::fs::write(ws.join("readme.md"), "# Hello").unwrap();

    // Create JSON sidecar under .reviews (not YAML)
    let json_dir = ws.join(".reviews");
    std::fs::create_dir_all(&json_dir).unwrap();
    std::fs::write(
        json_dir.join("readme.md.review.json"),
        r#"{"mrsf_version":"1.0","document":"readme.md","comments":[]}"#,
    )
    .unwrap();

    // Resolve should find the JSON file
    let file_path = ws.join("readme.md");
    let sidecar = resolve_sidecar_for_file(&ws, &file_path, &config).unwrap();
    assert!(
        sidecar.to_string_lossy().ends_with(".review.json"),
        "resolve should find JSON fallback, got: {}",
        sidecar.display()
    );

    // load_sidecar_at should load it
    let yaml_path = sidecar
        .to_string_lossy()
        .replace(".review.json", ".review.yaml");
    let json_path = sidecar.to_string_lossy().to_string();
    let loaded = load_sidecar_at(&yaml_path, &json_path).unwrap();
    assert!(loaded.is_some(), "JSON sidecar should be loadable");
}

/// End-to-end: `SidecarConfigState` + `resolve_sidecar_pair` +
/// `mutate_sidecar_or_create` routes sidecar writes through
/// the configured `sidecar_root` directory.
#[test]
fn sidecar_config_state_routes_through_sidecar_root() {
    use mdown_review_lib::commands::mutate_sidecar_or_create;
    use mdown_review_lib::core::paths::canonicalize_no_verbatim;
    use mdown_review_lib::watcher::SidecarConfigState;

    let dir = tempdir().unwrap();
    let ws = dir.path();

    // Write .mrsf.yaml with sidecar_root
    std::fs::write(ws.join(".mrsf.yaml"), "sidecar_root: .reviews\n").unwrap();

    // Create a source file
    std::fs::create_dir_all(ws.join("src")).unwrap();
    std::fs::write(ws.join("src").join("app.rs"), "fn main() {}").unwrap();

    // Load config and populate SidecarConfigState
    let canonical_ws = canonicalize_no_verbatim(ws).unwrap();
    let config = load_mrsf_config(ws).unwrap();
    let state = SidecarConfigState::new();
    state.set_config(canonical_ws.clone(), config);

    // Use mutate_sidecar_or_create with the config state
    let file_path = canonicalize_no_verbatim(&ws.join("src").join("app.rs")).unwrap();
    let file_path_str = file_path.to_string_lossy().to_string();

    mutate_sidecar_or_create(&file_path_str, Some("app.rs".into()), &state, |sidecar| {
        sidecar.comments.push(create_test_comment("c1", "Test via config state"));
        Ok(())
    })
    .unwrap();

    // Verify sidecar was written under .reviews, not co-located
    let colocated = ws.join("src").join("app.rs.review.yaml");
    assert!(
        !colocated.exists(),
        "sidecar must NOT be co-located when sidecar_root is configured"
    );

    let redirected = ws.join(".reviews").join("src").join("app.rs.review.yaml");
    assert!(
        redirected.exists(),
        "sidecar must be under .reviews/src/app.rs.review.yaml, checked: {}",
        redirected.display()
    );

    // Load it back and verify
    let yaml_str = redirected.to_string_lossy().to_string();
    let json_str = yaml_str.replace(".review.yaml", ".review.json");
    let loaded = load_sidecar_at(&yaml_str, &json_str).unwrap().unwrap();
    assert_eq!(loaded.comments.len(), 1);
    assert_eq!(loaded.comments[0].id, "c1");
    assert_eq!(loaded.comments[0].text, "Test via config state");
}

/// Verify `SidecarConfigState::new()` (empty config) falls back
/// to co-located sidecars — the default behaviour.
#[test]
fn sidecar_config_state_empty_uses_colocated() {
    use mdown_review_lib::commands::mutate_sidecar_or_create;
    use mdown_review_lib::watcher::SidecarConfigState;

    let dir = tempdir().unwrap();
    let ws = dir.path();
    std::fs::write(ws.join("doc.md"), "# Hello").unwrap();
    let file_path = ws.join("doc.md").to_string_lossy().to_string();

    let state = SidecarConfigState::new();
    mutate_sidecar_or_create(&file_path, None, &state, |sidecar| {
        sidecar.comments.push(create_test_comment("c1", "colocated"));
        Ok(())
    })
    .unwrap();

    let colocated = ws.join("doc.md.review.yaml");
    assert!(
        colocated.exists(),
        "sidecar must be co-located when no config is set"
    );
}

/// AC15 regression: config disappearing mid-session gracefully falls back
/// to co-located sidecars.  Proves that:
/// 1. While `.mrsf.yaml` is present, comments land under `sidecar_root`.
/// 2. After `.mrsf.yaml` is deleted and `load_mrsf_config` returns `None`,
///    new comments land co-located with the source file.
/// 3. Previously-saved redirected sidecars remain intact and loadable.
#[test]
fn config_disappearing_falls_back_to_colocated() {
    use mdown_review_lib::watcher::SidecarConfigState;

    let dir = tempdir().unwrap();
    let ws = canonicalize_no_verbatim(dir.path()).unwrap();

    // ── Phase 1: sidecar_root active ──
    std::fs::write(ws.join(".mrsf.yaml"), "sidecar_root: .reviews\n").unwrap();
    let config = load_mrsf_config(&ws).unwrap();
    assert_eq!(config, Some(PathBuf::from(".reviews")));

    // Create source file
    std::fs::create_dir_all(ws.join("docs")).unwrap();
    std::fs::write(ws.join("docs/a.md"), "# A").unwrap();

    let file_path = ws.join("docs").join("a.md");
    let sidecar = resolve_sidecar_for_file(&ws, &file_path, &config).unwrap();
    ensure_sidecar_parent(&ws, &sidecar).unwrap();
    save_sidecar_at(&sidecar, "a.md", &[create_test_comment("c1", "Under sidecar_root")]).unwrap();
    assert!(sidecar.exists(), "redirected sidecar must exist");

    // Verify the SidecarConfigState flow also routes through sidecar_root
    let state = SidecarConfigState::new();
    state.set_config(ws.clone(), config);

    // ── Phase 2: config disappears ──
    std::fs::remove_file(ws.join(".mrsf.yaml")).unwrap();
    let config2 = load_mrsf_config(&ws).unwrap();
    assert!(config2.is_none(), "config must be None after deletion");

    // Update the state to reflect the missing config (simulates watcher reload)
    state.set_config(ws.clone(), config2.clone());

    // Save another comment — should go co-located now
    let sidecar2 = resolve_sidecar_for_file(&ws, &file_path, &config2).unwrap();
    save_sidecar_at(&sidecar2, "a.md", &[create_test_comment("c2", "Co-located")]).unwrap();

    // Verify: co-located sidecar exists
    let colocated = PathBuf::from(format!("{}.review.yaml", file_path.display()));
    assert!(colocated.exists(), "co-located sidecar must exist after config removal");

    // Old redirected sidecar must still be intact
    assert!(sidecar.exists(), "old redirected sidecar must remain untouched");

    // Both sidecars are loadable independently
    let yaml1 = sidecar.to_string_lossy().to_string();
    let json1 = yaml1.replace(".review.yaml", ".review.json");
    let loaded1 = load_sidecar_at(&yaml1, &json1).unwrap().unwrap();
    assert_eq!(loaded1.comments.len(), 1);
    assert_eq!(loaded1.comments[0].id, "c1");
    assert_eq!(loaded1.comments[0].text, "Under sidecar_root");

    let yaml2 = colocated.to_string_lossy().to_string();
    let json2 = yaml2.replace(".review.yaml", ".review.json");
    let loaded2 = load_sidecar_at(&yaml2, &json2).unwrap().unwrap();
    assert_eq!(loaded2.comments.len(), 1);
    assert_eq!(loaded2.comments[0].id, "c2");
    assert_eq!(loaded2.comments[0].text, "Co-located");
}

// ---------------------------------------------------------------------------
// Missing coverage: command-layer round-trips under sidecar_root
// ---------------------------------------------------------------------------

#[test]
fn get_file_comments_inner_with_active_sidecar_root() {
    let dir = tempdir().unwrap();
    let ws = dir.path();

    // Create source file + config
    std::fs::write(ws.join("readme.md"), "# Hello\nLine 2").unwrap();
    std::fs::write(ws.join(".mrsf.yaml"), "sidecar_root: .reviews\n").unwrap();

    let canonical_ws = canonicalize_no_verbatim(ws).unwrap();
    let config = load_mrsf_config(&canonical_ws).unwrap();

    // Populate SidecarConfigState
    let state = SidecarConfigState::new();
    state.set_config(canonical_ws.clone(), config.clone());

    // Save a comment under sidecar_root
    let file_path = canonical_ws.join("readme.md");
    let file_str = file_path.to_string_lossy().to_string();
    mutate_sidecar_or_create(&file_str, Some("readme.md".into()), &state, |sidecar| {
        sidecar.comments.push(create_test_comment("c1", "From sidecar_root"));
        Ok(())
    }).unwrap();

    // get_file_comments_inner should find the comment via the same config
    let result = get_file_comments_inner(&file_str, &state).unwrap();
    assert!(!result.threads.is_empty(), "should find comments under sidecar_root");
    assert_eq!(result.threads[0].root.comment.text, "From sidecar_root");
    assert!(result.sidecar_mtime_ms.is_some(), "mtime should be populated");
}

#[test]
fn get_file_badges_inner_with_active_sidecar_root() {
    let dir = tempdir().unwrap();
    let ws = dir.path();

    // Create source file + config
    std::fs::write(ws.join("readme.md"), "# Hello").unwrap();
    std::fs::write(ws.join(".mrsf.yaml"), "sidecar_root: .reviews\n").unwrap();

    let canonical_ws = canonicalize_no_verbatim(ws).unwrap();
    let config = load_mrsf_config(&canonical_ws).unwrap();

    // Set up state
    let config_state = SidecarConfigState::new();
    config_state.set_config(canonical_ws.clone(), config.clone());
    let (sync_tx, _sync_rx) = std::sync::mpsc::sync_channel::<()>(1);
    let watcher_state = WatcherState::new(sync_tx);
    watcher_state.set_tree_watched_dirs(
        "test",
        canonical_ws.to_string_lossy().into_owned(),
        vec![canonical_ws.to_string_lossy().into_owned()],
    ).unwrap();

    // Save a comment
    let file_path = canonical_ws.join("readme.md");
    let file_str = file_path.to_string_lossy().to_string();
    mutate_sidecar_or_create(&file_str, Some("readme.md".into()), &config_state, |sidecar| {
        sidecar.comments.push(create_test_comment("c1", "Badge test"));
        Ok(())
    }).unwrap();

    // get_file_badges should find badge via sidecar_root
    let cache = BadgeCache::new();
    let badges = get_file_badges_inner(&watcher_state, &config_state, &cache, &[file_str.clone()]);
    assert!(badges.contains_key(&file_str), "badge should exist for file under sidecar_root");
    assert_eq!(badges[&file_str].count, 1);
}

#[test]
fn resolve_for_file_nested_workspace_longest_prefix() {
    let dir = tempdir().unwrap();
    let outer = dir.path().join("outer");
    let inner = outer.join("inner");
    std::fs::create_dir_all(&inner).unwrap();

    let canonical_outer = canonicalize_no_verbatim(&outer).unwrap();
    let canonical_inner = canonicalize_no_verbatim(&inner).unwrap();

    let state = SidecarConfigState::new();
    state.set_config(canonical_outer.clone(), Some(PathBuf::from(".reviews-outer")));
    state.set_config(canonical_inner.clone(), Some(PathBuf::from(".reviews-inner")));

    // File in inner workspace should resolve to inner config
    let file = inner.join("doc.md");
    std::fs::write(&file, "# Doc").unwrap();
    let result = state.resolve_for_file(&file);
    assert!(result.is_some(), "should find a matching workspace");
    let (ws_root, sr) = result.unwrap();
    assert_eq!(ws_root, canonical_inner, "should match inner (most specific) workspace");
    assert_eq!(sr, Some(PathBuf::from(".reviews-inner")));

    // File in outer (but not inner) should resolve to outer config
    let outer_file = outer.join("top.md");
    std::fs::write(&outer_file, "# Top").unwrap();
    let result2 = state.resolve_for_file(&outer_file);
    assert!(result2.is_some());
    let (ws_root2, sr2) = result2.unwrap();
    assert_eq!(ws_root2, canonical_outer, "should match outer workspace");
    assert_eq!(sr2, Some(PathBuf::from(".reviews-outer")));
}
