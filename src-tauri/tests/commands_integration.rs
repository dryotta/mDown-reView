use mdown_review_lib::commands::{
    drain_pending, push_pending, read_binary_file, read_dir,
    read_text_file, CommentsChangedEvent, LaunchArgs, PendingArgsState,
    MrsfComment, MrsfSidecar,
    search_in_document,
};
use mdown_review_lib::core::sidecar::{save_sidecar, load_sidecar};
use mdown_review_lib::watcher::FileChangeEvent;
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

// ── save/load review comments (MRSF) ──────────────────────────────────────

fn make_mrsf_comment(id: &str) -> MrsfComment {
    MrsfComment {
        id: id.to_string(),
        author: "Test User (test)".to_string(),
        timestamp: "2026-04-20T12:00:00-07:00".to_string(),
        text: "Test comment".to_string(),
        resolved: false,
        line: Some(10),
        end_line: None,
        start_column: None,
        end_column: None,
        selected_text: Some("some text".to_string()),
        anchored_text: None,
        selected_text_hash: None,
        commit: None,
        comment_type: Some("suggestion".to_string()),
        severity: Some("high".to_string()),
        reply_to: None,
    }
}

#[test]
fn mrsf_sidecar_yaml_roundtrip() {
    let sidecar = MrsfSidecar {
        mrsf_version: "1.0".to_string(),
        document: "docs/test.md".to_string(),
        comments: vec![make_mrsf_comment("abc-123")],
    };
    let yaml = serde_yaml_ng::to_string(&sidecar).unwrap();
    let parsed: MrsfSidecar = serde_yaml_ng::from_str(&yaml).unwrap();
    assert_eq!(parsed.mrsf_version, "1.0");
    assert_eq!(parsed.comments.len(), 1);
    assert_eq!(parsed.comments[0].line, Some(10));
    assert_eq!(parsed.comments[0].comment_type.as_deref(), Some("suggestion"));
}

#[test]
fn mrsf_sidecar_json_roundtrip() {
    let sidecar = MrsfSidecar {
        mrsf_version: "1.0".to_string(),
        document: "docs/test.md".to_string(),
        comments: vec![],
    };
    let json = serde_json::to_string_pretty(&sidecar).unwrap();
    let parsed: MrsfSidecar = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.mrsf_version, "1.0");
    assert_eq!(parsed.document, "docs/test.md");
}

#[test]
fn mrsf_comment_type_field_serializes_as_type() {
    let comment = make_mrsf_comment("c1");
    let yaml = serde_yaml_ng::to_string(&comment).unwrap();
    assert!(yaml.contains("type: suggestion"), "should serialize as 'type' not 'comment_type'");
}

#[test]
fn mrsf_optional_fields_omitted_when_none() {
    let mut comment = make_mrsf_comment("c1");
    comment.line = None;
    comment.selected_text = None;
    comment.comment_type = None;
    comment.severity = None;
    let yaml = serde_yaml_ng::to_string(&comment).unwrap();
    assert!(!yaml.contains("line:"), "None fields should be omitted");
    assert!(!yaml.contains("selected_text:"), "None fields should be omitted");
}

#[test]
fn save_and_load_mrsf_yaml() {
    let tmp = tempfile::NamedTempFile::new().unwrap();
    let file_path = tmp.path().to_str().unwrap().to_string();

    let comments = vec![make_mrsf_comment("c1"), make_mrsf_comment("c2")];
    save_sidecar(&file_path, "test.md", &comments).unwrap();

    // Check YAML file was created
    let sidecar_path = format!("{}.review.yaml", file_path);
    let content = std::fs::read_to_string(&sidecar_path).unwrap();
    assert!(content.contains("mrsf_version:"));
    assert!(content.contains("document: test.md"));

    // Round-trip via load
    let loaded = load_sidecar(&file_path).unwrap().unwrap();
    assert_eq!(loaded.mrsf_version, "1.0");
    assert_eq!(loaded.document, "test.md");
    assert_eq!(loaded.comments.len(), 2);
    assert_eq!(loaded.comments[0].id, "c1");
}

#[test]
fn load_sidecar_returns_none_when_missing() {
    let result = load_sidecar("/nonexistent/path/to/file.md").unwrap();
    assert!(result.is_none());
}

#[test]
fn save_sidecar_deletes_sidecar_when_empty() {
    let tmp = tempfile::NamedTempFile::new().unwrap();
    let file_path = tmp.path().to_str().unwrap().to_string();
    let sidecar_path = format!("{}.review.yaml", file_path);

    // Write a sidecar with one comment, then save empty to clear it.
    save_sidecar(&file_path, "test.md", &[make_mrsf_comment("c1")]).unwrap();
    assert!(std::path::Path::new(&sidecar_path).exists());

    save_sidecar(&file_path, "test.md", &[]).unwrap();
    assert!(!std::path::Path::new(&sidecar_path).exists(), "empty save should delete the sidecar");

    // Subsequent load should return None (no sidecar).
    let result = load_sidecar(&file_path).unwrap();
    assert!(result.is_none());
}

#[test]
fn save_sidecar_empty_is_noop_when_no_sidecar() {
    let tmp = tempfile::NamedTempFile::new().unwrap();
    let file_path = tmp.path().to_str().unwrap().to_string();
    let sidecar_path = format!("{}.review.yaml", file_path);

    // Saving empty with no pre-existing sidecar must not create one.
    save_sidecar(&file_path, "test.md", &[]).unwrap();
    assert!(!std::path::Path::new(&sidecar_path).exists(), "empty save must not create a sidecar");
}

#[test]
fn load_mrsf_json_fallback() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("test.md");
    std::fs::write(&file, "test content").unwrap();
    let sidecar = dir.path().join("test.md.review.json");
    std::fs::write(&sidecar, r#"{"mrsf_version":"1.0","document":"test.md","comments":[{"id":"j1","author":"A","timestamp":"2026-01-01T00:00:00Z","text":"json comment","resolved":false}]}"#).unwrap();

    let loaded = load_sidecar(file.to_str().unwrap()).unwrap().unwrap();
    assert_eq!(loaded.mrsf_version, "1.0");
    assert_eq!(loaded.comments[0].id, "j1");
}

#[test]
fn yaml_preferred_over_json() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("test.md");
    std::fs::write(&file, "test").unwrap();
    // Create both YAML and JSON sidecars
    let yaml_sidecar = dir.path().join("test.md.review.yaml");
    std::fs::write(&yaml_sidecar, "mrsf_version: '1.0'\ndocument: test.md\ncomments:\n- id: y1\n  author: A\n  timestamp: '2026-01-01T00:00:00Z'\n  text: yaml comment\n  resolved: false\n").unwrap();
    let json_sidecar = dir.path().join("test.md.review.json");
    std::fs::write(&json_sidecar, r#"{"mrsf_version":"1.0","document":"test.md","comments":[{"id":"j1","author":"A","timestamp":"2026-01-01T00:00:00Z","text":"json comment","resolved":false}]}"#).unwrap();

    let loaded = load_sidecar(file.to_str().unwrap()).unwrap().unwrap();
    assert_eq!(loaded.comments[0].id, "y1", "YAML should be preferred over JSON");
}

// ── get_launch_args ────────────────────────────────────────────────────────

#[test]
fn get_launch_args_returns_and_clears() {
    let args = LaunchArgs {
        files: vec!["file.md".to_string()],
        folders: vec![],
    };
    let state: PendingArgsState = Arc::new(Mutex::new(Vec::new()));
    push_pending(&state, args);

    // First drain returns the queued args.
    let result = drain_pending(&state);
    assert_eq!(result.files, vec!["file.md"]);

    // Second drain returns empty (queue cleared).
    let result2 = drain_pending(&state);
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

// ── read_dir ──────────────────────────────────────────────────────────────

#[test]
fn read_dir_hides_review_sidecars() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("readme.md"), "hello").unwrap();
    std::fs::write(dir.path().join("main.rs"), "fn main() {}").unwrap();
    // Both YAML and JSON review sidecars should be hidden
    std::fs::write(dir.path().join("readme.md.review.yaml"), "mrsf_version: '1.0'\ndocument: readme.md\ncomments: []\n").unwrap();
    std::fs::write(dir.path().join("main.rs.review.json"), r#"{"mrsf_version":"1.0","document":"main.rs","comments":[]}"#).unwrap();
    std::fs::write(dir.path().join("config.json"), "{}").unwrap();

    let entries = read_dir(dir.path().to_str().unwrap().to_string()).unwrap();
    let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
    
    assert!(names.contains(&"readme.md"));
    assert!(names.contains(&"main.rs"));
    assert!(names.contains(&"config.json"));
    assert!(!names.contains(&"readme.md.review.yaml"), "YAML review sidecars should be hidden");
    assert!(!names.contains(&"main.rs.review.json"), "JSON review sidecars should be hidden");
}

// ── FileChangeEvent serialization ─────────────────────────────────────────

#[test]
fn file_change_event_serializes_with_correct_fields() {
    let event = FileChangeEvent {
        path: "/project/docs/readme.md".to_string(),
        kind: "content".to_string(),
    };
    let json: serde_json::Value = serde_json::to_value(&event).unwrap();
    assert_eq!(json["path"], "/project/docs/readme.md");
    assert_eq!(json["kind"], "content");
    // Ensure no extra fields are present
    let obj = json.as_object().unwrap();
    assert_eq!(obj.len(), 2, "FileChangeEvent should have exactly 2 fields: path and kind");
}

#[test]
fn file_change_event_serializes_all_kinds() {
    for kind in &["content", "review", "deleted"] {
        let event = FileChangeEvent {
            path: "test.md".to_string(),
            kind: kind.to_string(),
        };
        let json: serde_json::Value = serde_json::to_value(&event).unwrap();
        assert_eq!(json["kind"].as_str().unwrap(), *kind);
    }
}

// ── CommentsChangedEvent ──────────────────────────────────────────────────

#[test]
fn comments_changed_event_serializes_with_file_path() {
    let event = CommentsChangedEvent {
        file_path: "/project/docs/readme.md".to_string(),
    };
    let json: serde_json::Value = serde_json::to_value(&event).unwrap();
    assert_eq!(json["file_path"], "/project/docs/readme.md");
    let obj = json.as_object().unwrap();
    assert_eq!(
        obj.len(),
        1,
        "CommentsChangedEvent should have exactly 1 field: file_path"
    );
}

#[test]
fn comments_changed_event_payload_matches_frontend_listener() {
    // The frontend listener in use-comments.ts:71 expects:
    //   listen<{ file_path: string }>("comments-changed", (event) => {
    //     if (event.payload.file_path === filePath) { ... }
    // This test ensures the Rust payload shape matches that contract.
    let event = CommentsChangedEvent {
        file_path: "src/main.rs".to_string(),
    };
    let json: serde_json::Value = serde_json::to_value(&event).unwrap();
    assert!(
        json.get("file_path").is_some(),
        "payload must have 'file_path' key to match frontend listener"
    );
    assert!(
        json.get("file_path").unwrap().is_string(),
        "file_path must be a string"
    );
}

// ── search_in_document ────────────────────────────────────────────────────

#[test]
fn search_empty_query_returns_empty() {
    let results = search_in_document("hello world".to_string(), "".to_string());
    assert!(results.is_empty());
}

#[test]
fn search_multi_match_single_line() {
    let results = search_in_document("foo bar foo baz foo".to_string(), "foo".to_string());
    assert_eq!(results.len(), 3);
    assert_eq!(results[0].line_index, 0);
    assert_eq!(results[0].start_col, 0);
    assert_eq!(results[0].end_col, 3);
    assert_eq!(results[1].start_col, 8);
    assert_eq!(results[2].start_col, 16);
}

#[test]
fn search_case_insensitive() {
    let results = search_in_document("Hello HELLO hello".to_string(), "hello".to_string());
    assert_eq!(results.len(), 3);
}

#[test]
fn search_no_match() {
    let results = search_in_document("hello world".to_string(), "xyz".to_string());
    assert!(results.is_empty());
}

#[test]
fn search_across_lines() {
    let results = search_in_document("line1 x\nline2 y\nline3 x".to_string(), "x".to_string());
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].line_index, 0);
    assert_eq!(results[1].line_index, 2);
}

#[test]
fn search_unicode_content() {
    let results = search_in_document("café résumé café".to_string(), "café".to_string());
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].start_col, 0);
    assert_eq!(results[0].end_col, 4);
    assert_eq!(results[1].start_col, 12);
    assert_eq!(results[1].end_col, 16);
}

#[test]
fn search_unicode_overlapping_does_not_panic() {
    let results = search_in_document("ééé".to_string(), "é".to_string());
    assert_eq!(results.len(), 3);
    assert_eq!(results[0].start_col, 0);
    assert_eq!(results[0].end_col, 1);
    assert_eq!(results[1].start_col, 1);
    assert_eq!(results[1].end_col, 2);
}

#[test]
fn search_returns_char_indices_not_bytes() {
    let results = search_in_document("日本語テスト hello 日本語テスト".to_string(), "hello".to_string());
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].start_col, 7);
    assert_eq!(results[0].end_col, 12);
}


//  mutate_sidecar_or_create 

#[test]
fn mutate_sidecar_or_create_creates_first_comment_sidecar() {
    use mdown_review_lib::commands::mutate_sidecar_or_create;

    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("doc.md");
    std::fs::write(&file, "hello world\n").unwrap();
    let file_path = file.to_str().unwrap().to_string();
    let sidecar_path = dir.path().join("doc.md.review.yaml");

    // Precondition: no sidecar yet.
    assert!(!sidecar_path.exists());

    mutate_sidecar_or_create(&file_path, None, |sidecar| {
        sidecar.comments.push(make_mrsf_comment("first-comment"));
        Ok(())
    })
    .unwrap();

    // Sidecar must now exist with the new comment.
    assert!(sidecar_path.exists(), "sidecar should be created on first comment");
    let loaded = load_sidecar(&file_path).unwrap().unwrap();
    assert_eq!(loaded.comments.len(), 1);
    assert_eq!(loaded.comments[0].id, "first-comment");
    assert_eq!(loaded.document, "doc.md");
    assert_eq!(loaded.mrsf_version, "1.0");
}

#[test]
fn mutate_sidecar_or_create_appends_to_existing() {
    use mdown_review_lib::commands::mutate_sidecar_or_create;

    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("doc.md");
    std::fs::write(&file, "hello\n").unwrap();
    let file_path = file.to_str().unwrap().to_string();

    // Pre-create a sidecar with one comment.
    save_sidecar(&file_path, "doc.md", &[make_mrsf_comment("c1")]).unwrap();

    mutate_sidecar_or_create(&file_path, None, |sidecar| {
        sidecar.comments.push(make_mrsf_comment("c2"));
        Ok(())
    })
    .unwrap();

    let loaded = load_sidecar(&file_path).unwrap().unwrap();
    assert_eq!(loaded.comments.len(), 2);
    assert_eq!(loaded.comments[0].id, "c1");
    assert_eq!(loaded.comments[1].id, "c2");
}

#[test]
fn mutate_sidecar_or_create_error_does_not_write_partial() {
    use mdown_review_lib::commands::mutate_sidecar_or_create;

    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("doc.md");
    std::fs::write(&file, "hello\n").unwrap();
    let file_path = file.to_str().unwrap().to_string();
    let sidecar_path = dir.path().join("doc.md.review.yaml");

    // Precondition: no sidecar yet.
    assert!(!sidecar_path.exists());

    let result = mutate_sidecar_or_create(&file_path, None, |_sidecar| {
        Err("simulated".to_string())
    });

    // The mutation closure failed → the helper must propagate the error
    // and must NOT have written a partial/empty sidecar to disk.
    assert!(result.is_err(), "expected Err from failing mutate closure");
    assert_eq!(result.unwrap_err(), "simulated");
    assert!(
        !sidecar_path.exists(),
        "sidecar must not be created when the mutate closure errors out"
    );
}

#[test]
fn mutate_sidecar_or_create_uses_filename_default_when_document_default_is_none() {
    use mdown_review_lib::commands::mutate_sidecar_or_create;

    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("notes.md");
    std::fs::write(&file, "x\n").unwrap();
    let file_path = file.to_str().unwrap().to_string();

    // Pass document_default = None so the helper falls back to the file's basename.
    mutate_sidecar_or_create(&file_path, None, |sidecar| {
        sidecar.comments.push(make_mrsf_comment("c0"));
        Ok(())
    })
    .unwrap();

    let loaded = load_sidecar(&file_path).unwrap().unwrap();
    assert_eq!(loaded.document, "notes.md");
    assert_eq!(loaded.comments.len(), 1);
}
