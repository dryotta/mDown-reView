use std::path::PathBuf;
use std::process::Command;

fn cli_binary() -> PathBuf {
    // CARGO_TARGET_TMPDIR points to target/tmp; the binary lives in target/debug.
    let mut path = PathBuf::from(env!("CARGO_TARGET_TMPDIR"));
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

fn run_cli(args: &[&str]) -> (String, String, i32) {
    let output = Command::new(cli_binary())
        .args(args)
        .output()
        .expect("failed to execute CLI binary");
    (
        String::from_utf8_lossy(&output.stdout).to_string(),
        String::from_utf8_lossy(&output.stderr).to_string(),
        output.status.code().unwrap_or(-1),
    )
}

fn run_cli_bytes(args: &[&str]) -> (Vec<u8>, Vec<u8>, i32) {
    let output = Command::new(cli_binary())
        .args(args)
        .output()
        .expect("failed to execute CLI binary");
    (
        output.stdout,
        output.stderr,
        output.status.code().unwrap_or(-1),
    )
}

/// Copy the canonical mixed.md fixture pair into a fresh temp dir and return
/// the directory plus the sidecar path inside it.
fn stage_mixed() -> (tempfile::TempDir, PathBuf) {
    let tmp = tempfile::TempDir::new().unwrap();
    let src = fixtures_dir().join("mixed.md.review.yaml");
    let sidecar = tmp.path().join("mixed.md.review.yaml");
    std::fs::copy(&src, &sidecar).unwrap();
    std::fs::write(tmp.path().join("mixed.md"), "# Test").unwrap();
    (tmp, sidecar)
}

fn stage_resolved() -> (tempfile::TempDir, PathBuf) {
    let tmp = tempfile::TempDir::new().unwrap();
    let src = fixtures_dir().join("resolved.md.review.yaml");
    let sidecar = tmp.path().join("resolved.md.review.yaml");
    std::fs::copy(&src, &sidecar).unwrap();
    std::fs::write(tmp.path().join("resolved.md"), "# Test").unwrap();
    (tmp, sidecar)
}

fn stage_threaded() -> (tempfile::TempDir, PathBuf) {
    let tmp = tempfile::TempDir::new().unwrap();
    let src = fixtures_dir()
        .join("with-responses")
        .join("threaded.md.review.yaml");
    let sidecar = tmp.path().join("threaded.md.review.yaml");
    std::fs::copy(&src, &sidecar).unwrap();
    std::fs::write(
        tmp.path().join("threaded.md"),
        std::fs::read(fixtures_dir().join("with-responses").join("threaded.md")).unwrap(),
    )
    .unwrap();
    (tmp, sidecar)
}

// ── --help aggregation ─────────────────────────────────────────────────────

#[test]
fn top_level_help_lists_every_subcommand_and_its_flags() {
    let (stdout, _stderr, code) = run_cli(&["--help"]);
    assert_eq!(code, 0, "expected exit 0; got {} stdout=\n{}", code, stdout);
    for sub in &["read", "respond", "cleanup"] {
        assert!(stdout.contains(sub), "help missing subcommand {}", sub);
    }
    for flag in &[
        "--include-resolved",
        "--include-unresolved",
        "--resolve",
        "--file",
        "--folder",
        "--json",
    ] {
        assert!(stdout.contains(flag), "help missing flag {}", flag);
    }
}

// ── read subcommand ────────────────────────────────────────────────────────

#[test]
fn read_text_format_shows_unresolved_only() {
    let dir = fixtures_dir();
    let (stdout, _stderr, code) = run_cli(&["read", "--folder", dir.to_str().unwrap()]);
    assert_eq!(code, 0);
    assert!(stdout.contains("mixed.md"));
    assert!(stdout.contains("m1"));
    assert!(stdout.contains("m3"));
    // m2 is resolved, should not appear
    assert!(!stdout.contains("m2"));
    // resolved.md sidecar is fully resolved → omitted entirely
    assert!(!stdout.contains("resolved.md"));
}

#[test]
fn read_text_format_shows_all_with_include_resolved() {
    let dir = fixtures_dir();
    let (stdout, _stderr, code) = run_cli(&[
        "read",
        "--folder",
        dir.to_str().unwrap(),
        "--include-resolved",
    ]);
    assert_eq!(code, 0);
    assert!(stdout.contains("m1"));
    assert!(stdout.contains("m2"));
    assert!(stdout.contains("m3"));
    assert!(stdout.contains("resolved.md"));
    assert!(stdout.contains("[RESOLVED] [m2]"));
}

#[test]
fn read_text_format_displays_type_severity_author_timestamp() {
    let dir = fixtures_dir();
    let (stdout, _stderr, code) = run_cli(&["read", "--folder", dir.to_str().unwrap()]);
    assert_eq!(code, 0);
    assert!(stdout.contains("[issue]"));
    assert!(stdout.contains("(high)"));
    assert!(stdout.contains("[suggestion]"));
    assert!(stdout.contains("(low)"));
    assert!(stdout.contains("reviewer"));
    assert!(stdout.contains("2025-01-01"));
}

#[test]
fn read_old_all_flag_is_rejected() {
    let dir = fixtures_dir();
    let (_stdout, stderr, code) = run_cli(&["read", "--folder", dir.to_str().unwrap(), "--all"]);
    assert_ne!(code, 0);
    assert!(
        stderr.contains("unexpected")
            || stderr.contains("unrecognized")
            || stderr.contains("--all"),
        "stderr was: {}",
        stderr
    );
}

#[test]
fn read_json_envelope_has_review_and_source_files() {
    let dir = fixtures_dir();
    let (stdout, _stderr, code) = run_cli(&[
        "read",
        "--folder",
        dir.to_str().unwrap(),
        "--format",
        "json",
    ]);
    assert_eq!(code, 0);
    let parsed: serde_json::Value = serde_json::from_str(&stdout).expect("valid JSON");
    let arr = parsed.as_array().expect("scan output is an array");
    assert!(!arr.is_empty());
    let entry = &arr[0];
    let rf = entry.get("reviewFile").expect("reviewFile present");
    assert!(rf.get("relative").is_some(), "reviewFile.relative missing");
    assert!(rf.get("absolute").is_some(), "reviewFile.absolute missing");
    let sf = entry.get("sourceFile").expect("sourceFile present");
    assert!(sf.get("relative").is_some());
    assert!(sf.get("absolute").is_some());
    assert!(entry.get("comments").and_then(|c| c.as_array()).is_some());
}

#[test]
fn read_json_flag_equals_format_json() {
    let dir = fixtures_dir();
    let (out_a, _, code_a) = run_cli_bytes(&["read", "--folder", dir.to_str().unwrap(), "--json"]);
    let (out_b, _, code_b) = run_cli_bytes(&[
        "read",
        "--folder",
        dir.to_str().unwrap(),
        "--format",
        "json",
    ]);
    assert_eq!(code_a, 0);
    assert_eq!(code_b, 0);
    assert_eq!(
        out_a, out_b,
        "--json and --format json must be byte-identical"
    );
}

#[test]
fn read_single_file_resolves_under_folder() {
    let (tmp, _sidecar) = stage_mixed();
    let (stdout, stderr, code) = run_cli(&[
        "read",
        "--folder",
        tmp.path().to_str().unwrap(),
        "--file",
        "mixed.md",
        "--json",
    ]);
    assert_eq!(code, 0, "stderr={}", stderr);
    let parsed: serde_json::Value = serde_json::from_str(&stdout).expect("valid JSON");
    // Single-file mode: top-level is an object envelope, not an array.
    assert!(parsed.is_object());
    let rel = parsed["reviewFile"]["relative"].as_str().unwrap();
    assert!(
        rel.ends_with("mixed.md.review.yaml"),
        "unexpected relative path: {}",
        rel
    );
}

#[test]
fn read_missing_absolute_file_errors() {
    let missing = if cfg!(windows) {
        "C:\\definitely\\nope\\xyz_missing.md"
    } else {
        "/definitely/nope/xyz_missing.md"
    };
    let (_stdout, stderr, code) = run_cli(&["read", "--file", missing]);
    assert_ne!(code, 0);
    assert!(stderr.to_lowercase().contains("not found") || stderr.contains("error:"));
}

#[test]
fn read_text_includes_quoted_and_response_thread() {
    let (tmp, _sidecar) = stage_threaded();
    let (stdout, _stderr, code) = run_cli(&["read", "--folder", tmp.path().to_str().unwrap()]);
    assert_eq!(code, 0);
    assert!(stdout.contains("alice"));
    assert!(stdout.contains("2025-02-01"));
    assert!(stdout.contains("quoted: \"Line 4 has a known concern\""));
    assert!(stdout.contains("    bob (2025-02-01T01:00:00Z): Looking now"));
    assert!(stdout.contains("    bob (2025-02-01T02:00:00Z): Fixed in patch"));
}

// ── respond subcommand ─────────────────────────────────────────────────────

#[test]
fn respond_resolve_only_marks_comment_resolved() {
    let (tmp, sidecar) = stage_mixed();
    let (stdout, stderr, code) = run_cli(&[
        "respond",
        "--folder",
        tmp.path().to_str().unwrap(),
        "mixed.md",
        "m1",
        "--resolve",
    ]);
    assert_eq!(code, 0, "stderr={}", stderr);
    assert!(stdout.contains("resolved m1"));

    let content = std::fs::read_to_string(&sidecar).unwrap();
    let data: serde_yaml_ng::Value = serde_yaml_ng::from_str(&content).unwrap();
    let comments = data["comments"].as_sequence().unwrap();
    let m1 = comments
        .iter()
        .find(|c| c["id"].as_str() == Some("m1"))
        .unwrap();
    assert_eq!(m1["resolved"].as_bool(), Some(true));
}

#[test]
fn respond_response_only_adds_response() {
    let (tmp, sidecar) = stage_mixed();
    let (stdout, stderr, code) = run_cli(&[
        "respond",
        "--folder",
        tmp.path().to_str().unwrap(),
        "mixed.md",
        "m1",
        "--response",
        "Working on it",
    ]);
    assert_eq!(code, 0, "stderr={}", stderr);
    assert!(stdout.contains("responded to m1"));
    let content = std::fs::read_to_string(&sidecar).unwrap();
    assert!(content.contains("Working on it"));
    assert!(content.contains("responses"));
    let data: serde_yaml_ng::Value = serde_yaml_ng::from_str(&content).unwrap();
    let m1 = data["comments"]
        .as_sequence()
        .unwrap()
        .iter()
        .find(|c| c["id"].as_str() == Some("m1"))
        .unwrap();
    assert_eq!(m1["resolved"].as_bool(), Some(false));
}

#[test]
fn respond_combined_response_and_resolve() {
    let (tmp, sidecar) = stage_mixed();
    let (stdout, _stderr, code) = run_cli(&[
        "respond",
        "--folder",
        tmp.path().to_str().unwrap(),
        "mixed.md",
        "m1",
        "--response",
        "Fixed",
        "--resolve",
    ]);
    assert_eq!(code, 0);
    assert!(stdout.contains("responded and resolved m1"));
    let content = std::fs::read_to_string(&sidecar).unwrap();
    assert!(content.contains("Fixed"));
}

#[test]
fn respond_without_response_or_resolve_exits_2() {
    let (tmp, _sidecar) = stage_mixed();
    let (_stdout, stderr, code) = run_cli(&[
        "respond",
        "--folder",
        tmp.path().to_str().unwrap(),
        "mixed.md",
        "m1",
    ]);
    assert_eq!(
        code, 2,
        "expected exit code 2; got {}; stderr={}",
        code, stderr
    );
    assert!(
        stderr.contains("must provide"),
        "stderr should mention requirement; got: {}",
        stderr
    );
}

#[test]
fn respond_auto_detects_sidecar_from_source_path() {
    // Pass mixed.md (not the .review.yaml). resolve_sidecar should auto-find.
    let (tmp, sidecar) = stage_mixed();
    let (_stdout, stderr, code) = run_cli(&[
        "respond",
        "--folder",
        tmp.path().to_str().unwrap(),
        "mixed.md",
        "m1",
        "--response",
        "auto",
    ]);
    assert_eq!(code, 0, "stderr={}", stderr);
    let content = std::fs::read_to_string(&sidecar).unwrap();
    assert!(content.contains("auto"));
}

#[test]
fn respond_works_when_passing_sidecar_path_directly() {
    let (tmp, sidecar) = stage_mixed();
    let (_stdout, stderr, code) = run_cli(&[
        "respond",
        "--folder",
        tmp.path().to_str().unwrap(),
        "mixed.md.review.yaml",
        "m1",
        "--response",
        "direct",
    ]);
    assert_eq!(code, 0, "stderr={}", stderr);
    let content = std::fs::read_to_string(&sidecar).unwrap();
    assert!(content.contains("direct"));
}

#[test]
fn respond_no_sidecar_errors() {
    let tmp = tempfile::TempDir::new().unwrap();
    std::fs::write(tmp.path().join("orphan.md"), "# nope").unwrap();
    let (_stdout, stderr, code) = run_cli(&[
        "respond",
        "--folder",
        tmp.path().to_str().unwrap(),
        "orphan.md",
        "x1",
        "--response",
        "x",
    ]);
    assert_ne!(code, 0);
    assert!(
        stderr.contains("not found") || stderr.contains("error:"),
        "stderr: {}",
        stderr
    );
}

#[test]
fn respond_nonexistent_comment_fails() {
    let (tmp, _sidecar) = stage_mixed();
    let (_stdout, stderr, code) = run_cli(&[
        "respond",
        "--folder",
        tmp.path().to_str().unwrap(),
        "mixed.md",
        "nope",
        "--response",
        "x",
    ]);
    assert_eq!(code, 1);
    assert!(stderr.contains("error:"));
}

// ── resolve subcommand removed ─────────────────────────────────────────────

#[test]
fn old_resolve_subcommand_is_gone() {
    let (tmp, sidecar) = stage_mixed();
    let _ = sidecar; // silence unused
    let (_stdout, stderr, code) = run_cli(&[
        "resolve",
        tmp.path().join("mixed.md.review.yaml").to_str().unwrap(),
        "m1",
    ]);
    assert_ne!(code, 0);
    assert!(
        stderr.contains("unrecognized subcommand")
            || stderr.contains("unexpected")
            || stderr.contains("invalid"),
        "stderr: {}",
        stderr
    );
}

// ── cleanup subcommand ─────────────────────────────────────────────────────

#[test]
fn cleanup_dry_run_does_not_delete() {
    let (tmp, sidecar) = stage_resolved();
    let (stdout, _stderr, code) = run_cli(&[
        "cleanup",
        "--folder",
        tmp.path().to_str().unwrap(),
        "--dry-run",
    ]);
    assert_eq!(code, 0);
    assert!(stdout.contains("would delete"));
    assert!(stdout.contains("1 file(s) would delete"));
    assert!(sidecar.exists());
}

#[test]
fn cleanup_deletes_fully_resolved_files() {
    let (tmp, sidecar) = stage_resolved();
    let (stdout, _stderr, code) = run_cli(&["cleanup", "--folder", tmp.path().to_str().unwrap()]);
    assert_eq!(code, 0);
    assert!(stdout.contains("deleted"));
    assert!(stdout.contains("1 file(s) deleted"));
    assert!(!sidecar.exists());
}

#[test]
fn cleanup_default_skips_unresolved_files() {
    let (tmp, sidecar) = stage_mixed();
    let (stdout, _stderr, code) = run_cli(&["cleanup", "--folder", tmp.path().to_str().unwrap()]);
    assert_eq!(code, 0);
    assert!(stdout.contains("0 file(s) deleted"));
    assert!(sidecar.exists());
}

#[test]
fn cleanup_include_unresolved_deletes_all() {
    let (tmp, sidecar) = stage_mixed();
    let (stdout, _stderr, code) = run_cli(&[
        "cleanup",
        "--folder",
        tmp.path().to_str().unwrap(),
        "--include-unresolved",
    ]);
    assert_eq!(code, 0);
    assert!(stdout.contains("1 file(s) deleted"));
    assert!(!sidecar.exists());
}
