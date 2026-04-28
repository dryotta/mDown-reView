//! Integration tests for .mrsf.yaml sidecar_root redirection.
//! Proves the end-to-end flow: config load → path resolve → sidecar I/O.

use mdown_review_lib::core::paths::{ensure_sidecar_parent, load_mrsf_config, resolve_sidecar_for_file};
use mdown_review_lib::core::sidecar::{load_sidecar_at, save_sidecar_at};
use mdown_review_lib::core::types::MrsfComment;
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
    let ws = dir.path();

    // Write .mrsf.yaml
    std::fs::write(ws.join(".mrsf.yaml"), "sidecar_root: .reviews\n").unwrap();

    // Load config
    let config = load_mrsf_config(ws).unwrap();
    assert_eq!(config, Some(PathBuf::from(".reviews")));

    // Create a source file
    let src_dir = ws.join("docs");
    std::fs::create_dir_all(&src_dir).unwrap();
    std::fs::write(src_dir.join("readme.md"), "# Hello").unwrap();

    // Resolve sidecar path
    let file_path = src_dir.join("readme.md");
    let sidecar = resolve_sidecar_for_file(ws, &file_path, &config).unwrap();

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
    ensure_sidecar_parent(ws, &sidecar).unwrap();

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
    let ws = dir.path();

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
    let sidecar = resolve_sidecar_for_file(ws, &file_path, &config).unwrap();
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
    let ws = dir.path();
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
    let sidecar = resolve_sidecar_for_file(ws, &file_path, &config).unwrap();
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
