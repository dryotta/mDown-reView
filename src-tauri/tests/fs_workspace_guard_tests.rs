//! Integration tests for the temporary workspace + system-locations guard
//! added to `read_text_file` / `read_binary_file` in iteration 1 of issue #338.
//!
//! TODO(#338-group-b): when Group B lands the full canonicalize-then-allowlist
//! semantics with split read/write allowlists, these tests can be merged into
//! `fs_test.rs` (or whatever Group B ships) and this peer file deleted.

use mdown_review_lib::commands::fs::{ensure_readable, read_binary_file_inner, read_text_file_inner};
use mdown_review_lib::core::paths::canonicalize_no_verbatim;
use mdown_review_lib::watcher::WatcherState;
use std::path::PathBuf;

// ── helpers ────────────────────────────────────────────────────────────────

/// Build a `WatcherState` whose tree-watched dirs contain `workspace`.
fn state_with_workspace(workspace: &std::path::Path) -> WatcherState {
    let (tx, _rx) = std::sync::mpsc::sync_channel(1);
    let state = WatcherState::new(tx);
    let canonical = canonicalize_no_verbatim(workspace).unwrap();
    state
        .set_tree_watched_dirs(
            "test",
            canonical.to_string_lossy().into_owned(),
            vec![canonical.to_string_lossy().into_owned()],
        )
        .unwrap();
    state
}

/// Create a workspace tempdir under the current working directory.
///
/// On Windows, `tempfile::tempdir()` defaults to `%TEMP%` which lives under
/// `C:\Users\<user>\AppData\Local\Temp\…`; the `\AppData\` substring is on
/// the system-locations blocklist so the guard would reject every read of
/// a file inside the test workspace. Pinning to CWD (the `src-tauri/`
/// crate dir under `cargo test`) keeps the workspace path tier-clean on
/// every supported OS without having to mutate `%TEMP%`.
fn workspace_tempdir() -> tempfile::TempDir {
    let cwd = std::env::current_dir().expect("cwd available");
    tempfile::Builder::new()
        .prefix("mdr-fs-guard-")
        .tempdir_in(&cwd)
        .expect("tempdir_in cwd")
}

/// Companion to `workspace_tempdir` for the "outside the workspace" sibling
/// dir — same OS rationale.
fn outside_tempdir() -> tempfile::TempDir {
    let cwd = std::env::current_dir().expect("cwd available");
    tempfile::Builder::new()
        .prefix("mdr-fs-guard-outside-")
        .tempdir_in(&cwd)
        .expect("tempdir_in cwd")
}

fn write_file(dir: &std::path::Path, name: &str, contents: &[u8]) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, contents).unwrap();
    path
}

// ── read_text_file ─────────────────────────────────────────────────────────

#[test]
fn test_read_text_file_inside_workspace_succeeds() {
    let workspace = workspace_tempdir();
    let state = state_with_workspace(workspace.path());
    let file = write_file(workspace.path(), "hello.md", b"# Hello");

    let canonical =
        ensure_readable(file.to_str().unwrap(), &state).expect("inside-workspace must pass");
    let result = read_text_file_inner(canonical.to_string_lossy().into_owned()).unwrap();
    assert_eq!(result.content, "# Hello");
    assert_eq!(result.size_bytes, 7);
}

#[test]
fn test_read_text_file_outside_workspace_rejects() {
    let workspace = workspace_tempdir();
    let outside = outside_tempdir();
    let state = state_with_workspace(workspace.path());
    let file = write_file(outside.path(), "secret.md", b"top secret");

    let err = ensure_readable(file.to_str().unwrap(), &state).unwrap_err();
    assert_eq!(err, "path not in workspace");
}

// ── read_binary_file ──────────────────────────────────────────────────────

#[test]
fn test_read_binary_file_inside_workspace_succeeds() {
    let workspace = workspace_tempdir();
    let state = state_with_workspace(workspace.path());
    let png_bytes: Vec<u8> = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    let file = write_file(workspace.path(), "logo.png", &png_bytes);

    let canonical =
        ensure_readable(file.to_str().unwrap(), &state).expect("inside-workspace must pass");
    let b64 = read_binary_file_inner(canonical.to_string_lossy().into_owned()).unwrap();
    use base64::Engine;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(&b64)
        .unwrap();
    assert_eq!(decoded, png_bytes);
}

#[test]
fn test_read_binary_file_outside_workspace_rejects() {
    let workspace = workspace_tempdir();
    let outside = outside_tempdir();
    let state = state_with_workspace(workspace.path());
    let file = write_file(outside.path(), "outside.bin", &[0u8, 1, 2, 3]);

    let err = ensure_readable(file.to_str().unwrap(), &state).unwrap_err();
    assert_eq!(err, "path not in workspace");
}

// ── system-locations guard ─────────────────────────────────────────────────

#[cfg(unix)]
#[test]
fn test_read_text_file_system_path_rejects() {
    let workspace = workspace_tempdir();
    let state = state_with_workspace(workspace.path());

    // /etc/hosts exists on every supported Unix variant. Even if it didn't,
    // is_path_allowed fails closed on canonicalize errors so the assertion
    // still holds.
    let err = ensure_readable("/etc/hosts", &state).unwrap_err();
    assert_eq!(err, "path not in workspace");
}

#[cfg(unix)]
#[test]
fn test_read_text_file_symlink_to_system_rejects() {
    let workspace = workspace_tempdir();
    let state = state_with_workspace(workspace.path());

    let link = workspace.path().join("hosts-link");
    // Map the symlink to /etc/hosts. Failing to create a symlink (e.g. a
    // sandboxed CI runner that disallows it) skips the assertion gracefully.
    if std::os::unix::fs::symlink("/etc/hosts", &link).is_err() {
        return;
    }

    // canonicalize_no_verbatim resolves the symlink to /etc/hosts which is
    // outside the workspace AND on the system blocklist, so the guard
    // returns the workspace-rejection sentinel.
    let err = ensure_readable(link.to_str().unwrap(), &state).unwrap_err();
    assert_eq!(err, "path not in workspace");
}

#[test]
fn test_read_text_file_dot_dot_traversal_rejects() {
    let workspace = workspace_tempdir();
    let outside = outside_tempdir();
    let state = state_with_workspace(workspace.path());

    // <workspace>/../<sibling-dir>/secret.bin — canonicalization collapses
    // the `..` and the resulting path is outside the watched workspace.
    let outside_canonical = canonicalize_no_verbatim(outside.path()).unwrap();
    let secret = write_file(&outside_canonical, "secret.bin", b"secret");
    let _ = secret;
    let workspace_canonical = canonicalize_no_verbatim(workspace.path()).unwrap();
    let traversal = workspace_canonical
        .join("..")
        .join(outside_canonical.file_name().unwrap())
        .join("secret.bin");

    let err = ensure_readable(traversal.to_str().unwrap(), &state).unwrap_err();
    assert_eq!(err, "path not in workspace");
}

// ── distinct sentinel coverage ─────────────────────────────────────────────
//
// `ensure_readable` uses four distinct error strings so a test can prove
// which guard branch fired (vs. the iter-0 design where every rejection
// returned the same string). The Tier::System branch is reachable only when
// `is_path_allowed` accepts the path AND `classify` then rejects. Seeding
// `tree_watched_dirs[label] = {"/"}` makes any absolute Unix path pass
// containment so `/etc/hosts` survives to the classify call and triggers
// the new `"system path blocked"` sentinel — distinct from the
// containment-rejection sentinel `"path not in workspace"`.
#[cfg(unix)]
#[test]
fn test_read_text_file_classify_system_branch_rejects() {
    let (tx, _rx) = std::sync::mpsc::sync_channel(1);
    let state = WatcherState::new(tx);
    // Seed `tree_watched_dirs[main] = {"/"}` via the public setter so the
    // raw + canonical containment checks accept any absolute Unix path
    // (covers `/etc/hosts`). The follow-up `classify` call is the only
    // gate left — exercising the new `"system path blocked"` sentinel.
    state
        .set_tree_watched_dirs("main", "/".to_string(), vec!["/".to_string()])
        .unwrap();

    let err = ensure_readable("/etc/hosts", &state).unwrap_err();
    assert_eq!(
        err, "system path blocked",
        "expected the classify Tier::System branch sentinel, not the containment sentinel"
    );
}
