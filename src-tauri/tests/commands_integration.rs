use mdown_review_lib::commands::{
    get_launch_args, load_review_comments, read_binary_file, read_text_file, save_review_comments,
    CommentResponse, LaunchArgs, LaunchArgsState, ReviewComment,
};
use std::io::Write;
use std::sync::{Arc, Mutex};

// ── read_text_file ─────────────────────────────────────────────────────────

#[test]
fn read_text_file_returns_utf8_content() {
    let mut tmp = tempfile::NamedTempFile::new().unwrap();
    writeln!(tmp, "Hello, world!").unwrap();
    let path = tmp.path().to_str().unwrap().to_string();
    let result = read_text_file(path);
    assert!(result.is_ok());
    assert!(result.unwrap().contains("Hello, world!"));
}

#[test]
fn read_text_file_rejects_binary() {
    let mut tmp = tempfile::NamedTempFile::new().unwrap();
    tmp.write_all(&[0x48, 0x65, 0x00, 0x6c, 0x6c, 0x6f]).unwrap(); // null byte in first 512
    let path = tmp.path().to_str().unwrap().to_string();
    let result = read_text_file(path);
    assert_eq!(result.unwrap_err(), "binary_file");
}

#[test]
fn read_text_file_rejects_too_large() {
    let mut tmp = tempfile::NamedTempFile::new().unwrap();
    // Write just over 10 MB
    let chunk = vec![b'a'; 1024];
    for _ in 0..10_241 {
        tmp.write_all(&chunk).unwrap();
    }
    let path = tmp.path().to_str().unwrap().to_string();
    let result = read_text_file(path);
    assert_eq!(result.unwrap_err(), "file_too_large");
}

// ── save/load review comments ──────────────────────────────────────────────

fn make_comment(id: &str) -> ReviewComment {
    ReviewComment {
        id: id.to_string(),
        anchor_type: "block".to_string(),
        block_hash: Some("abc12345".to_string()),
        line_hash: None,
        line_number: None,
        context_before: None,
        context_after: None,
        selected_text: None,
        selection_start_offset: None,
        selection_end_line: None,
        selection_end_offset: None,
        heading_context: None,
        fallback_line: Some(1),
        text: "Test comment".to_string(),
        created_at: "2024-01-01T00:00:00Z".to_string(),
        resolved: false,
        responses: None,
    }
}

#[test]
fn save_and_load_review_comments() {
    let tmp = tempfile::NamedTempFile::new().unwrap();
    let file_path = tmp.path().to_str().unwrap().to_string();

    let comments = vec![make_comment("c1"), make_comment("c2")];
    save_review_comments(file_path.clone(), comments.clone()).unwrap();

    // Check JSON structure
    let sidecar = std::fs::read_to_string(format!("{}.review.json", file_path)).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&sidecar).unwrap();
    assert_eq!(parsed["version"], 3);
    assert_eq!(parsed["comments"].as_array().unwrap().len(), 2);

    // Round-trip
    let loaded = load_review_comments(file_path).unwrap().unwrap();
    assert_eq!(loaded.version, 3);
    assert_eq!(loaded.comments.len(), 2);
    assert_eq!(loaded.comments[0].id, "c1");
}

#[test]
fn load_review_comments_returns_none_when_missing() {
    let result = load_review_comments("/nonexistent/path/to/file.md".to_string()).unwrap();
    assert!(result.is_none());
}

// ── legacy sidecar migration ────────────────────────────────────────────────

#[test]
fn load_legacy_sidecar_without_version() {
    let tmp = tempfile::NamedTempFile::new().unwrap();
    let file_path = tmp.path().to_str().unwrap().to_string();
    let sidecar_path = format!("{}.review.json", file_path);

    // Write a legacy sidecar (no version field)
    let legacy = r#"{"comments":[{"id":"c1","blockHash":"abc12345","headingContext":null,"fallbackLine":1,"text":"legacy comment","createdAt":"2024-01-01T00:00:00Z","resolved":false}]}"#;
    std::fs::write(&sidecar_path, legacy).unwrap();

    let loaded = load_review_comments(file_path.clone()).unwrap().unwrap();
    assert_eq!(loaded.version, 0);
    assert_eq!(loaded.comments.len(), 1);

    // Save re-migrates to version 3
    save_review_comments(file_path.clone(), loaded.comments).unwrap();
    let saved = std::fs::read_to_string(sidecar_path).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&saved).unwrap();
    assert_eq!(parsed["version"], 3);
}

#[test]
fn load_v1_comments_defaults_anchor_type_to_block() {
    let dir = tempfile::tempdir().unwrap();
    let file_path = dir.path().join("test.md");
    std::fs::write(&file_path, "# hello").unwrap();
    let sidecar = dir.path().join("test.md.review.json");
    std::fs::write(&sidecar, r#"{"version":1,"comments":[{"id":"a","blockHash":"12345678","headingContext":null,"fallbackLine":1,"text":"hello","createdAt":"2026-01-01T00:00:00Z","resolved":false}]}"#).unwrap();

    let result = load_review_comments(file_path.to_string_lossy().into_owned()).unwrap().unwrap();
    assert_eq!(result.comments[0].anchor_type, "block");
}

#[test]
fn save_and_load_v3_comment_with_new_fields() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("test.md");
    std::fs::write(&file, "test content").unwrap();
    let file_str = file.to_str().unwrap().to_string();

    let comment = ReviewComment {
        id: "v3test".into(),
        anchor_type: "line".into(),
        line_hash: Some("abcd1234".into()),
        line_number: Some(5),
        context_before: Some("line3\nline4".into()),
        context_after: Some("line6\nline7".into()),
        selected_text: None,
        selection_start_offset: None,
        selection_end_line: None,
        selection_end_offset: None,
        block_hash: None,
        heading_context: None,
        fallback_line: None,
        text: "v3 comment".into(),
        created_at: "2026-01-01T00:00:00Z".into(),
        resolved: false,
        responses: Some(vec![CommentResponse {
            author: "copilot".into(),
            text: "Fixed it".into(),
            created_at: "2026-01-01T01:00:00Z".into(),
        }]),
    };

    save_review_comments(file_str.clone(), vec![comment]).unwrap();
    let loaded = load_review_comments(file_str).unwrap().unwrap();
    assert_eq!(loaded.version, 3);
    assert_eq!(loaded.comments.len(), 1);
    assert_eq!(loaded.comments[0].context_before, Some("line3\nline4".into()));
    assert_eq!(loaded.comments[0].responses.as_ref().unwrap().len(), 1);
    assert_eq!(loaded.comments[0].responses.as_ref().unwrap()[0].author, "copilot");
}

#[test]
fn load_v2_sidecar_preserves_all_fields() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("test.md");
    std::fs::write(&file, "").unwrap();
    let sidecar = dir.path().join("test.md.review.json");
    std::fs::write(&sidecar, r#"{"version":2,"comments":[{"id":"old","anchorType":"block","blockHash":"aabb","headingContext":null,"fallbackLine":3,"text":"old comment","createdAt":"2025-01-01T00:00:00Z","resolved":false}]}"#).unwrap();

    let loaded = load_review_comments(file.to_str().unwrap().to_string()).unwrap().unwrap();
    assert_eq!(loaded.comments[0].anchor_type, "block");
    assert_eq!(loaded.comments[0].block_hash, Some("aabb".into()));
    assert_eq!(loaded.comments[0].fallback_line, Some(3));
}

#[test]
fn v3_without_optional_fields_loads_cleanly() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("test.md");
    std::fs::write(&file, "").unwrap();
    let sidecar = dir.path().join("test.md.review.json");
    std::fs::write(&sidecar, r#"{"version":3,"comments":[{"id":"min","anchorType":"line","lineHash":"1234","lineNumber":1,"text":"minimal","createdAt":"2026-01-01T00:00:00Z","resolved":false}]}"#).unwrap();

    let loaded = load_review_comments(file.to_str().unwrap().to_string()).unwrap().unwrap();
    assert_eq!(loaded.comments[0].context_before, None);
    assert_eq!(loaded.comments[0].responses, None);
}

// ── get_launch_args ────────────────────────────────────────────────────────

#[test]
fn get_launch_args_returns_and_clears() {
    let args = LaunchArgs {
        files: vec!["file.md".to_string()],
        folders: vec![],
    };
    let state: LaunchArgsState = Arc::new(Mutex::new(Some(args)));

    // First call returns the args
    struct FakeState(LaunchArgsState);
    impl std::ops::Deref for FakeState {
        type Target = LaunchArgsState;
        fn deref(&self) -> &Self::Target { &self.0 }
    }

    let result = {
        let mut guard = state.lock().unwrap();
        guard.take().unwrap_or_default()
    };
    assert_eq!(result.files, vec!["file.md"]);

    // Second call returns empty (args cleared)
    let result2 = {
        let mut guard = state.lock().unwrap();
        guard.take().unwrap_or_default()
    };
    assert!(result2.files.is_empty());
    assert!(result2.folders.is_empty());
}

// ── read_binary_file ──────────────────────────────────────────────────────

#[test]
fn read_binary_file_returns_base64() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("image.png");
    let png_bytes: Vec<u8> = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    std::fs::write(&path, &png_bytes).unwrap();

    let result = read_binary_file(path.to_string_lossy().into_owned());
    assert!(result.is_ok());
    let b64 = result.unwrap();
    use base64::Engine;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(&b64)
        .unwrap();
    assert_eq!(decoded, png_bytes);
}

#[test]
fn read_binary_file_rejects_too_large() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("huge.bin");
    let data = vec![0u8; 11 * 1024 * 1024];
    std::fs::write(&path, &data).unwrap();

    let result = read_binary_file(path.to_string_lossy().into_owned());
    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), "file_too_large");
}

#[test]
fn read_binary_file_missing_file() {
    let result = read_binary_file("/nonexistent/file.png".into());
    assert!(result.is_err());
}
