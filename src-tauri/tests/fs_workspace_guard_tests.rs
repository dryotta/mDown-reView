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
/// `C:\Users\<user>\AppData\Local\Temp\…`. Pinning to CWD (the `src-tauri/`
/// crate dir under `cargo test`) keeps the tempdir off the system-locations
/// classifier path entirely, which is helpful for tests that want to
/// observe pure containment-rejection sentinels without classify-side
/// effects (e.g. `Tier::Inside` vs `Tier::System` distinctions when
/// `is_path_allowed` is widened). After rule 17b of `docs/security.md`
/// landed, `ensure_readable` itself no longer rejects `Tier::System`
/// paths — but pinning to CWD remains a useful diagnostic guarantee for
/// existing assertions.
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

// ── system-locations × workspace-allowlist interaction ────────────────────
//
// Pre-rule-17b, `ensure_readable` rejected `Tier::System` paths outright. Post-
// 17b, the system-locations DENY list applies to content-initiated chokepoints
// only — `ensure_readable` (the read-path defense-in-depth) trusts the watcher
// allowlist. These tests pin the new semantic:
//   * A `Tier::System` path NOT in the allowlist → rejected as "path not in
//     workspace" (containment, not classification).
//   * A `Tier::System` path SEEDED into the allowlist via a user-initiated
//     chokepoint → accepted (the dedicated `_inside_allowlist_succeeds` tests
//     in `user-intent overrides` section below).

#[cfg(unix)]
#[test]
fn test_read_text_file_system_path_rejects() {
    let workspace = workspace_tempdir();
    let state = state_with_workspace(workspace.path());

    // /etc/hosts is not in the workspace allowlist → rejected for being
    // outside the allowlist, NOT because it's Tier::System. This is the
    // post-17b semantic.
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
    // outside the watched workspace, so the guard returns the
    // workspace-rejection sentinel.
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
// `ensure_readable` uses three distinct error strings so a test can prove
// which guard branch fired (vs. the iter-0 design where every rejection
// returned the same string). The three rejection sentinels are
// `"path not in workspace"`, `"canonicalize failed"`, and
// `"path not canonicalizable"`.
//
// `Tier::System` paths are **NOT rejected** here (see rule 17b in
// `docs/security.md`): user-initiated opens carry explicit intent and
// override the content-policy DENY list. The content-initiated chokepoints
// (`commands::path_classify` consumed by `useLinkRouter`,
// `core::html_assets`) still enforce the system-locations DENY list — that
// is where hallucinating-LLM-smuggling defence belongs.
//
// `ensure_readable`'s two canonicalize-related sentinels are defensive
// branches that are **unreachable through the public IPC contract**:
//
//   * `is_path_allowed` is invoked on the raw path BEFORE
//     `canonicalize_no_verbatim`. Because `is_path_allowed` itself canonicalizes
//     internally and fails-closed, any input that would later trip
//     `canonicalize_no_verbatim` has already been rejected with
//     `"path not in workspace"`.
//   * `Tier::classify(canonical, canonical)` cannot return `NonCanonicalErr`
//     because `canonical` is the output of `canonicalize_no_verbatim` — it is
//     by construction absolute, non-verbatim, and `..`-free.
//
// Both branches remain in the source as fail-closed guards against future
// refactors that might bypass the canonicalize step. This test documents that
// non-existent paths under a watched workspace are rejected with **a**
// canonicalize-related sentinel — proving that the rejection contract holds
// even if the exact branch shifts during future refactors. Per test-expert
// review iter 1: an "explicit out-of-scope rationale + a regression test
// asserting the OR of acceptable sentinels" is the agreed resolution.
#[test]
fn test_read_text_file_canonicalize_failed_rejects() {
    let workspace = workspace_tempdir();
    let workspace_canonical = canonicalize_no_verbatim(workspace.path()).unwrap();
    let nonexistent = workspace_canonical.join("nonexistent.md");
    let state = state_with_workspace(workspace.path());

    let err = ensure_readable(nonexistent.to_str().unwrap(), &state).unwrap_err();
    assert!(
        err == "path not in workspace" || err == "canonicalize failed",
        "expected canonicalize-related rejection sentinel, got: {err:?}"
    );
}

// ── user-intent overrides system-locations DENY list ───────────────────────
//
// Regression coverage for rule 17b in `docs/security.md`: an explicit
// user-initiated read of a path that lands in `Tier::System` MUST succeed
// when the path is in the watcher allowlist (i.e. registered via an
// explicit user gesture upstream). The system-locations DENY list applies
// to content-initiated chokepoints only (`commands::path_classify`,
// `core::html_assets`); `ensure_readable` is the read-path defense-in-depth
// for already-claimed files and trusts the upstream gate.

#[cfg(unix)]
#[test]
fn test_read_text_file_system_path_inside_allowlist_succeeds() {
    let (tx, _rx) = std::sync::mpsc::sync_channel(1);
    let state = WatcherState::new(tx);
    // Seed `tree_watched_dirs[main] = {"/"}` so any absolute Unix path
    // passes the containment gate. `/etc/hosts` then reaches classify(),
    // which previously rejected with `"system path blocked"` — now it
    // returns Ok and the read succeeds.
    state
        .set_tree_watched_dirs("main", "/".to_string(), vec!["/".to_string()])
        .unwrap();

    let canonical =
        ensure_readable("/etc/hosts", &state).expect("user-initiated open of system path");
    // On macOS, `/etc` is a symlink to `/private/etc`; `canonicalize_no_verbatim`
    // resolves symlinks, so the returned path is `/private/etc/hosts`. Compare
    // against the same canonicalization the production code performs rather
    // than the input literal.
    let expected = canonicalize_no_verbatim(std::path::Path::new("/etc/hosts"))
        .expect("canonicalize /etc/hosts");
    assert_eq!(canonical, expected);
}

#[cfg(windows)]
#[test]
fn test_read_text_file_appdata_path_inside_allowlist_succeeds() {
    // Mirrors the user-reported failure mode: a file under
    // `C:\Users\<user>\AppData\Local\<vendor>\…` lands in `Tier::System`
    // but is reachable by explicit user intent. Build the file under the
    // current user's real %LOCALAPPDATA% so the `\AppData\` substring
    // match in `core::security::system_locations` fires authentically.
    let local_appdata = std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .expect("LOCALAPPDATA env var");
    // Process-id suffix so concurrent test invocations do not collide.
    let dir = local_appdata.join(format!(
        "mdownreview-test-fs-guard-{}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).expect("create dir under LOCALAPPDATA");
    let file = dir.join("brief.md");
    std::fs::write(&file, b"# Hello").expect("write file");

    // Cleanup via a Drop guard so the test dir is removed even on panic.
    struct Cleanup<'a>(&'a std::path::Path);
    impl Drop for Cleanup<'_> {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(self.0);
        }
    }
    let _cleanup = Cleanup(&dir);

    let (tx, _rx) = std::sync::mpsc::sync_channel(1);
    let state = WatcherState::new(tx);
    let canonical_dir = canonicalize_no_verbatim(&dir).unwrap();
    state
        .set_tree_watched_dirs(
            "main",
            canonical_dir.to_string_lossy().into_owned(),
            vec![canonical_dir.to_string_lossy().into_owned()],
        )
        .unwrap();

    let canonical = ensure_readable(file.to_str().unwrap(), &state)
        .expect("user-initiated open of AppData path");
    let expected = canonicalize_no_verbatim(&file).unwrap();
    assert_eq!(canonical, expected);
}

#[cfg(windows)]
#[test]
fn test_read_text_file_windows_system_path_inside_allowlist_succeeds() {
    // Regression coverage for rule 17b uniform-override across Tier::System
    // flavors. Pairs with the AppData variant above (same chokepoint, different
    // sub-location). `C:\Windows\System32\drivers\etc\hosts` classifies as
    // Tier::System { flavor: Windows } via the `C:\Windows\` prefix in the
    // const table. The user-intent gate must accept it identically to the
    // AppData case — there is no per-prefix carve-out.
    let path = r"C:\Windows\System32\drivers\etc\hosts";
    if !std::path::Path::new(path).exists() {
        return; // hardened image — skip gracefully.
    }
    let canonical_path = canonicalize_no_verbatim(std::path::Path::new(path))
        .expect("canonicalize hosts");

    let (tx, _rx) = std::sync::mpsc::sync_channel(1);
    let state = WatcherState::new(tx);
    // Seed the parent dir into tree_watched_dirs so containment passes —
    // simulates the seed that `register_window_file_inner` would have
    // performed on user-initiated open.
    let parent = canonical_path.parent().expect("hosts has a parent");
    state
        .set_tree_watched_dirs(
            "main",
            parent.to_string_lossy().into_owned(),
            vec![parent.to_string_lossy().into_owned()],
        )
        .unwrap();

    let canonical = ensure_readable(path, &state)
        .expect("user-initiated open of C:\\Windows\\ path");
    assert_eq!(canonical, canonical_path);
}
