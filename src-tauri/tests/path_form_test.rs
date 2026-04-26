//! IPC path-form regression test (issue #89).
//!
//! Asserts that no IPC-facing command emits a Windows `\\?\` verbatim prefix
//! across the boundary. Production paths are normalised in
//! `core::paths::canonicalize_no_verbatim` (a thin `dunce::canonicalize`
//! wrapper); this test guards against silent reintroduction.
//!
//! Windows-only — the bug is Windows-specific, the assertion would be
//! vacuously true on POSIX hosts.

#![cfg(windows)]

use mdown_review_lib::commands::{parse_launch_args, read_dir, scan_review_files};
use std::fs;
use std::path::PathBuf;
use tempfile::tempdir;

const VERBATIM: &str = r"\\?\";

fn assert_no_verbatim(label: &str, value: &str) {
    assert!(
        !value.contains(VERBATIM),
        "{label} leaked `\\\\?\\` verbatim prefix: {value}",
    );
}

/// Build a real workspace with one source + sidecar so all three commands
/// have something to find. Returns the canonicalized workspace path so we
/// can also pass the bare form to `parse_launch_args` separately.
fn build_workspace() -> tempfile::TempDir {
    let dir = tempdir().unwrap();
    fs::write(dir.path().join("doc.md"), "# doc").unwrap();
    fs::write(
        dir.path().join("doc.md.review.yaml"),
        "mrsf_version: \"1.0\"\ndocument: \"doc.md\"\ncomments: []\n",
    )
    .unwrap();
    let sub = dir.path().join("nested");
    fs::create_dir(&sub).unwrap();
    fs::write(sub.join("inner.md"), "x").unwrap();
    dir
}

#[test]
fn parse_launch_args_emits_no_verbatim_prefix() {
    let ws = build_workspace();
    let args = vec![
        "--folder".to_string(),
        ws.path().to_string_lossy().into_owned(),
        "--file".to_string(),
        ws.path().join("doc.md").to_string_lossy().into_owned(),
    ];
    let cwd = tempdir().unwrap();
    let out = parse_launch_args(&args, cwd.path());
    for f in &out.folders {
        assert_no_verbatim("parse_launch_args.folders[]", f);
    }
    for f in &out.files {
        assert_no_verbatim("parse_launch_args.files[]", f);
    }
    assert!(!out.folders.is_empty(), "expected at least one folder");
    assert!(!out.files.is_empty(), "expected at least one file");
}

#[test]
fn read_dir_emits_no_verbatim_prefix() {
    let ws = build_workspace();
    // Pass the bare form (what the frontend would send from a dialog).
    let entries = read_dir(ws.path().to_string_lossy().into_owned()).expect("read_dir");
    assert!(!entries.is_empty(), "expected at least one entry");
    for e in &entries {
        assert_no_verbatim("read_dir.path", &e.path);
    }
}

#[test]
fn scan_review_files_emits_no_verbatim_prefix() {
    let ws = build_workspace();
    let pairs =
        scan_review_files(ws.path().to_string_lossy().into_owned()).expect("scan_review_files");
    assert!(!pairs.is_empty(), "expected at least one sidecar pair");
    for (sidecar, source) in &pairs {
        assert_no_verbatim("scan_review_files.sidecar", sidecar);
        assert_no_verbatim("scan_review_files.source", source);
    }
}

/// Cross-command consistency: emitted paths from `scan_review_files` must
/// share form with what `read_dir` produces for the same workspace, so the
/// frontend's string-equality matching for ghost dedupe and "Other files"
/// filtering works without per-component normalisation.
#[test]
fn scan_review_files_shares_form_with_read_dir() {
    let ws = build_workspace();
    let entries =
        read_dir(ws.path().to_string_lossy().into_owned()).expect("read_dir");
    let pairs =
        scan_review_files(ws.path().to_string_lossy().into_owned()).expect("scan_review_files");

    // Pick the source path emitted for doc.md by the scanner and assert
    // read_dir would emit the byte-identical string for the same file.
    let source_from_scan: PathBuf = pairs
        .iter()
        .map(|(_, src)| PathBuf::from(src))
        .find(|p| p.file_name().and_then(|n| n.to_str()) == Some("doc.md"))
        .expect("scanner missed doc.md");
    let source_from_read_dir: PathBuf = entries
        .iter()
        .find(|e| e.name == "doc.md")
        .map(|e| PathBuf::from(&e.path))
        .expect("read_dir missed doc.md");
    assert_eq!(
        source_from_scan, source_from_read_dir,
        "scanner and read_dir must agree on the path string for the same file",
    );
}
