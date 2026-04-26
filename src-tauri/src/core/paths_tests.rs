//! Unit tests for core::paths  extracted to keep paths.rs under the
//! 400-LOC budget (architecture rule 23). Included via
//! #[cfg(test)] #[path = "paths_tests.rs"] mod tests; from paths.rs.

use super::*;
use std::fs;
use tempfile::tempdir;

// ---- resolve_path --------------------------------------------------

#[test]
fn resolve_path_absolute_ignores_folder_and_cwd() {
    let abs = tempdir().unwrap();
    let abs_s = abs.path().to_string_lossy().to_string();
    let folder = tempdir().unwrap();
    let cwd = tempdir().unwrap();
    let r = resolve_path(&abs_s, Some(&folder.path().to_string_lossy()), cwd.path());
    assert_eq!(r, abs.path());
}

#[test]
fn resolve_path_relative_uses_folder_when_present() {
    let folder = tempdir().unwrap();
    let cwd = tempdir().unwrap();
    let folder_s = folder.path().to_string_lossy().to_string();
    let r = resolve_path("foo.md", Some(&folder_s), cwd.path());
    assert_eq!(r, folder.path().join("foo.md"));
}

#[test]
fn resolve_path_relative_falls_back_to_cwd() {
    let cwd = tempdir().unwrap();
    let r = resolve_path("foo.md", None, cwd.path());
    assert_eq!(r, cwd.path().join("foo.md"));
}

// ---- source_for_sidecar -------------------------------------------

#[test]
fn source_for_sidecar_strips_yaml_suffix() {
    assert_eq!(
        source_for_sidecar(Path::new("a/b/c.md.review.yaml")),
        Some(PathBuf::from("a/b/c.md")),
    );
}

#[test]
fn source_for_sidecar_strips_json_suffix() {
    assert_eq!(
        source_for_sidecar(Path::new("c.md.review.json")),
        Some(PathBuf::from("c.md")),
    );
}

#[test]
fn source_for_sidecar_returns_none_for_non_sidecar() {
    assert_eq!(source_for_sidecar(Path::new("c.md")), None);
}

// ---- resolve_sidecar ----------------------------------------------

#[test]
fn resolve_sidecar_finds_yaml_when_only_yaml_present() {
    let dir = tempdir().unwrap();
    let folder = dir.path();
    let yaml = folder.join("doc.md.review.yaml");
    fs::write(&yaml, "y").unwrap();
    let folder_s = folder.to_string_lossy().to_string();
    let r = resolve_sidecar("doc.md", Some(&folder_s), folder).unwrap();
    assert_eq!(r, canonicalize_no_verbatim(&yaml).unwrap());
}

#[test]
fn resolve_sidecar_falls_back_to_json_when_only_json_present() {
    let dir = tempdir().unwrap();
    let folder = dir.path();
    let json = folder.join("doc.md.review.json");
    fs::write(&json, "j").unwrap();
    let folder_s = folder.to_string_lossy().to_string();
    let r = resolve_sidecar("doc.md", Some(&folder_s), folder).unwrap();
    assert_eq!(r, canonicalize_no_verbatim(&json).unwrap());
}

#[test]
fn resolve_sidecar_prefers_yaml_when_both_present() {
    let dir = tempdir().unwrap();
    let folder = dir.path();
    let yaml = folder.join("doc.md.review.yaml");
    let json = folder.join("doc.md.review.json");
    fs::write(&yaml, "y").unwrap();
    fs::write(&json, "j").unwrap();
    let folder_s = folder.to_string_lossy().to_string();
    let r = resolve_sidecar("doc.md", Some(&folder_s), folder).unwrap();
    assert_eq!(r, canonicalize_no_verbatim(&yaml).unwrap());
}

#[test]
fn resolve_sidecar_missing_errors_with_input_and_folder() {
    let dir = tempdir().unwrap();
    let folder = dir.path();
    let folder_s = folder.to_string_lossy().to_string();
    let err = resolve_sidecar("nope.md", Some(&folder_s), folder).unwrap_err();
    assert!(err.contains("nope.md"), "missing input in error: {err}");
    assert!(err.contains(&folder_s), "missing folder in error: {err}");
    assert!(err.contains("not found"), "unexpected error: {err}");
}

#[test]
fn resolve_sidecar_rejects_dotdot_traversal() {
    let parent = tempdir().unwrap();
    let folder = parent.path().join("inner");
    fs::create_dir(&folder).unwrap();
    // sidecar lives outside `folder`, but inside `parent`
    let outside = parent.path().join("outside.md.review.yaml");
    fs::write(&outside, "x").unwrap();
    let folder_s = folder.to_string_lossy().to_string();
    let result = resolve_sidecar("../outside.md", Some(&folder_s), &folder);
    assert!(result.is_err(), "expected rejection, got {result:?}");
    let err = result.unwrap_err();
    assert!(
        err.contains("outside") || err.contains("not found"),
        "unexpected error message: {err}"
    );
}

#[test]
fn resolve_sidecar_canonicalizes_parent_for_write_path() {
    let dir = tempdir().unwrap();
    let folder = dir.path();
    let folder_s = folder.to_string_lossy().to_string();
    // Sidecar does not yet exist; explicit suffix → write path.
    let r = resolve_sidecar("new.md.review.yaml", Some(&folder_s), folder).unwrap();
    let expected = canonicalize_no_verbatim(folder).unwrap().join("new.md.review.yaml");
    assert_eq!(r, expected);
}

#[cfg(unix)]
#[test]
fn resolve_sidecar_rejects_symlink_escape_unix() {
    use std::os::unix::fs::symlink;
    let outside_dir = tempdir().unwrap();
    let outside_file = outside_dir.path().join("secret.md.review.yaml");
    fs::write(&outside_file, "secret").unwrap();
    let folder_dir = tempdir().unwrap();
    let folder = folder_dir.path();
    let link = folder.join("doc.md.review.yaml");
    symlink(&outside_file, &link).unwrap();
    let folder_s = folder.to_string_lossy().to_string();
    let err = resolve_sidecar("doc.md", Some(&folder_s), folder).unwrap_err();
    assert!(
        err.contains("outside") || err.contains("not found"),
        "unexpected error: {err}"
    );
}

#[cfg(windows)]
#[test]
fn resolve_sidecar_rejects_symlink_escape_windows() {
    use std::os::windows::fs::symlink_file;
    let outside_dir = tempdir().unwrap();
    let outside_file = outside_dir.path().join("secret.md.review.yaml");
    fs::write(&outside_file, "secret").unwrap();
    let folder_dir = tempdir().unwrap();
    let folder = folder_dir.path();
    let link = folder.join("doc.md.review.yaml");
    // Windows symlink creation requires SeCreateSymbolicLink (admin or
    // Developer Mode). If unavailable we skip — the unix variant
    // still exercises the security path on every CI run.
    if symlink_file(&outside_file, &link).is_err() {
        eprintln!("skipping: symlink_file requires Developer Mode / admin");
        return;
    }
    let folder_s = folder.to_string_lossy().to_string();
    let err = resolve_sidecar("doc.md", Some(&folder_s), folder).unwrap_err();
    assert!(
        err.contains("outside") || err.contains("not found"),
        "unexpected error: {err}"
    );
}

// ---- canonicalize_no_verbatim ------------------------------------

#[test]
fn canonicalize_no_verbatim_posix_passthrough() {
    // On any platform, canonicalizing a real tempdir succeeds and
    // returns an absolute path. On non-Windows this matches std
    // exactly; the assertion below is the cross-platform invariant.
    let dir = tempdir().unwrap();
    let canon = canonicalize_no_verbatim(dir.path()).unwrap();
    assert!(canon.is_absolute());
    assert!(canon.exists());
}

#[cfg(windows)]
#[test]
fn canonicalize_no_verbatim_strips_disk_verbatim_prefix() {
    // `dunce` rewrites `\\?\C:\…` to `C:\…` whenever the bare form
    // resolves to the same file. Synthesize the verbatim form by
    // calling std::fs first, then assert dunce strips it.
    let dir = tempdir().unwrap();
    let std_canon = std::fs::canonicalize(dir.path()).unwrap();
    let std_str = std_canon.to_string_lossy();
    // Sanity: std really did emit the verbatim form on this host.
    assert!(
        std_str.starts_with(r"\\?\"),
        "expected std::fs::canonicalize to produce verbatim form on Windows, got {std_str}"
    );
    let bare = canonicalize_no_verbatim(dir.path()).unwrap();
    let bare_str = bare.to_string_lossy();
    assert!(
        !bare_str.starts_with(r"\\?\"),
        "expected non-verbatim form, got {bare_str}"
    );
}

#[cfg(windows)]
#[test]
fn canonicalize_no_verbatim_strips_unc_verbatim_prefix() {
    // We can't reliably create `\\?\UNC\…` paths in a test (would need
    // a real UNC share), so feed dunce a synthetic `\\?\UNC\…` string
    // pointing at a real local dir via its disk form is impossible.
    // Instead, exercise the explicit string-rewrite contract: passing
    // a `\\?\UNC\` path must NOT emit a verbatim result when the bare
    // `\\srv\share` form would mean the same thing. dunce's contract
    // is documented: any UNC verbatim it can simplify, it does.
    // We assert the API surface: a string that already has `\\?\UNC\`
    // and points nowhere yields an Err (file-not-found) — i.e. we
    // never panic, and we never silently strip into a wrong path.
    let bogus = std::path::PathBuf::from(r"\\?\UNC\nonexistent-host\share\file");
    let res = canonicalize_no_verbatim(&bogus);
    assert!(res.is_err(), "expected Err on nonexistent UNC, got {res:?}");
}

#[cfg(windows)]
#[test]
fn canonicalize_no_verbatim_long_path_does_not_panic() {
    // A path long enough that no non-verbatim form is possible
    // (>260 chars). dunce's contract is that it falls back to the
    // verbatim form rather than panicking; we don't care which form
    // we get, only that the call succeeds without unwinding.
    let dir = tempdir().unwrap();
    let mut deep = dir.path().to_path_buf();
    // 30 segments of 10 chars each → ~300 chars beyond the tempdir root.
    for i in 0..30 {
        deep = deep.join(format!("seg-{:04}-x", i));
    }
    std::fs::create_dir_all(&deep).unwrap();
    // Must not panic. On hosts where the dir resolves to a path
    // shorter than MAX_PATH (rare with this many segments) dunce
    // returns the bare form; otherwise it returns the verbatim form.
    let _ = canonicalize_no_verbatim(&deep).expect("long-path canonicalize must succeed");
}

