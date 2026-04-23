use std::path::PathBuf;
use std::process::Command;

fn cli_binary() -> PathBuf {
    // Build the CLI binary path based on the target directory
    let mut path = PathBuf::from(env!("CARGO_TARGET_TMPDIR"));
    // CARGO_TARGET_TMPDIR points to target/tmp, go up to target/
    path.pop();
    path.push("debug");
    path.push(if cfg!(windows) {
        "mdownreview-cli.exe"
    } else {
        "mdownreview-cli"
    });
    path
}

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("cli")
}

/// Helper: run CLI with args and return (stdout, stderr, exit_code)
fn run_cli(args: &[&str]) -> (String, String, i32) {
    let output = Command::new(cli_binary())
        .args(args)
        .output()
        .expect("failed to execute CLI binary");
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let code = output.status.code().unwrap_or(-1);
    (stdout, stderr, code)
}

// ── read subcommand ────────────────────────────────────────────────────────

#[test]
fn read_text_format_shows_unresolved_only() {
    let dir = fixtures_dir();
    let (stdout, _stderr, code) = run_cli(&["read", "--folder", dir.to_str().unwrap()]);
    assert_eq!(code, 0);
    // mixed.md has 2 unresolved comments
    assert!(stdout.contains("mixed.md"));
    assert!(stdout.contains("m1"));
    assert!(stdout.contains("m3"));
    // m2 is resolved, should not appear
    assert!(!stdout.contains("m2"));
    // resolved.md should not appear (all resolved)
    assert!(!stdout.contains("resolved.md"));
}

#[test]
fn read_text_format_shows_all_with_flag() {
    let dir = fixtures_dir();
    let (stdout, _stderr, code) = run_cli(&["read", "--folder", dir.to_str().unwrap(), "--all"]);
    assert_eq!(code, 0);
    // Should show all comments including resolved
    assert!(stdout.contains("m1"));
    assert!(stdout.contains("m2"));
    assert!(stdout.contains("m3"));
    // resolved.md should appear when --all
    assert!(stdout.contains("resolved.md"));
}

#[test]
fn read_text_format_displays_type_and_severity() {
    let dir = fixtures_dir();
    let (stdout, _stderr, code) = run_cli(&["read", "--folder", dir.to_str().unwrap()]);
    assert_eq!(code, 0);
    assert!(stdout.contains("[issue]"));
    assert!(stdout.contains("(high)"));
    assert!(stdout.contains("[suggestion]"));
    assert!(stdout.contains("(low)"));
}

#[test]
fn read_json_format() {
    let dir = fixtures_dir();
    let (stdout, _stderr, code) = run_cli(&[
        "read",
        "--folder",
        dir.to_str().unwrap(),
        "--format",
        "json",
    ]);
    assert_eq!(code, 0);
    let parsed: serde_json::Value = serde_json::from_str(&stdout)
        .expect("JSON output should be valid");
    assert!(parsed.is_array());
    // Should have at least 1 entry (mixed.md with unresolved comments)
    let arr = parsed.as_array().unwrap();
    assert!(!arr.is_empty());
    // Each entry should have reviewFile, sourceFile, comments
    let entry = &arr[0];
    assert!(entry.get("reviewFile").is_some());
    assert!(entry.get("sourceFile").is_some());
    assert!(entry.get("comments").is_some());
}

#[test]
fn read_empty_directory() {
    let tmp = tempfile::TempDir::new().unwrap();
    let (stdout, _stderr, code) = run_cli(&["read", "--folder", tmp.path().to_str().unwrap()]);
    assert_eq!(code, 0);
    // No output for empty directory
    assert!(stdout.trim().is_empty() || stdout.contains("[]"));
}

// ── cleanup subcommand ─────────────────────────────────────────────────────

#[test]
fn cleanup_dry_run_does_not_delete() {
    let tmp = tempfile::TempDir::new().unwrap();
    // Copy resolved sidecar to temp dir
    let source = fixtures_dir().join("resolved.md.review.yaml");
    let dest = tmp.path().join("resolved.md.review.yaml");
    std::fs::copy(&source, &dest).unwrap();
    std::fs::write(tmp.path().join("resolved.md"), "# Test").unwrap();

    let (stdout, _stderr, code) = run_cli(&[
        "cleanup",
        "--folder",
        tmp.path().to_str().unwrap(),
        "--dry-run",
    ]);
    assert_eq!(code, 0);
    assert!(stdout.contains("would delete"));
    assert!(stdout.contains("1 file(s) would delete"));
    // File should still exist
    assert!(dest.exists());
}

#[test]
fn cleanup_deletes_resolved_files() {
    let tmp = tempfile::TempDir::new().unwrap();
    let source = fixtures_dir().join("resolved.md.review.yaml");
    let dest = tmp.path().join("resolved.md.review.yaml");
    std::fs::copy(&source, &dest).unwrap();
    std::fs::write(tmp.path().join("resolved.md"), "# Test").unwrap();

    let (stdout, _stderr, code) = run_cli(&["cleanup", "--folder", tmp.path().to_str().unwrap()]);
    assert_eq!(code, 0);
    assert!(stdout.contains("deleted"));
    assert!(stdout.contains("1 file(s) deleted"));
    // File should be gone
    assert!(!dest.exists());
}

#[test]
fn cleanup_skips_unresolved_files() {
    let tmp = tempfile::TempDir::new().unwrap();
    let source = fixtures_dir().join("mixed.md.review.yaml");
    let dest = tmp.path().join("mixed.md.review.yaml");
    std::fs::copy(&source, &dest).unwrap();
    std::fs::write(tmp.path().join("mixed.md"), "# Test").unwrap();

    let (stdout, _stderr, code) = run_cli(&["cleanup", "--folder", tmp.path().to_str().unwrap()]);
    assert_eq!(code, 0);
    assert!(stdout.contains("0 file(s) deleted"));
    // File should still exist
    assert!(dest.exists());
}

// ── resolve subcommand ─────────────────────────────────────────────────────

#[test]
fn resolve_marks_comment_resolved() {
    let tmp = tempfile::TempDir::new().unwrap();
    // Copy mixed sidecar
    let source = fixtures_dir().join("mixed.md.review.yaml");
    let sidecar = tmp.path().join("mixed.md.review.yaml");
    std::fs::copy(&source, &sidecar).unwrap();
    std::fs::write(tmp.path().join("mixed.md"), "# Test").unwrap();

    let (stdout, _stderr, code) = run_cli(&["resolve", sidecar.to_str().unwrap(), "m1"]);
    assert_eq!(code, 0);
    assert!(stdout.contains("Resolved comment m1"));

    // Verify the comment is now resolved
    let content = std::fs::read_to_string(&sidecar).unwrap();
    // Parse and check
    let sidecar_data: serde_yaml::Value = serde_yaml::from_str(&content).unwrap();
    let comments = sidecar_data["comments"].as_sequence().unwrap();
    let m1 = comments.iter().find(|c| c["id"].as_str() == Some("m1")).unwrap();
    assert_eq!(m1["resolved"].as_bool(), Some(true));
    // m3 should still be unresolved
    let m3 = comments.iter().find(|c| c["id"].as_str() == Some("m3")).unwrap();
    assert_eq!(m3["resolved"].as_bool(), Some(false));
}

#[test]
fn resolve_with_response() {
    let tmp = tempfile::TempDir::new().unwrap();
    let source = fixtures_dir().join("mixed.md.review.yaml");
    let sidecar = tmp.path().join("mixed.md.review.yaml");
    std::fs::copy(&source, &sidecar).unwrap();
    std::fs::write(tmp.path().join("mixed.md"), "# Test").unwrap();

    let (_stdout, _stderr, code) = run_cli(&[
        "resolve",
        sidecar.to_str().unwrap(),
        "m1",
        "--response",
        "Fixed the bug",
    ]);
    assert_eq!(code, 0);

    let content = std::fs::read_to_string(&sidecar).unwrap();
    assert!(content.contains("Fixed the bug"));
    assert!(content.contains("responses"));
}

#[test]
fn resolve_nonexistent_comment_fails() {
    let tmp = tempfile::TempDir::new().unwrap();
    let source = fixtures_dir().join("mixed.md.review.yaml");
    let sidecar = tmp.path().join("mixed.md.review.yaml");
    std::fs::copy(&source, &sidecar).unwrap();
    std::fs::write(tmp.path().join("mixed.md"), "# Test").unwrap();

    let (_stdout, stderr, code) = run_cli(&["resolve", sidecar.to_str().unwrap(), "nonexistent"]);
    assert_eq!(code, 1);
    assert!(stderr.contains("error:"));
}

// ── respond subcommand ─────────────────────────────────────────────────────

#[test]
fn respond_adds_response_without_resolving() {
    let tmp = tempfile::TempDir::new().unwrap();
    let source = fixtures_dir().join("mixed.md.review.yaml");
    let sidecar = tmp.path().join("mixed.md.review.yaml");
    std::fs::copy(&source, &sidecar).unwrap();
    std::fs::write(tmp.path().join("mixed.md"), "# Test").unwrap();

    let (stdout, _stderr, code) = run_cli(&[
        "respond",
        sidecar.to_str().unwrap(),
        "m1",
        "--response",
        "Working on it",
    ]);
    assert_eq!(code, 0);
    assert!(stdout.contains("Added response to comment m1"));

    // Verify response added but NOT resolved
    let content = std::fs::read_to_string(&sidecar).unwrap();
    assert!(content.contains("Working on it"));
    let sidecar_data: serde_yaml::Value = serde_yaml::from_str(&content).unwrap();
    let comments = sidecar_data["comments"].as_sequence().unwrap();
    let m1 = comments.iter().find(|c| c["id"].as_str() == Some("m1")).unwrap();
    assert_eq!(m1["resolved"].as_bool(), Some(false));
}

#[test]
fn respond_nonexistent_comment_fails() {
    let tmp = tempfile::TempDir::new().unwrap();
    let source = fixtures_dir().join("mixed.md.review.yaml");
    let sidecar = tmp.path().join("mixed.md.review.yaml");
    std::fs::copy(&source, &sidecar).unwrap();
    std::fs::write(tmp.path().join("mixed.md"), "# Test").unwrap();

    let (_stdout, stderr, code) = run_cli(&[
        "respond",
        sidecar.to_str().unwrap(),
        "nonexistent",
        "--response",
        "test",
    ]);
    assert_eq!(code, 1);
    assert!(stderr.contains("error:"));
}
