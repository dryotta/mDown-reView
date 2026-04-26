//! Tests for sidecar load/save/patch. Extracted to keep mod.rs under
//! the 400-LOC budget (rule 23 in docs/architecture.md).

use super::*;
use crate::core::types::MrsfComment;
use tempfile::TempDir;

fn sample_comment(id: &str) -> MrsfComment {
    MrsfComment {
        id: id.to_string(),
        author: "test".to_string(),
        timestamp: "2025-01-01T00:00:00Z".to_string(),
        text: "test comment".to_string(),
        resolved: false,
        line: Some(1),
        end_line: None,
        start_column: None,
        end_column: None,
        selected_text: None,
        anchored_text: None,
        selected_text_hash: None,
        commit: None,
        comment_type: None,
        severity: None,
        reply_to: None,
        ..Default::default()
    }
}

#[test]
fn load_sidecar_yaml() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("test.md");
    let sidecar_path = tmp.path().join("test.md.review.yaml");
    std::fs::write(&file_path, "# Test").unwrap();
    std::fs::write(
        &sidecar_path,
        r#"mrsf_version: "1.0"
document: test.md
comments:
  - id: "c1"
    author: "test"
    timestamp: "2025-01-01T00:00:00Z"
    text: "hello"
    resolved: false
"#,
    )
    .unwrap();

    let result = load_sidecar(file_path.to_str().unwrap()).unwrap();
    assert!(result.is_some());
    let sidecar = result.unwrap();
    assert_eq!(sidecar.comments.len(), 1);
    assert_eq!(sidecar.comments[0].id, "c1");
}

#[test]
fn load_sidecar_json_fallback() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("test.md");
    let json_path = tmp.path().join("test.md.review.json");
    std::fs::write(&file_path, "# Test").unwrap();
    std::fs::write(
            &json_path,
            r#"{"mrsf_version":"1.0","document":"test.md","comments":[{"id":"c1","author":"test","timestamp":"2025-01-01T00:00:00Z","text":"hello","resolved":false}]}"#,
        )
        .unwrap();

    let result = load_sidecar(file_path.to_str().unwrap()).unwrap();
    assert!(result.is_some());
    assert_eq!(result.unwrap().comments[0].id, "c1");
}

#[test]
fn load_sidecar_missing_returns_none() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("nonexistent.md");
    let result = load_sidecar(file_path.to_str().unwrap()).unwrap();
    assert!(result.is_none());
}

#[test]
fn save_sidecar_writes_yaml() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("test.md");
    std::fs::write(&file_path, "# Test").unwrap();

    let comments = vec![sample_comment("c1")];
    save_sidecar(file_path.to_str().unwrap(), "test.md", &comments).unwrap();

    let sidecar_path = tmp.path().join("test.md.review.yaml");
    assert!(sidecar_path.exists());
    let content = std::fs::read_to_string(&sidecar_path).unwrap();
    assert!(content.contains("mrsf_version"));
    assert!(content.contains("c1"));
}

#[test]
fn save_sidecar_emits_v1_0_for_legacy_comments() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("test.md");
    std::fs::write(&file_path, "# Test").unwrap();

    let comments = vec![sample_comment("c1")];
    save_sidecar(file_path.to_str().unwrap(), "test.md", &comments).unwrap();

    let sidecar_path = tmp.path().join("test.md.review.yaml");
    let content = std::fs::read_to_string(&sidecar_path).unwrap();
    let reloaded: crate::core::types::MrsfSidecar = serde_yaml_ng::from_str(&content).unwrap();
    // Pure-legacy comment ⇒ writer must NOT emit "1.1" (advisory #5).
    assert_eq!(reloaded.mrsf_version, "1.0");
}

#[test]
fn save_sidecar_emits_v1_1_when_v1_1_field_present() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("test.md");
    std::fs::write(&file_path, "# Test").unwrap();

    let mut c = sample_comment("c1");
    c.reactions = Some(vec![crate::core::types::Reaction {
        user: "u".into(),
        kind: "thumbs_up".into(),
        ts: "2025-01-01T00:00:00Z".into(),
    }]);
    save_sidecar(file_path.to_str().unwrap(), "test.md", &[c]).unwrap();

    let sidecar_path = tmp.path().join("test.md.review.yaml");
    let content = std::fs::read_to_string(&sidecar_path).unwrap();
    let reloaded: crate::core::types::MrsfSidecar = serde_yaml_ng::from_str(&content).unwrap();
    assert_eq!(reloaded.mrsf_version, "1.1");
}

#[test]
fn save_sidecar_empty_deletes() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("test.md");
    let sidecar_path = tmp.path().join("test.md.review.yaml");
    std::fs::write(&file_path, "# Test").unwrap();
    std::fs::write(&sidecar_path, "dummy").unwrap();

    save_sidecar(file_path.to_str().unwrap(), "test.md", &[]).unwrap();
    assert!(!sidecar_path.exists());
}

#[test]
fn patch_comment_resolve() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("test.md");
    std::fs::write(&file_path, "# Test").unwrap();

    let comments = vec![sample_comment("c1"), sample_comment("c2")];
    save_sidecar(file_path.to_str().unwrap(), "test.md", &comments).unwrap();

    patch_comment(
        file_path.to_str().unwrap(),
        "c1",
        &[CommentMutation::SetResolved(true)],
    )
    .unwrap();

    let loaded = load_sidecar(file_path.to_str().unwrap()).unwrap().unwrap();
    assert!(
        loaded
            .comments
            .iter()
            .find(|c| c.id == "c1")
            .unwrap()
            .resolved
    );
    assert!(
        !loaded
            .comments
            .iter()
            .find(|c| c.id == "c2")
            .unwrap()
            .resolved
    );
}

#[test]
fn patch_comment_add_response() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("test.md");
    std::fs::write(&file_path, "# Test").unwrap();

    let comments = vec![sample_comment("c1")];
    save_sidecar(file_path.to_str().unwrap(), "test.md", &comments).unwrap();

    patch_comment(
        file_path.to_str().unwrap(),
        "c1",
        &[CommentMutation::AddResponse {
            author: "agent".to_string(),
            text: "fixed it".to_string(),
            timestamp: "2025-01-02T00:00:00Z".to_string(),
        }],
    )
    .unwrap();

    let content = std::fs::read_to_string(tmp.path().join("test.md.review.yaml")).unwrap();
    assert!(content.contains("fixed it"));
    assert!(content.contains("responses"));
}

#[test]
fn patch_comment_not_found() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("test.md");
    std::fs::write(&file_path, "# Test").unwrap();

    let comments = vec![sample_comment("c1")];
    save_sidecar(file_path.to_str().unwrap(), "test.md", &comments).unwrap();

    let result = patch_comment(
        file_path.to_str().unwrap(),
        "nonexistent",
        &[CommentMutation::SetResolved(true)],
    );
    assert!(matches!(result, Err(SidecarError::CommentNotFound(_))));
}

#[test]
fn load_sidecar_rejects_yaml_anchors() {
    // Defense-in-depth against billion-laughs amplification past the
    // 10 MB byte cap. We never emit YAML anchors/aliases, so any
    // appearance in a sidecar is treated as malicious.
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("anchored.md");
    let yaml_path = tmp.path().join("anchored.md.review.yaml");
    std::fs::write(&file_path, "# t").unwrap();
    let payload = "mrsf_version: \"1.0\"\ndocument: t.md\ncomments:\n  - &c1 { id: a }\n  - *c1\n";
    std::fs::write(&yaml_path, payload).unwrap();

    let err = load_sidecar(file_path.to_str().unwrap()).unwrap_err();
    match err {
        SidecarError::Io(io) => {
            assert_eq!(io.kind(), std::io::ErrorKind::InvalidData);
            assert!(io.to_string().contains("anchors/aliases"));
        }
        other => panic!("expected SidecarError::Io, got {:?}", other),
    }
}
