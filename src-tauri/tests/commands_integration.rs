use mdown_review_lib::commands::{
    drain_pending, push_pending, read_binary_file, read_dir, read_text_file, search_in_document,
    stat_file_inner, CommentsChangedEvent, LaunchArgs, MrsfComment, MrsfSidecar, PendingArgsState,
};
use mdown_review_lib::core::sidecar::{load_sidecar, save_sidecar};
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
    assert!(result.unwrap().content.contains("Hello, world!"));
}

#[test]
fn read_text_file_returns_size_and_line_count() {
    let mut tmp = tempfile::NamedTempFile::new().unwrap();
    // 3 lines, each terminated with \n → 3 lines per str::lines
    tmp.write_all(b"alpha\nbeta\ngamma\n").unwrap();
    let path = tmp.path().to_str().unwrap().to_string();
    let result = read_text_file(path).unwrap();
    assert_eq!(result.content, "alpha\nbeta\ngamma\n");
    assert_eq!(result.size_bytes, 17);
    assert_eq!(result.line_count, 3);
}

#[test]
fn read_text_file_rejects_binary() {
    let mut tmp = tempfile::NamedTempFile::new().unwrap();
    tmp.write_all(&[0x48, 0x65, 0x00, 0x6c, 0x6c, 0x6f])
        .unwrap(); // null byte in first 512
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
        ..Default::default()
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
    assert_eq!(
        parsed.comments[0].comment_type.as_deref(),
        Some("suggestion")
    );
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
    assert!(
        yaml.contains("type: suggestion"),
        "should serialize as 'type' not 'comment_type'"
    );
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
    assert!(
        !yaml.contains("selected_text:"),
        "None fields should be omitted"
    );
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
    assert!(
        !std::path::Path::new(&sidecar_path).exists(),
        "empty save should delete the sidecar"
    );

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
    assert!(
        !std::path::Path::new(&sidecar_path).exists(),
        "empty save must not create a sidecar"
    );
}

/// C1 (iter-5 forward fix): the wire-side anchor enum used by `add_comment`
/// must accept the tagged `{ kind: "file" }` shape (not just legacy flat
/// `{ line: N }`), and a comment created with that shape must round-trip
/// through the sidecar with `Anchor::File`. Previously the IPC param was
/// typed `Option<CommentAnchor>` (line required) so file-anchored comments
/// silently failed deserialisation and the renderer's `.catch(() => {})`
/// hid the failure.
#[test]
fn add_comment_accepts_file_kind_anchor() {
    use mdown_review_lib::commands::{mutate_sidecar_or_create, NewCommentAnchor};
    use mdown_review_lib::core::types::Anchor;

    // 1. The wire enum deserialises `{ "kind": "file" }`.
    let parsed: NewCommentAnchor =
        serde_json::from_value(serde_json::json!({ "kind": "file" })).expect("file-anchor JSON");
    let (canonical, flat) = parsed.into_anchor_pair();
    assert!(matches!(canonical, Anchor::File));
    assert!(
        flat.is_none(),
        "File anchor must not produce flat line fields"
    );

    // 2. End-to-end via the same sidecar helper add_comment uses.
    let dir = tempfile::tempdir().unwrap();
    let file_path_buf = dir.path().join("doc.md");
    std::fs::write(&file_path_buf, "alpha\nbeta\n").unwrap();
    let file_path = file_path_buf.to_str().unwrap().to_string();

    mutate_sidecar_or_create(&file_path, Some("doc.md".into()), |sidecar| {
        let mut c = MrsfComment {
            id: "file-anchored-1".into(),
            author: "Tester".into(),
            timestamp: "2026-04-25T12:00:00Z".into(),
            text: "high-level file note".into(),
            resolved: false,
            anchor: canonical.clone(),
            ..Default::default()
        };
        // Mirror add_comment's flat-field clearing for non-Line anchors.
        c.line = None;
        sidecar.comments.push(c);
        Ok(())
    })
    .unwrap();

    // 3. get_file_comments_inner returns the comment with Anchor::File.
    let threads =
        mdown_review_lib::commands::get_file_comments_inner(&file_path).expect("get_file_comments");
    assert_eq!(threads.len(), 1, "expected one file-anchored thread");
    let root = &threads[0].root.comment;
    assert!(
        matches!(root.anchor, Anchor::File),
        "round-tripped anchor must be Anchor::File, got {:?}",
        root.anchor
    );
    assert!(
        root.line.is_none(),
        "file-anchored comments must not carry a flat line value"
    );
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
    assert_eq!(
        loaded.comments[0].id, "y1",
        "YAML should be preferred over JSON"
    );
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
    std::fs::write(
        dir.path().join("readme.md.review.yaml"),
        "mrsf_version: '1.0'\ndocument: readme.md\ncomments: []\n",
    )
    .unwrap();
    std::fs::write(
        dir.path().join("main.rs.review.json"),
        r#"{"mrsf_version":"1.0","document":"main.rs","comments":[]}"#,
    )
    .unwrap();
    std::fs::write(dir.path().join("config.json"), "{}").unwrap();

    let entries = read_dir(dir.path().to_str().unwrap().to_string()).unwrap();
    let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();

    assert!(names.contains(&"readme.md"));
    assert!(names.contains(&"main.rs"));
    assert!(names.contains(&"config.json"));
    assert!(
        !names.contains(&"readme.md.review.yaml"),
        "YAML review sidecars should be hidden"
    );
    assert!(
        !names.contains(&"main.rs.review.json"),
        "JSON review sidecars should be hidden"
    );
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
    assert_eq!(
        obj.len(),
        2,
        "FileChangeEvent should have exactly 2 fields: path and kind"
    );
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
    let results = search_in_document(
        "日本語テスト hello 日本語テスト".to_string(),
        "hello".to_string(),
    );
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
    assert!(
        sidecar_path.exists(),
        "sidecar should be created on first comment"
    );
    let loaded = load_sidecar(&file_path).unwrap().unwrap();
    assert_eq!(loaded.comments.len(), 1);
    assert_eq!(loaded.comments[0].id, "first-comment");
    assert_eq!(loaded.document, "doc.md");
    // Pure-legacy comments ⇒ writer emits "1.0" (advisory #5: per-content selector).
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

    let result =
        mutate_sidecar_or_create(&file_path, None, |_sidecar| Err("simulated".to_string()));

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

//  stat_file

/// Helper: build a WatcherState that allowlists `dir`. Mirrors the pattern
/// from `commands/system.rs` tests.
fn watcher_state_allowing(dir: &std::path::Path) -> mdown_review_lib::watcher::WatcherState {
    let canonical = std::fs::canonicalize(dir).unwrap();
    let (tx, _rx) = std::sync::mpsc::sync_channel(1);
    let state = mdown_review_lib::watcher::WatcherState::new(tx);
    state
        .set_tree_watched_dirs(
            canonical.to_string_lossy().into_owned(),
            vec![canonical.to_string_lossy().into_owned()],
        )
        .unwrap();
    state
}

#[test]
fn stat_file_returns_size_in_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let canonical = std::fs::canonicalize(dir.path()).unwrap();
    let file = canonical.join("hello.bin");
    std::fs::write(&file, b"hello").unwrap();
    let state = watcher_state_allowing(dir.path());
    let result = stat_file_inner(file.to_str().unwrap(), &state).unwrap();
    assert_eq!(result.size_bytes, 5);
}

#[test]
fn stat_file_returns_err_for_missing_path() {
    let dir = tempfile::tempdir().unwrap();
    let canonical = std::fs::canonicalize(dir.path()).unwrap();
    let missing = canonical.join("nope.bin");
    let state = watcher_state_allowing(dir.path());
    let result = stat_file_inner(missing.to_str().unwrap(), &state);
    assert!(result.is_err());
}

#[test]
fn stat_file_rejects_path_outside_workspace() {
    // Workspace = dir A; stat'd file lives in dir B → must be rejected with
    // the canonical "path not in workspace" error.
    let workspace = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let outside_canonical = std::fs::canonicalize(outside.path()).unwrap();
    let outside_file = outside_canonical.join("secret.bin");
    std::fs::write(&outside_file, b"secret").unwrap();

    let state = watcher_state_allowing(workspace.path());
    let result = stat_file_inner(outside_file.to_str().unwrap(), &state);
    assert_eq!(result.unwrap_err(), "path not in workspace");
}

//
// Iter 1 / F0  new IPC surface (advisory #2/3/5)
//

mod f0_iter1 {
    use super::{make_mrsf_comment, watcher_state_allowing};
    use mdown_review_lib::commands::{
        check_workspace_for, export_review_summary_inner, get_file_badges_inner, set_author_at,
        update_comment_apply, validate_author, CommentPatch, ConfigError,
    };
    use mdown_review_lib::core::severity::Severity;
    use mdown_review_lib::core::sidecar::{load_sidecar, save_sidecar};
    use mdown_review_lib::core::types::Anchor;

    #[test]
    fn update_comment_add_reaction_appends_and_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let canonical = std::fs::canonicalize(dir.path()).unwrap();
        let file = canonical.join("doc.md");
        std::fs::write(&file, "hello\n").unwrap();
        let file_path = file.to_str().unwrap().to_string();
        save_sidecar(&file_path, "doc.md", &[make_mrsf_comment("c1")]).unwrap();

        update_comment_apply(
            &file_path,
            "c1",
            CommentPatch::AddReaction {
                user: "alice".into(),
                kind: "thumbs_up".into(),
                ts: "2025-01-01T00:00:00Z".into(),
            },
        )
        .unwrap();
        // Idempotent: same (user, kind) twice is a no-op.
        update_comment_apply(
            &file_path,
            "c1",
            CommentPatch::AddReaction {
                user: "alice".into(),
                kind: "thumbs_up".into(),
                ts: "2025-01-02T00:00:00Z".into(),
            },
        )
        .unwrap();

        let loaded = load_sidecar(&file_path).unwrap().unwrap();
        let reactions = loaded.comments[0].reactions.as_ref().unwrap();
        assert_eq!(reactions.len(), 1);
        assert_eq!(reactions[0].user, "alice");
        assert_eq!(reactions[0].kind, "thumbs_up");
        // Sidecar should have been promoted to v1.1 by the writer (advisory #5).
        assert_eq!(loaded.mrsf_version, "1.1");
    }

    #[test]
    fn update_comment_set_resolved_toggles_state() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("doc.md");
        std::fs::write(&file, "x\n").unwrap();
        let file_path = file.to_str().unwrap().to_string();
        save_sidecar(&file_path, "doc.md", &[make_mrsf_comment("c1")]).unwrap();

        update_comment_apply(
            &file_path,
            "c1",
            CommentPatch::SetResolved { resolved: true },
        )
        .unwrap();
        let loaded = load_sidecar(&file_path).unwrap().unwrap();
        assert!(loaded.comments[0].resolved);
    }

    #[test]
    fn update_comment_missing_comment_errors() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("doc.md");
        std::fs::write(&file, "x\n").unwrap();
        let file_path = file.to_str().unwrap().to_string();
        save_sidecar(&file_path, "doc.md", &[make_mrsf_comment("c1")]).unwrap();

        let err = update_comment_apply(
            &file_path,
            "nonexistent",
            CommentPatch::SetResolved { resolved: true },
        )
        .unwrap_err();
        assert!(err.contains("not found"), "got: {err}");
    }

    #[test]
    fn move_anchor_pushes_history_and_swaps() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("doc.md");
        std::fs::write(&file, "x\n").unwrap();
        let file_path = file.to_str().unwrap().to_string();
        save_sidecar(&file_path, "doc.md", &[make_mrsf_comment("c1")]).unwrap();

        // Capture the prior anchor (Line 10 from `make_mrsf_comment`) before
        // applying the patch so the history assertion has something concrete
        // to compare against.
        let before = load_sidecar(&file_path).unwrap().unwrap();
        let prev_anchor = before.comments[0].anchor.clone();
        assert!(matches!(prev_anchor, Anchor::Line { line: 10, .. }));

        let new_anchor = Anchor::File;
        let mutated = update_comment_apply(
            &file_path,
            "c1",
            CommentPatch::MoveAnchor {
                new_anchor: new_anchor.clone(),
            },
        )
        .unwrap();
        assert!(mutated, "MoveAnchor with a different anchor must mutate");

        let after = load_sidecar(&file_path).unwrap().unwrap();
        assert_eq!(after.comments[0].anchor, new_anchor);
        let history = after.comments[0]
            .anchor_history
            .as_ref()
            .expect("history populated");
        assert_eq!(history.last().cloned(), Some(prev_anchor));
    }

    #[test]
    fn move_anchor_no_op_when_equal_returns_false() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("doc.md");
        std::fs::write(&file, "x\n").unwrap();
        let file_path = file.to_str().unwrap().to_string();
        save_sidecar(&file_path, "doc.md", &[make_mrsf_comment("c1")]).unwrap();

        let same_anchor = load_sidecar(&file_path).unwrap().unwrap().comments[0]
            .anchor
            .clone();

        let mutated = update_comment_apply(
            &file_path,
            "c1",
            CommentPatch::MoveAnchor {
                new_anchor: same_anchor,
            },
        )
        .unwrap();
        assert!(!mutated, "MoveAnchor with equal anchor must be a no-op");

        // History must remain untouched (`None`) — the no-op path must not
        // pollute it.
        let after = load_sidecar(&file_path).unwrap().unwrap();
        assert!(after.comments[0].anchor_history.is_none());
    }

    #[test]
    fn move_anchor_patch_serde_round_trip_uses_tagged_anchor_repr() {
        // Wire shape contract: the new MoveAnchor IPC payload must serialise
        // as `{kind:"move_anchor",data:{new_anchor:{anchor_kind:"...",anchor_data:...}}}`
        // — i.e. reuse `AnchorRepr`'s tagged form rather than inventing a new
        // shape. Round-trips both Line and File to cover the unit-variant
        // and payload-variant arms of `AnchorRepr`.
        let line_patch = CommentPatch::MoveAnchor {
            new_anchor: Anchor::Line {
                line: 7,
                end_line: None,
                start_column: None,
                end_column: None,
                selected_text: None,
                selected_text_hash: None,
            },
        };
        let json = serde_json::to_string(&line_patch).unwrap();
        assert!(json.contains(r#""kind":"move_anchor""#), "got: {json}");
        assert!(json.contains(r#""anchor_kind":"line""#), "got: {json}");
        assert!(json.contains(r#""new_anchor""#), "got: {json}");
        let parsed: CommentPatch = serde_json::from_str(&json).unwrap();
        match parsed {
            CommentPatch::MoveAnchor {
                new_anchor: Anchor::Line { line: 7, .. },
            } => {}
            other => panic!("round-trip lost variant: {other:?}"),
        }

        let file_patch = CommentPatch::MoveAnchor {
            new_anchor: Anchor::File,
        };
        let json = serde_json::to_string(&file_patch).unwrap();
        assert!(json.contains(r#""anchor_kind":"file""#), "got: {json}");
        let parsed: CommentPatch = serde_json::from_str(&json).unwrap();
        assert!(matches!(
            parsed,
            CommentPatch::MoveAnchor {
                new_anchor: Anchor::File
            }
        ));
    }

    #[test]
    fn get_file_badges_returns_count_and_max_severity() {
        let dir = tempfile::tempdir().unwrap();
        let canonical = std::fs::canonicalize(dir.path()).unwrap();
        let file = canonical.join("doc.md");
        std::fs::write(&file, "alpha\nbeta\n").unwrap();
        let file_path = file.to_str().unwrap().to_string();

        // Two unresolved (severity high + low) + one resolved.
        let mut high = make_mrsf_comment("h");
        high.severity = Some("high".into());
        let mut low = make_mrsf_comment("l");
        low.severity = Some("low".into());
        let mut resolved = make_mrsf_comment("r");
        resolved.resolved = true;
        resolved.severity = Some("high".into());
        save_sidecar(&file_path, "doc.md", &[high, low, resolved]).unwrap();

        let state = watcher_state_allowing(&canonical);
        let badges = get_file_badges_inner(&state, std::slice::from_ref(&file_path));
        let badge = badges.get(&file_path).expect("badge for file");
        assert_eq!(badge.count, 2);
        assert_eq!(badge.max_severity, Severity::High);
    }

    #[test]
    fn get_file_badges_skips_paths_outside_workspace() {
        let workspace = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let outside_canonical = std::fs::canonicalize(outside.path()).unwrap();
        let outside_file = outside_canonical.join("doc.md");
        std::fs::write(&outside_file, "x\n").unwrap();
        save_sidecar(
            outside_file.to_str().unwrap(),
            "doc.md",
            &[make_mrsf_comment("c1")],
        )
        .unwrap();

        let state = watcher_state_allowing(workspace.path());
        let badges = get_file_badges_inner(&state, &[outside_file.to_str().unwrap().to_string()]);
        assert!(
            badges.is_empty(),
            "outside-workspace badges must be silently skipped: {:?}",
            badges
        );
    }

    #[test]
    fn export_review_summary_emits_thread_under_workspace() {
        let dir = tempfile::tempdir().unwrap();
        let canonical = std::fs::canonicalize(dir.path()).unwrap();
        let file = canonical.join("doc.md");
        std::fs::write(&file, "alpha\n").unwrap();
        save_sidecar(file.to_str().unwrap(), "doc.md", &[make_mrsf_comment("c1")]).unwrap();

        let out = export_review_summary_inner(canonical.to_str().unwrap());
        assert!(out.contains("# Review summary"));
        assert!(out.contains("c1"));
        assert!(out.contains("```mdr-thread-"));
    }

    #[test]
    fn set_author_validation_matrix() {
        // Happy path
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("onboarding.json");
        let stored = set_author_at(&path, "Alice").unwrap();
        assert_eq!(stored, "Alice");

        // >128 bytes
        let long = "a".repeat(129);
        match validate_author(&long).unwrap_err() {
            ConfigError::InvalidAuthor { reason } => assert_eq!(reason, "too_long"),
            _ => panic!("wrong variant"),
        }

        // newline
        match validate_author("a\nb").unwrap_err() {
            ConfigError::InvalidAuthor { reason } => assert_eq!(reason, "newline"),
            _ => panic!("wrong variant"),
        }

        // control char
        match validate_author("a\tb").unwrap_err() {
            ConfigError::InvalidAuthor { reason } => assert_eq!(reason, "control_char"),
            _ => panic!("wrong variant"),
        }

        // empty
        match validate_author("   ").unwrap_err() {
            ConfigError::InvalidAuthor { reason } => assert_eq!(reason, "empty"),
            _ => panic!("wrong variant"),
        }
    }

    // ── Workspace-path guard (bug-hunter HIGH #1+#2) ─────────────────────
    //
    // Every retrofitted comment-mutation command must reject paths whose
    // PARENT directory canonicalizes outside the workspace, but ALLOW
    // mutations against paths whose underlying file is just deleted /
    // renamed / swapped — those are routine for the orphan-comment and
    // DeletedFileViewer flows. The guard string is exact-matched so the
    // renderer can branch on it.

    fn outside_path() -> (tempfile::TempDir, std::path::PathBuf) {
        let outside = tempfile::tempdir().unwrap();
        let canonical = std::fs::canonicalize(outside.path()).unwrap();
        let path = canonical.join("doc.md");
        std::fs::write(&path, b"x\n").unwrap();
        (outside, path)
    }

    /// Parametrised: every retrofitted command name must surface the same
    /// "path not in workspace" error when handed a path whose parent
    /// canonicalizes outside the workspace.
    #[test]
    fn workspace_guard_rejects_outside_path_for_every_retrofitted_command() {
        let workspace = tempfile::tempdir().unwrap();
        let state = watcher_state_allowing(workspace.path());
        let (_keep, outside) = outside_path();
        let outside_str = outside.to_str().unwrap();
        for cmd in [
            "add_comment",
            "add_reply",
            "edit_comment",
            "delete_comment",
            "update_comment",
            "export_review_summary",
            "get_file_badges",
        ] {
            let err = check_workspace_for(cmd, &state, outside_str).unwrap_err();
            assert_eq!(
                err, "path not in workspace",
                "command `{cmd}` did not surface the canonical guard error",
            );
        }
    }

    /// Regression: the workspace guard MUST accept paths whose underlying
    /// file is missing as long as the parent dir lies under the workspace.
    /// Without this, `edit_comment` / `update_comment` against orphan or
    /// just-deleted files would silently fail with "path not in workspace"
    /// and break the DeletedFileViewer flow (bug-hunter HIGH #1).
    #[test]
    fn workspace_guard_accepts_deleted_file_inside_workspace() {
        let workspace = tempfile::tempdir().unwrap();
        let state = watcher_state_allowing(workspace.path());
        let canonical = std::fs::canonicalize(workspace.path()).unwrap();
        let ghost = canonical.join("just-deleted.md");
        // File never existed; parent dir IS in the workspace.
        check_workspace_for("edit_comment", &state, ghost.to_str().unwrap())
            .expect("ghost path inside workspace must be accepted");
    }

    /// `edit_comment` must succeed even when the underlying file was deleted
    /// between create and edit. Uses `update_comment_apply` because it's the
    /// pure helper version of the same path; the workspace guard for
    /// `edit_comment` itself is covered by the parametrised test above.
    #[test]
    fn update_comment_succeeds_on_deleted_underlying_file() {
        let workspace = tempfile::tempdir().unwrap();
        let canonical = std::fs::canonicalize(workspace.path()).unwrap();
        let file_path_buf = canonical.join("doc.md");
        let file_path = file_path_buf.to_str().unwrap().to_string();
        std::fs::write(&file_path_buf, "x\n").unwrap();
        save_sidecar(&file_path, "doc.md", &[make_mrsf_comment("c1")]).unwrap();
        // Simulate editor save / OneDrive swap: file is gone, sidecar remains.
        std::fs::remove_file(&file_path_buf).unwrap();

        let state = watcher_state_allowing(workspace.path());
        check_workspace_for("update_comment", &state, &file_path)
            .expect("orphan path must pass workspace guard");

        update_comment_apply(
            &file_path,
            "c1",
            CommentPatch::SetResolved { resolved: true },
        )
        .expect("update_comment must succeed against orphan path");

        let loaded = load_sidecar(&file_path).unwrap().unwrap();
        assert!(loaded.comments[0].resolved);
    }

    /// `get_file_badges` must surface badges for orphan-only paths (file
    /// deleted, sidecar still present) — otherwise unresolved comments on
    /// just-deleted files vanish from the tree pane (bug-hunter HIGH #2).
    #[test]
    fn get_file_badges_includes_orphan_only_paths() {
        let workspace = tempfile::tempdir().unwrap();
        let canonical = std::fs::canonicalize(workspace.path()).unwrap();
        let file = canonical.join("ghost.md");
        let file_path = file.to_str().unwrap().to_string();
        std::fs::write(&file, "alpha\n").unwrap();
        let mut high = make_mrsf_comment("h");
        high.severity = Some("high".into());
        save_sidecar(&file_path, "ghost.md", &[high]).unwrap();
        std::fs::remove_file(&file).unwrap(); // orphan now

        let state = watcher_state_allowing(workspace.path());
        let badges = get_file_badges_inner(&state, std::slice::from_ref(&file_path));
        let badge = badges
            .get(&file_path)
            .expect("orphan-only files must still produce a badge");
        assert_eq!(badge.count, 1);
        assert_eq!(badge.max_severity, Severity::High);
    }

    /// Cap: more than `MAX_BADGE_PATHS` paths must be rejected with
    /// "too many paths" (bug-hunter #11). Mirrors the watcher's
    /// `MAX_TREE_WATCHED_DIRS` posture.
    #[test]
    fn get_file_badges_rejects_oversized_input() {
        use mdown_review_lib::commands::comments::badges::{
            enforce_badge_input_cap, MAX_BADGE_PATHS,
        };
        assert!(enforce_badge_input_cap(&[]).is_ok());
        let small: Vec<String> = (0..MAX_BADGE_PATHS).map(|i| format!("/p/{i}")).collect();
        assert!(enforce_badge_input_cap(&small).is_ok());
        let too_many: Vec<String> = (0..(MAX_BADGE_PATHS + 1))
            .map(|i| format!("/p/{i}"))
            .collect();
        assert_eq!(
            enforce_badge_input_cap(&too_many).unwrap_err(),
            "too many paths"
        );
    }

    /// Compare-then-write: `SetResolved` applied with the comment's current
    /// state must NOT mutate the sidecar (and so will not emit
    /// `comments-changed`). Verified by the `update_comment_apply` return
    /// value: `Ok(false)` ⇒ no save, no emit (bug-hunter #9).
    #[test]
    fn set_resolved_no_op_skips_save_and_emit() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("doc.md");
        std::fs::write(&file, "x\n").unwrap();
        let file_path = file.to_str().unwrap().to_string();
        let mut c = make_mrsf_comment("c1");
        c.resolved = false;
        save_sidecar(&file_path, "doc.md", &[c]).unwrap();
        let sidecar_path = dir.path().join("doc.md.review.yaml");
        let mtime_before = std::fs::metadata(&sidecar_path)
            .unwrap()
            .modified()
            .unwrap();

        // Sleep briefly so any rewrite would visibly bump mtime.
        std::thread::sleep(std::time::Duration::from_millis(20));

        // SetResolved=false on an already-false comment ⇒ no-op.
        let mutated = update_comment_apply(
            &file_path,
            "c1",
            CommentPatch::SetResolved { resolved: false },
        )
        .unwrap();
        assert!(!mutated, "no-op SetResolved must report unchanged");
        let mtime_after = std::fs::metadata(&sidecar_path)
            .unwrap()
            .modified()
            .unwrap();
        assert_eq!(
            mtime_before, mtime_after,
            "no-op SetResolved must NOT rewrite the sidecar"
        );
    }

    /// v1.0 sidecar round-trip: load + save must preserve `mrsf_version: 1.0`
    /// and never leak v1.1 keys. Not byte-identical (the YAML serialiser
    /// normalises whitespace and quoting); the contract we lock in is "no
    /// downgrade or upgrade, no leaked fields".
    #[test]
    fn v1_0_fixture_round_trips_without_version_drift() {
        let fixture = include_str!("fixtures/mrsf/v1.0/basic.mrsf.md");
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("basic.md");
        std::fs::write(&file, "line1\nline2\n").unwrap();
        let yaml_path = dir.path().join("basic.md.review.yaml");
        std::fs::write(&yaml_path, fixture).unwrap();

        let file_path = file.to_str().unwrap().to_string();
        let loaded = load_sidecar(&file_path).unwrap().unwrap();
        assert_eq!(loaded.mrsf_version, "1.0");
        assert_eq!(loaded.comments.len(), 2);
        // Save round-trips through the writer's version selector.
        save_sidecar(&file_path, &loaded.document, &loaded.comments).unwrap();
        let reread = std::fs::read_to_string(&yaml_path).unwrap();
        assert!(
            reread.contains("mrsf_version: '1.0'")
                || reread.contains("mrsf_version: \"1.0\"")
                || reread.contains("mrsf_version: 1.0"),
            "v1.0 round-trip must preserve mrsf_version=1.0; got: {reread}"
        );
        for forbidden in [
            "anchor_kind",
            "image_rect",
            "csv_cell",
            "json_path",
            "html_range",
            "html_element",
            "reactions",
        ] {
            assert!(
                !reread.contains(forbidden),
                "v1.0 round-trip leaked v1.1 field `{forbidden}`: {reread}"
            );
        }
    }
}

//
// Iter 4 / Wave 1c  typed-anchor dispatch end-to-end through
// `get_file_comments`. Verifies the partition (Line/File via match_comments,
// typed via resolve_anchor) and that orphan classification flows out via
// the returned `CommentThread`'s `is_orphaned` flag.
// ─

mod wave1c_typed_dispatch {
    use mdown_review_lib::commands::comments::get_file_comments_inner as get_file_comments;
    use mdown_review_lib::core::sidecar::save_sidecar;
    use mdown_review_lib::core::types::{Anchor, CsvCellAnchor, MrsfComment};

    fn typed_comment(id: &str, anchor: Anchor) -> MrsfComment {
        MrsfComment {
            id: id.into(),
            author: "Test User (test)".into(),
            timestamp: "2026-04-20T12:00:00-07:00".into(),
            text: "typed".into(),
            resolved: false,
            anchor,
            ..Default::default()
        }
    }

    #[test]
    fn get_file_comments_resolves_typed_anchor() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("data.csv");
        std::fs::write(&file, "id,name\n1,Alice\n2,Bob\n").unwrap();
        let file_path = file.to_str().unwrap().to_string();

        let comment = typed_comment(
            "c-csv",
            Anchor::CsvCell(CsvCellAnchor {
                row_idx: 1,
                col_idx: 1,
                col_header: "name".into(),
                primary_key_col: None,
                primary_key_value: None,
            }),
        );
        save_sidecar(&file_path, "data.csv", &[comment]).unwrap();

        let threads = get_file_comments(&file_path).expect("get_file_comments ok");
        assert_eq!(threads.len(), 1, "exactly one root thread");
        let root = &threads[0].root;
        assert!(
            !root.is_orphaned,
            "valid CsvCell on real CSV must resolve, not orphan"
        );
        assert!(
            matches!(root.comment.anchor, Anchor::CsvCell(_)),
            "anchor variant preserved through dispatch, got {:?}",
            root.comment.anchor
        );
    }

    #[test]
    fn get_file_comments_orphans_typed_anchor_on_missing_target() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("data.csv");
        std::fs::write(&file, "id,name\n1,Alice\n").unwrap();
        let file_path = file.to_str().unwrap().to_string();

        let comment = typed_comment(
            "c-orphan",
            Anchor::CsvCell(CsvCellAnchor {
                row_idx: 99,
                col_idx: 99,
                col_header: "name".into(),
                primary_key_col: None,
                primary_key_value: None,
            }),
        );
        save_sidecar(&file_path, "data.csv", &[comment]).unwrap();

        let threads = get_file_comments(&file_path).expect("get_file_comments ok");
        assert_eq!(threads.len(), 1);
        assert!(
            threads[0].root.is_orphaned,
            "out-of-bounds CsvCell must orphan"
        );
    }
}
