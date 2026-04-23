use mdown_review_lib::commands::{
    compute_document_path, get_git_head, load_review_comments, read_binary_file, read_dir,
    read_text_file, save_review_comments, LaunchArgs, LaunchArgsState, MrsfComment, MrsfSidecar,
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
    let yaml = serde_yaml::to_string(&sidecar).unwrap();
    let parsed: MrsfSidecar = serde_yaml::from_str(&yaml).unwrap();
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
    let yaml = serde_yaml::to_string(&comment).unwrap();
    assert!(yaml.contains("type: suggestion"), "should serialize as 'type' not 'comment_type'");
}

#[test]
fn mrsf_optional_fields_omitted_when_none() {
    let mut comment = make_mrsf_comment("c1");
    comment.line = None;
    comment.selected_text = None;
    comment.comment_type = None;
    comment.severity = None;
    let yaml = serde_yaml::to_string(&comment).unwrap();
    assert!(!yaml.contains("line:"), "None fields should be omitted");
    assert!(!yaml.contains("selected_text:"), "None fields should be omitted");
}

#[test]
fn save_and_load_mrsf_yaml() {
    let tmp = tempfile::NamedTempFile::new().unwrap();
    let file_path = tmp.path().to_str().unwrap().to_string();

    let comments = vec![make_mrsf_comment("c1"), make_mrsf_comment("c2")];
    save_review_comments(file_path.clone(), "test.md".to_string(), comments.clone()).unwrap();

    // Check YAML file was created
    let sidecar_path = format!("{}.review.yaml", file_path);
    let content = std::fs::read_to_string(&sidecar_path).unwrap();
    assert!(content.contains("mrsf_version:"));
    assert!(content.contains("document: test.md"));

    // Round-trip via load
    let loaded = load_review_comments(file_path).unwrap().unwrap();
    assert_eq!(loaded.mrsf_version, "1.0");
    assert_eq!(loaded.document, "test.md");
    assert_eq!(loaded.comments.len(), 2);
    assert_eq!(loaded.comments[0].id, "c1");
}

#[test]
fn load_review_comments_returns_none_when_missing() {
    let result = load_review_comments("/nonexistent/path/to/file.md".to_string()).unwrap();
    assert!(result.is_none());
}

#[test]
fn save_review_comments_deletes_sidecar_when_empty() {
    let tmp = tempfile::NamedTempFile::new().unwrap();
    let file_path = tmp.path().to_str().unwrap().to_string();
    let sidecar_path = format!("{}.review.yaml", file_path);

    // Write a sidecar with one comment, then save empty to clear it.
    save_review_comments(file_path.clone(), "test.md".to_string(), vec![make_mrsf_comment("c1")]).unwrap();
    assert!(std::path::Path::new(&sidecar_path).exists());

    save_review_comments(file_path.clone(), "test.md".to_string(), vec![]).unwrap();
    assert!(!std::path::Path::new(&sidecar_path).exists(), "empty save should delete the sidecar");

    // Subsequent load should return None (no sidecar).
    let result = load_review_comments(file_path).unwrap();
    assert!(result.is_none());
}

#[test]
fn save_review_comments_empty_is_noop_when_no_sidecar() {
    let tmp = tempfile::NamedTempFile::new().unwrap();
    let file_path = tmp.path().to_str().unwrap().to_string();
    let sidecar_path = format!("{}.review.yaml", file_path);

    // Saving empty with no pre-existing sidecar must not create one.
    save_review_comments(file_path, "test.md".to_string(), vec![]).unwrap();
    assert!(!std::path::Path::new(&sidecar_path).exists(), "empty save must not create a sidecar");
}

#[test]
fn load_mrsf_json_fallback() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("test.md");
    std::fs::write(&file, "test content").unwrap();
    let sidecar = dir.path().join("test.md.review.json");
    std::fs::write(&sidecar, r#"{"mrsf_version":"1.0","document":"test.md","comments":[{"id":"j1","author":"A","timestamp":"2026-01-01T00:00:00Z","text":"json comment","resolved":false}]}"#).unwrap();

    let loaded = load_review_comments(file.to_str().unwrap().to_string()).unwrap().unwrap();
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

    let loaded = load_review_comments(file.to_str().unwrap().to_string()).unwrap().unwrap();
    assert_eq!(loaded.comments[0].id, "y1", "YAML should be preferred over JSON");
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

// ── get_git_head ──────────────────────────────────────────────────────────

#[test]
fn get_git_head_returns_sha_in_git_repo() {
    // The mdownreview repo itself is a git repo — use its root.
    let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    let result = get_git_head(repo_root);
    assert!(result.is_ok());
    let sha = result.unwrap();
    assert!(sha.is_some(), "should return a SHA in a git repo");
    assert!(sha.unwrap().len() >= 40, "SHA should be at least 40 hex chars");
}

#[test]
fn get_git_head_returns_none_for_non_repo() {
    let dir = tempfile::tempdir().unwrap();
    let result = get_git_head(dir.path().to_str().unwrap().to_string());
    assert!(result.is_ok());
    assert!(result.unwrap().is_none(), "non-repo directory should return Ok(None)");
}

#[test]
fn get_git_head_returns_error_on_command_failure() {
    // Use a non-existent directory as cwd — Command::output() will fail
    // because the working directory doesn't exist. This simulates a
    // command execution failure distinct from "not a git repo".
    let bad_path = if cfg!(windows) {
        "Z:\\nonexistent_dir_that_surely_does_not_exist_12345".to_string()
    } else {
        "/nonexistent_dir_that_surely_does_not_exist_12345".to_string()
    };
    let result = get_git_head(bad_path);
    assert!(result.is_err(), "command execution failure should return Err, not Ok(None)");
}

// ── compute_document_path ─────────────────────────────────────────────────

#[test]
fn compute_document_path_returns_relative_with_root() {
    let result = compute_document_path("/workspace/project/src/file.md".into(), Some("/workspace/project".into()));
    assert_eq!(result, "src/file.md");
}

#[test]
fn compute_document_path_returns_filename_without_root() {
    let result = compute_document_path("/some/path/file.md".into(), None);
    assert_eq!(result, "file.md");
}

#[test]
fn compute_document_path_returns_filename_when_not_under_root() {
    let result = compute_document_path("/other/path/file.md".into(), Some("/workspace/project".into()));
    assert_eq!(result, "file.md");
}

#[test]
fn compute_document_path_handles_nested_deeply() {
    let result = compute_document_path("/root/a/b/c/d/file.md".into(), Some("/root".into()));
    assert_eq!(result, "a/b/c/d/file.md");
}

#[test]
fn compute_document_path_returns_filename_when_root_equals_file() {
    // When file_path == root, strip_prefix yields empty string; fallback to filename
    let result = compute_document_path("/workspace/project".into(), Some("/workspace/project".into()));
    assert_eq!(result, "project");
}

#[test]
#[cfg(windows)]
fn compute_document_path_uses_forward_slashes() {
    let result = compute_document_path(r"C:\Users\dev\project\src\file.md".into(), Some(r"C:\Users\dev\project".into()));
    assert_eq!(result, "src/file.md");
}

#[test]
fn compute_document_path_root_with_trailing_separator() {
    // Root with trailing slash should still work
    let result = compute_document_path("/workspace/project/file.md".into(), Some("/workspace/project/".into()));
    assert_eq!(result, "file.md");
}

#[test]
fn compute_document_path_returns_filename_with_empty_root() {
    // Empty root string should fallback to filename, not return absolute path
    let result = compute_document_path("/workspace/project/file.md".into(), Some("".into()));
    assert_eq!(result, "file.md");
}
