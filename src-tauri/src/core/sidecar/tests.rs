//! Tests for sidecar load/save/patch. Extracted to keep mod.rs under
//! the 400-LOC budget (rule 23 in docs/architecture.md).

use super::*;
use crate::core::types::MrsfComment;
use tempfile::TempDir;

fn sample_comment(id: &str) -> MrsfComment {
    MrsfComment {
        id: id.to_string(),
        author: "test".to_string(),
        timestamp: "2025-01-01T00:00:00Z".to_string(),
        text: "test comment".to_string(),
        resolved: false,
        line: Some(1),
        end_line: None,
        start_column: None,
        end_column: None,
        selected_text: None,
        anchored_text: None,
        selected_text_hash: None,
        commit: None,
        comment_type: None,
        severity: None,
        reply_to: None,
        ..Default::default()
    }
}

#[test]
fn load_sidecar_yaml() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("test.md");
    let sidecar_path = tmp.path().join("test.md.review.yaml");
    std::fs::write(&file_path, "# Test").unwrap();
    std::fs::write(
        &sidecar_path,
        r#"mrsf_version: "1.0"
document: test.md
comments:
  - id: "c1"
    author: "test"
    timestamp: "2025-01-01T00:00:00Z"
    text: "hello"
    resolved: false
"#,
    )
    .unwrap();

    let result = load_sidecar(file_path.to_str().unwrap()).unwrap();
    assert!(result.is_some());
    let sidecar = result.unwrap();
    assert_eq!(sidecar.comments.len(), 1);
    assert_eq!(sidecar.comments[0].id, "c1");
}

#[test]
fn load_sidecar_json_fallback() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("test.md");
    let json_path = tmp.path().join("test.md.review.json");
    std::fs::write(&file_path, "# Test").unwrap();
    std::fs::write(
            &json_path,
            r#"{"mrsf_version":"1.0","document":"test.md","comments":[{"id":"c1","author":"test","timestamp":"2025-01-01T00:00:00Z","text":"hello","resolved":false}]}"#,
        )
        .unwrap();

    let result = load_sidecar(file_path.to_str().unwrap()).unwrap();
    assert!(result.is_some());
    assert_eq!(result.unwrap().comments[0].id, "c1");
}

#[test]
fn load_sidecar_missing_returns_none() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("nonexistent.md");
    let result = load_sidecar(file_path.to_str().unwrap()).unwrap();
    assert!(result.is_none());
}

#[test]
fn save_sidecar_writes_yaml() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("test.md");
    std::fs::write(&file_path, "# Test").unwrap();

    let comments = vec![sample_comment("c1")];
    save_sidecar(file_path.to_str().unwrap(), "test.md", &comments).unwrap();

    let sidecar_path = tmp.path().join("test.md.review.yaml");
    assert!(sidecar_path.exists());
    let content = std::fs::read_to_string(&sidecar_path).unwrap();
    assert!(content.contains("mrsf_version"));
    assert!(content.contains("c1"));
}

#[test]
fn save_sidecar_emits_v1_0_for_legacy_comments() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("test.md");
    std::fs::write(&file_path, "# Test").unwrap();

    let comments = vec![sample_comment("c1")];
    save_sidecar(file_path.to_str().unwrap(), "test.md", &comments).unwrap();

    let sidecar_path = tmp.path().join("test.md.review.yaml");
    let content = std::fs::read_to_string(&sidecar_path).unwrap();
    let reloaded: crate::core::types::MrsfSidecar = serde_saphyr::from_str(&content).unwrap();
    // Pure-legacy comment ⇒ writer must NOT emit "1.1" (advisory #5).
    assert_eq!(reloaded.mrsf_version, "1.0");
}

#[test]
fn save_sidecar_emits_v1_1_when_v1_1_field_present() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("test.md");
    std::fs::write(&file_path, "# Test").unwrap();

    let mut c = sample_comment("c1");
    c.reactions = Some(vec![crate::core::types::Reaction {
        user: "u".into(),
        kind: "thumbs_up".into(),
        ts: "2025-01-01T00:00:00Z".into(),
    }]);
    save_sidecar(file_path.to_str().unwrap(), "test.md", &[c]).unwrap();

    let sidecar_path = tmp.path().join("test.md.review.yaml");
    let content = std::fs::read_to_string(&sidecar_path).unwrap();
    let reloaded: crate::core::types::MrsfSidecar = serde_saphyr::from_str(&content).unwrap();
    assert_eq!(reloaded.mrsf_version, "1.1");
}

#[test]
fn save_sidecar_empty_deletes() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("test.md");
    let sidecar_path = tmp.path().join("test.md.review.yaml");
    std::fs::write(&file_path, "# Test").unwrap();
    std::fs::write(&sidecar_path, "dummy").unwrap();

    save_sidecar(file_path.to_str().unwrap(), "test.md", &[]).unwrap();
    assert!(!sidecar_path.exists());
}

#[test]
fn patch_comment_resolve() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("test.md");
    std::fs::write(&file_path, "# Test").unwrap();

    let comments = vec![sample_comment("c1"), sample_comment("c2")];
    save_sidecar(file_path.to_str().unwrap(), "test.md", &comments).unwrap();

    patch_comment(
        file_path.to_str().unwrap(),
        "c1",
        &[CommentMutation::SetResolved(true)],
    )
    .unwrap();

    let loaded = load_sidecar(file_path.to_str().unwrap()).unwrap().unwrap();
    assert!(
        loaded
            .comments
            .iter()
            .find(|c| c.id == "c1")
            .unwrap()
            .resolved
    );
    assert!(
        !loaded
            .comments
            .iter()
            .find(|c| c.id == "c2")
            .unwrap()
            .resolved
    );
}

#[test]
fn patch_comment_add_response() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("test.md");
    std::fs::write(&file_path, "# Test").unwrap();

    let comments = vec![sample_comment("c1")];
    save_sidecar(file_path.to_str().unwrap(), "test.md", &comments).unwrap();

    patch_comment(
        file_path.to_str().unwrap(),
        "c1",
        &[CommentMutation::AddResponse {
            author: "agent".to_string(),
            text: "fixed it".to_string(),
            timestamp: "2025-01-02T00:00:00Z".to_string(),
        }],
    )
    .unwrap();

    let content = std::fs::read_to_string(tmp.path().join("test.md.review.yaml")).unwrap();
    assert!(content.contains("fixed it"));
    assert!(content.contains("responses"));
}

#[test]
fn patch_comment_not_found() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("test.md");
    std::fs::write(&file_path, "# Test").unwrap();

    let comments = vec![sample_comment("c1")];
    save_sidecar(file_path.to_str().unwrap(), "test.md", &comments).unwrap();

    let result = patch_comment(
        file_path.to_str().unwrap(),
        "nonexistent",
        &[CommentMutation::SetResolved(true)],
    );
    assert!(matches!(result, Err(SidecarError::CommentNotFound(_))));
}

#[test]
fn load_sidecar_rejects_yaml_anchors() {
    // Defense-in-depth against billion-laughs amplification past the
    // 10 MB byte cap. We never emit YAML anchors/aliases, so any
    // appearance in a sidecar is treated as malicious.
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("anchored.md");
    let yaml_path = tmp.path().join("anchored.md.review.yaml");
    std::fs::write(&file_path, "# t").unwrap();
    let payload = "mrsf_version: \"1.0\"\ndocument: t.md\ncomments:\n  - &c1 { id: a }\n  - *c1\n";
    std::fs::write(&yaml_path, payload).unwrap();

    let err = load_sidecar(file_path.to_str().unwrap()).unwrap_err();
    match err {
        SidecarError::Io(io) => {
            assert_eq!(io.kind(), std::io::ErrorKind::InvalidData);
            assert!(io.to_string().contains("anchors/aliases"));
        }
        other => panic!("expected SidecarError::Io, got {:?}", other),
    }
}

#[test]
fn load_sidecar_rejects_unsupported_major_version() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("future.md");
    let yaml_path = tmp.path().join("future.md.review.yaml");
    std::fs::write(&file_path, "# t").unwrap();
    std::fs::write(
        &yaml_path,
        "mrsf_version: \"2.0\"\ndocument: future.md\ncomments: []\n",
    )
    .unwrap();

    let err = load_sidecar(file_path.to_str().unwrap()).unwrap_err();
    assert!(
        matches!(err, SidecarError::UnsupportedVersion(ref v) if v == "2.0"),
        "expected UnsupportedVersion(\"2.0\"), got {:?}",
        err
    );
}

#[test]
fn load_sidecar_rejects_malformed_version() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("bad.md");
    let yaml_path = tmp.path().join("bad.md.review.yaml");
    std::fs::write(&file_path, "# t").unwrap();
    std::fs::write(
        &yaml_path,
        "mrsf_version: \"banana\"\ndocument: bad.md\ncomments: []\n",
    )
    .unwrap();

    let err = load_sidecar(file_path.to_str().unwrap()).unwrap_err();
    assert!(matches!(err, SidecarError::UnsupportedVersion(_)));
}

#[test]
fn load_sidecar_accepts_v1_minor_versions() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("v1x.md");
    let yaml_path = tmp.path().join("v1x.md.review.yaml");
    std::fs::write(&file_path, "# t").unwrap();
    std::fs::write(
        &yaml_path,
        "mrsf_version: \"1.5\"\ndocument: v1x.md\ncomments: []\n",
    )
    .unwrap();

    let result = load_sidecar(file_path.to_str().unwrap()).unwrap();
    assert!(result.is_some());
    assert_eq!(result.unwrap().mrsf_version, "1.5");
}

// ── Save error semantics (regression: misleading "sidecar not found") ───────

/// Reported (2026-04-28): user added a comment to an image inside a
/// read-only directory (their case: `OneDrive\Pictures`, which OneDrive's
/// Known Folder Move marks read-only and intercepts file creates) and
/// got "sidecar not found" via the frontend banner. The actual cause
/// was the read-only attribute blocking writes. The (now-removed)
/// `From<io::Error>` impl was collapsing every `io::ErrorKind::NotFound`
/// into `SidecarError::NotFound` whose Display is "sidecar not found".
/// This test reproduces an io::Error::NotFound from a save path and
/// proves the error now surfaces as `SidecarError::Io` (preserving the
/// OS message) instead of the misleading `SidecarError::NotFound`.
#[test]
fn save_sidecar_at_io_notfound_does_not_collapse_to_notfound_variant() {
    // `io::ErrorKind::NotFound` from `From<io::Error>` must NOT be
    // collapsed into `SidecarError::NotFound`.
    let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "synthetic write failure");
    let sc_err: SidecarError = io_err.into();
    assert!(
        matches!(sc_err, SidecarError::Io(ref e) if e.kind() == std::io::ErrorKind::NotFound),
        "From<io::Error> must wrap as Io, not NotFound; got {:?}",
        sc_err
    );
    let displayed = sc_err.to_string();
    assert!(
        !displayed.eq_ignore_ascii_case("sidecar not found"),
        "Display must not be the misleading load-error message; got `{displayed}`"
    );
    assert!(
        displayed.contains("synthetic write failure"),
        "Display must surface the OS error detail; got `{displayed}`"
    );
}

/// End-to-end: write to a path whose parent component is a file (Windows
/// and Unix both reject this with NotFound). The error must propagate as
/// `SidecarError::Io`, not `SidecarError::NotFound`. Mimics the same
/// failure mode the user hit in their read-only-directory scenario.
#[test]
fn save_sidecar_at_to_invalid_ancestor_surfaces_real_io_error() {
    let tmp = TempDir::new().unwrap();
    let blocker = tmp.path().join("blocker.txt");
    std::fs::write(&blocker, b"i am a file").unwrap();
    let bogus = blocker.join("inner").join("foo.bin.review.yaml");

    let c = MrsfComment::new_legacy_line(
        "c1".into(),
        "Tester".into(),
        "2026-04-28T00:00:00Z".into(),
        "x".into(),
        false,
        Some(1),
        None, None, None, None, None,
    );
    let result = save_sidecar_at(&bogus, "foo.bin", std::slice::from_ref(&c));
    let err = result.expect_err("write to invalid ancestor must fail");
    assert!(
        matches!(err, SidecarError::Io(_)),
        "must surface as Io, not NotFound; got {:?}",
        err
    );
    let msg = err.to_string();
    assert!(
        !msg.eq_ignore_ascii_case("sidecar not found"),
        "error message must not be the misleading sidecar-not-found string; got `{msg}`"
    );
}

/// Generic read-only directory regression — covers OneDrive's Known
/// Folder Move (Pictures/Documents/Desktop), network shares with
/// restricted permissions, system-protected folders (Program Files,
/// Windows), and read-only mounts uniformly. When the parent directory
/// is read-only the user must see a clear "directory is read-only"
/// message that names the path and points at the documented workaround
/// (`.mrsf.yaml` `sidecar_root`), not the OS's generic NotFound /
/// PermissionDenied phrasing.
#[test]
fn save_sidecar_at_to_readonly_dir_surfaces_clear_message() {
    let tmp = TempDir::new().unwrap();
    let ro_dir = tmp.path().join("readonly");
    std::fs::create_dir(&ro_dir).unwrap();
    // Set the directory's read-only attribute. On Windows this maps to
    // `FILE_ATTRIBUTE_READONLY` (which OneDrive Known Folders set on the
    // Pictures/Documents/Desktop dirs, the user's repro case).
    let mut perms = std::fs::metadata(&ro_dir).unwrap().permissions();
    perms.set_readonly(true);
    std::fs::set_permissions(&ro_dir, perms.clone()).unwrap();

    // Best-effort restore so tempdir cleanup can drop the dir.
    struct RestoreReadWrite<'a>(&'a std::path::Path);
    impl Drop for RestoreReadWrite<'_> {
        fn drop(&mut self) {
            if let Ok(meta) = std::fs::metadata(self.0) {
                let mut p = meta.permissions();
                #[allow(clippy::permissions_set_readonly_false)]
                p.set_readonly(false);
                let _ = std::fs::set_permissions(self.0, p);
            }
        }
    }
    let _restore = RestoreReadWrite(&ro_dir);

    // Some Unix permissions models silently allow root or the file owner
    // to bypass ReadOnly on dirs they own, in which case `write_atomic`
    // succeeds and the test below is a no-op for that environment. Probe
    // first; only run the assertion when the dir actually rejects writes.
    let probe = ro_dir.join("__probe.tmp");
    if std::fs::write(&probe, b"x").is_ok() {
        let _ = std::fs::remove_file(&probe);
        eprintln!("[skip] platform allowed write to a read-only dir; nothing to assert");
        return;
    }

    let target = ro_dir.join("foo.png.review.yaml");
    let c = MrsfComment::new_legacy_line(
        "c1".into(),
        "Tester".into(),
        "2026-04-28T00:00:00Z".into(),
        "x".into(),
        false,
        Some(1),
        None, None, None, None, None,
    );
    let result = save_sidecar_at(&target, "foo.png", std::slice::from_ref(&c));
    let err = result.expect_err("write to read-only dir must fail");
    let msg = err.to_string();

    assert!(
        msg.contains("directory is read-only"),
        "error must surface as a read-only directory message; got `{msg}`"
    );
    assert!(
        msg.contains(&ro_dir.display().to_string()),
        "error must name the offending directory path; got `{msg}`"
    );
    assert!(
        msg.contains(".mrsf.yaml"),
        "error must point at the sidecar_root workaround; got `{msg}`"
    );
    assert!(
        !msg.eq_ignore_ascii_case("sidecar not found"),
        "must not be the misleading load-error string; got `{msg}`"
    );
}

/// Verify that `patch_comment` takes the surgery fast-path when the
/// YAML file contains YAML comments, preserving them on disk.
#[test]
fn patch_comment_preserves_yaml_comments_via_surgery() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("test.md");
    let sidecar_path = tmp.path().join("test.md.review.yaml");
    std::fs::write(&file_path, "# Test").unwrap();

    // Hand-write a sidecar with a YAML comment that serde would drop.
    let yaml_with_comment = "\
mrsf_version: '1.0'
document: test.md
# reviewer metadata below
comments:
  - id: c1
    author: tester
    timestamp: '2025-01-01T00:00:00Z'
    text: hello
    resolved: false
    line: 1
";
    std::fs::write(&sidecar_path, yaml_with_comment).unwrap();

    patch_comment(
        file_path.to_str().unwrap(),
        "c1",
        &[CommentMutation::SetResolved(true)],
    )
    .unwrap();

    let on_disk = std::fs::read_to_string(&sidecar_path).unwrap();
    // The YAML comment must survive (surgery path); serde would drop it.
    assert!(
        on_disk.contains("# reviewer metadata below"),
        "YAML comment was dropped — surgery path not taken. Content:\n{on_disk}"
    );
    // Value actually changed
    assert!(on_disk.contains("resolved: true"));
}
