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
use mdown_review_lib::watcher::WatcherState;
use std::fs;
use std::path::{Path, PathBuf};
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

/// Regression for issue #89 iter-2: on Windows GitHub runners `os.tmpdir()`
/// returns the 8.3 short-name form (`C:\Users\RUNNER~1\…`). The frontend
/// passes that string into both `set_tree_watched_dirs` (workspace setup)
/// and `get_file_comments` / mutation commands (per-tab). Both Rust sides
/// canonicalize via `core::paths::canonicalize_no_verbatim`, which must
/// resolve 8.3 short components to long form so prefix-matching succeeds —
/// otherwise `enforce_workspace_path` rejects every comment IPC with
/// `path not in workspace` and the DeletedFileViewer flow breaks.
#[test]
fn is_path_or_parent_allowed_accepts_8dot3_short_name_input() {
    use std::ffi::OsString;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};

    extern "system" {
        fn GetShortPathNameW(
            lpsz_long_path: *const u16,
            lpsz_short_path: *mut u16,
            cch_buffer: u32,
        ) -> u32;
    }

    let parent = tempdir().unwrap();
    // Long-named subdir so an 8.3 alias actually exists.
    let workspace = parent.path().join("a-very-long-workspace-name-2026");
    fs::create_dir(&workspace).unwrap();
    let target = workspace.join("todelete.md");
    fs::write(&target, "x").unwrap();

    // Resolve the workspace's 8.3 short-name form (mirrors what GitHub's
    // Windows runner emits via `os.tmpdir()`).
    let wide: Vec<u16> = workspace
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut buf = vec![0u16; 1024];
    let len = unsafe { GetShortPathNameW(wide.as_ptr(), buf.as_mut_ptr(), buf.len() as u32) };
    assert!(len > 0, "GetShortPathNameW failed");
    let short_workspace = PathBuf::from(OsString::from_wide(&buf[..len as usize]));
    // Sanity: the short form must differ from the long form, otherwise the
    // host filesystem isn't generating 8.3 aliases and this test is
    // vacuous (skip rather than false-pass).
    if short_workspace == workspace {
        eprintln!("skipping: host fs has 8.3 generation disabled");
        return;
    }

    // Watcher is set up with the long form (production path: frontend
    // canonicalizes-on-store via the Rust set_tree_watched_dirs guard,
    // which always emits the long form regardless of input alias).
    let (tx, _rx) = std::sync::mpsc::sync_channel::<()>(1);
    let state = WatcherState::new(tx);
    state
        .set_tree_watched_dirs(
            workspace.to_string_lossy().into_owned(),
            vec![workspace.to_string_lossy().into_owned()],
        )
        .expect("set_tree_watched_dirs");

    // Frontend now sends the short-name form for a per-tab IPC. The guard
    // must accept it.
    let short_target = short_workspace.join("todelete.md");
    assert!(
        state.is_path_or_parent_allowed(&short_target),
        "is_path_or_parent_allowed must accept 8.3 short-name input \
         (long workspace: {}; short input: {})",
        workspace.display(),
        short_target.display(),
    );
    // is_path_allowed (existing-file variant) must also accept it.
    assert!(
        state.is_path_allowed(&short_target),
        "is_path_allowed must accept 8.3 short-name input"
    );
    // After deletion, is_path_or_parent_allowed must still accept the
    // short-name form (DeletedFileViewer / orphan-comment path).
    fs::remove_file(&target).unwrap();
    assert!(
        state.is_path_or_parent_allowed(&short_target),
        "is_path_or_parent_allowed must accept 8.3 short-name input after deletion"
    );
    // Quiet unused-import warning when the test body grows.
    let _ = Path::new(".");
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
