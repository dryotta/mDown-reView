//! Tests for sidecar load/save/patch. Extracted to keep mod.rs under
//! the 400-LOC budget (rule 23 in docs/architecture.md).

use super::*;
use crate::core::types::{Anchor, MrsfComment};
use tempfile::TempDir;

/// Builder used by [`sample_comment_with`]. Lets individual tests
/// override the fields that vary across cases (whitespace prefixes,
/// anchored text, sparse-fixture matching) without each test
/// re-listing the dozen `Option::None` defaults.
struct CommentBuilder {
    id: String,
    text: String,
    line: Option<u32>,
    selected_text: Option<String>,
    anchored_text: Option<String>,
}

fn sample_comment(id: &str) -> MrsfComment {
    sample_comment_with(id, |_| {})
}

fn sample_comment_with<F: FnOnce(&mut CommentBuilder)>(id: &str, f: F) -> MrsfComment {
    let mut b = CommentBuilder {
        id: id.to_string(),
        text: "test comment".to_string(),
        line: Some(1),
        selected_text: None,
        anchored_text: None,
    };
    f(&mut b);

    // Keep the `Anchor::Line` payload in sync with the legacy flat
    // line/selected_text fields. The wire round-trip would otherwise
    // overwrite the in-memory anchor with values reconstructed from
    // the flat fields (see `wire::TryFrom<MrsfCommentRepr>`), which
    // would make `assert_sidecar_eq` spuriously fail.
    let anchor = Anchor::Line {
        line: b.line.unwrap_or(0),
        end_line: None,
        start_column: None,
        end_column: None,
        selected_text: b.selected_text.clone(),
        selected_text_hash: None,
    };

    MrsfComment {
        id: b.id,
        author: "test".to_string(),
        timestamp: "2025-01-01T00:00:00Z".to_string(),
        text: b.text,
        resolved: false,
        line: b.line,
        end_line: None,
        start_column: None,
        end_column: None,
        selected_text: b.selected_text,
        anchored_text: b.anchored_text,
        selected_text_hash: None,
        commit: None,
        comment_type: None,
        severity: None,
        reply_to: None,
        anchor,
        ..Default::default()
    }
}

/// Byte-exact equality across every sidecar field. `MrsfSidecar`
/// itself doesn't derive `PartialEq` (only its `Vec<MrsfComment>`
/// does), so compare structurally. This is the only oracle worth
/// using for round-trip tests — substring / `is_some()` / length
/// checks let the saphyr block-scalar bug ship (#293).
fn assert_sidecar_eq(loaded: &MrsfSidecar, expected: &MrsfSidecar) {
    assert_eq!(
        loaded.mrsf_version, expected.mrsf_version,
        "mrsf_version round-trip mismatch"
    );
    assert_eq!(
        loaded.document, expected.document,
        "document round-trip mismatch"
    );
    assert_eq!(
        loaded.comments, expected.comments,
        "comments round-trip mismatch (byte-exact)"
    );
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
    let expected = MrsfSidecar {
        mrsf_version: "1.0".to_string(),
        document: "test.md".to_string(),
        comments: vec![sample_comment_with("c1", |b| {
            b.text = "hello".to_string();
            b.line = None; // fixture has no `line` field
        })],
    };
    assert_sidecar_eq(&result.unwrap(), &expected);
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
    let expected = MrsfSidecar {
        mrsf_version: "1.0".to_string(),
        document: "test.md".to_string(),
        comments: vec![sample_comment_with("c1", |b| {
            b.text = "hello".to_string();
            b.line = None; // fixture has no `line` field
        })],
    };
    assert_sidecar_eq(&result.unwrap(), &expected);
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
    let expected = MrsfSidecar {
        mrsf_version: "1.5".to_string(),
        document: "v1x.md".to_string(),
        comments: vec![],
    };
    assert_sidecar_eq(&result.unwrap(), &expected);
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
        None,
        None,
        None,
        None,
        None,
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
        None,
        None,
        None,
        None,
        None,
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

// ── #293 P0 tests: block-literal indent bug + write-side chokepoint ─────────
//
// All tests here assert byte-exact round-trip on whitespace-bearing string
// fields. Without `emit_mrsf_yaml`'s repair pass, saphyr-0.0.25 would emit
// a `|N` indicator computed against the absolute body column instead of
// parent-relative, producing YAML the parser rejects (and silently dropping
// the comment on next load — the exact failure mode reported in #293).

/// AC4 regression — verbatim from issue #293 body.
#[test]
fn regression_saphyr_block_scalar_indent_bug() {
    let payload = MrsfSidecar {
        mrsf_version: "1.0".into(),
        document: "test.md".into(),
        comments: vec![sample_comment_with("abc", |b| {
            b.selected_text = Some(
                " install, and launch the mdownreview desktop app\n\
                 readScan for review sidecars\n\
                 reviewOrchestrate the full c"
                    .into(),
            );
        })],
    };
    let yaml = emit_mrsf_yaml(&payload).expect("must emit valid yaml");
    let round: MrsfSidecar = serde_saphyr::from_str(&yaml).expect("emitted yaml must parse");
    assert_eq!(
        round.comments[0].selected_text, payload.comments[0].selected_text,
        "selected_text must round-trip byte-exact"
    );
}

/// Exact reproducer from #293: `selected_text` with one leading space,
/// 3 lines, no trailing newline. Forces saphyr's literal-block branch.
#[test]
fn save_then_load_preserves_selected_text_with_leading_space() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("doc.md");
    std::fs::write(&file_path, "# Test").unwrap();

    let original = " install, and launch the mdownreview desktop app\n\
                    readScan for review sidecars\n\
                    reviewOrchestrate the full c"
        .to_string();
    let comment = sample_comment_with("c1", |b| {
        b.selected_text = Some(original.clone());
    });
    save_sidecar(file_path.to_str().unwrap(), "doc.md", &[comment]).unwrap();

    let loaded = load_sidecar(file_path.to_str().unwrap()).unwrap().unwrap();
    assert_eq!(
        loaded.comments[0].selected_text.as_deref(),
        Some(original.as_str()),
        "selected_text with leading space must round-trip byte-exact"
    );
}

#[test]
fn save_then_load_preserves_selected_text_with_leading_tab() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("doc.md");
    std::fs::write(&file_path, "# Test").unwrap();

    let original = "\tline1\nline2\nline3".to_string();
    let comment = sample_comment_with("c1", |b| {
        b.selected_text = Some(original.clone());
    });
    save_sidecar(file_path.to_str().unwrap(), "doc.md", &[comment]).unwrap();

    let loaded = load_sidecar(file_path.to_str().unwrap()).unwrap().unwrap();
    assert_eq!(
        loaded.comments[0].selected_text.as_deref(),
        Some(original.as_str())
    );
}

#[test]
fn save_then_load_preserves_selected_text_with_leading_newline() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("doc.md");
    std::fs::write(&file_path, "# Test").unwrap();

    let original = "\n  body\n  more".to_string();
    let comment = sample_comment_with("c1", |b| {
        b.selected_text = Some(original.clone());
    });
    save_sidecar(file_path.to_str().unwrap(), "doc.md", &[comment]).unwrap();

    let loaded = load_sidecar(file_path.to_str().unwrap()).unwrap().unwrap();
    assert_eq!(
        loaded.comments[0].selected_text.as_deref(),
        Some(original.as_str())
    );
}

#[test]
fn save_then_load_preserves_text_with_leading_whitespace() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("doc.md");
    std::fs::write(&file_path, "# Test").unwrap();

    let original = "  multi-line\n  comment\n  body".to_string();
    let comment = sample_comment_with("c1", |b| {
        b.text = original.clone();
    });
    save_sidecar(file_path.to_str().unwrap(), "doc.md", &[comment]).unwrap();

    let loaded = load_sidecar(file_path.to_str().unwrap()).unwrap().unwrap();
    assert_eq!(
        loaded.comments[0].text, original,
        "comment.text with leading whitespace must round-trip byte-exact"
    );
}

#[test]
fn save_then_load_preserves_anchored_text_multiline() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("doc.md");
    std::fs::write(&file_path, "# Test").unwrap();

    let original = "  anchor line 1\n  anchor line 2\n  anchor line 3".to_string();
    let comment = sample_comment_with("c1", |b| {
        b.anchored_text = Some(original.clone());
    });
    save_sidecar(file_path.to_str().unwrap(), "doc.md", &[comment]).unwrap();

    let loaded = load_sidecar(file_path.to_str().unwrap()).unwrap().unwrap();
    assert_eq!(
        loaded.comments[0].anchored_text.as_deref(),
        Some(original.as_str())
    );
}

/// File-level anchors don't carry `selected_text` (the wire-level
/// guard rejects it: `Anchor::File requires explicit anchor_kind:"file"
/// with NO flat targeting fields`). Exercise the same write path with
/// whitespace-leading content via the comment's `text` field instead.
#[test]
fn save_then_load_file_anchor_with_whitespace_text() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("doc.md");
    std::fs::write(&file_path, "# Test").unwrap();

    let original = "  file-level\n  comment\n  body".to_string();
    let mut comment = sample_comment_with("c1", |b| {
        b.text = original.clone();
        b.line = None; // file anchor: no flat targeting
    });
    comment.anchor = Anchor::File;
    save_sidecar(file_path.to_str().unwrap(), "doc.md", &[comment]).unwrap();

    let loaded = load_sidecar(file_path.to_str().unwrap()).unwrap().unwrap();
    assert_eq!(loaded.comments[0].text, original);
    assert!(matches!(loaded.comments[0].anchor, Anchor::File));
}

#[test]
fn save_then_load_multiple_comments_mixed_content() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("doc.md");
    std::fs::write(&file_path, "# Test").unwrap();

    let leading_space = " selected with leading space\nline2\nline3".to_string();
    let leading_tab = "\ttabby text\non multiple lines\nfor sure".to_string();

    let mut c1 = sample_comment_with("c1", |b| {
        b.selected_text = Some(leading_space.clone());
    });
    c1.id = "c1".into();
    let mut c2 = sample_comment_with("c2", |b| {
        b.text = leading_tab.clone();
    });
    c2.id = "c2".into();
    let c3 = sample_comment_with("c3", |b| {
        b.text = "no whitespace here".into();
    });

    save_sidecar(file_path.to_str().unwrap(), "doc.md", &[c1, c2, c3]).unwrap();

    let loaded = load_sidecar(file_path.to_str().unwrap()).unwrap().unwrap();
    assert_eq!(loaded.comments.len(), 3);
    assert_eq!(
        loaded.comments[0].selected_text.as_deref(),
        Some(leading_space.as_str())
    );
    assert_eq!(loaded.comments[1].text, leading_tab);
    assert_eq!(loaded.comments[2].text, "no whitespace here");
}

#[test]
fn save_then_load_preserves_anchor_history_selected_text() {
    use crate::core::types::Anchor;
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("doc.md");
    std::fs::write(&file_path, "# Test").unwrap();

    let history_text = "  history line 1\n  history line 2\n  history line 3".to_string();
    let mut comment = sample_comment_with("c1", |_| {});
    comment.anchor_history = Some(vec![Anchor::Line {
        line: 5,
        end_line: None,
        start_column: None,
        end_column: None,
        selected_text: Some(history_text.clone()),
        selected_text_hash: None,
    }]);

    save_sidecar(file_path.to_str().unwrap(), "doc.md", &[comment]).unwrap();
    let loaded = load_sidecar(file_path.to_str().unwrap()).unwrap().unwrap();

    let history = loaded.comments[0]
        .anchor_history
        .as_ref()
        .expect("history must survive round-trip");
    assert_eq!(history.len(), 1);
    match &history[0] {
        Anchor::Line { selected_text, .. } => {
            assert_eq!(selected_text.as_deref(), Some(history_text.as_str()));
        }
        other => panic!("expected Anchor::Line, got {:?}", other),
    }
}

/// Lossy fallback path for `patch_comment` (L376) must preserve
/// whitespace-leading `selected_text`. We can't reliably force the
/// fallback (surgery handles `SetResolved` for typical inputs), so we
/// assert the invariant that matters in BOTH branches: even if the
/// surgery path was taken, the bytes survive (surgery preserves bytes
/// by definition); even if the lossy fallback was taken, the
/// emit_mrsf_yaml chokepoint preserves them.
#[test]
fn patch_comment_lossy_fallback_preserves_whitespace_selected_text() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("doc.md");
    std::fs::write(&file_path, "# Test").unwrap();

    let original = " selected with leading space\nline2\nline3".to_string();
    let comment = sample_comment_with("c1", |b| {
        b.selected_text = Some(original.clone());
    });
    save_sidecar(file_path.to_str().unwrap(), "doc.md", &[comment]).unwrap();

    patch_comment(
        file_path.to_str().unwrap(),
        "c1",
        &[CommentMutation::SetResolved(true)],
    )
    .unwrap();

    let loaded = load_sidecar(file_path.to_str().unwrap()).unwrap().unwrap();
    let c = loaded.comments.iter().find(|c| c.id == "c1").unwrap();
    assert!(c.resolved, "set_resolved must have applied");
    assert_eq!(
        c.selected_text.as_deref(),
        Some(original.as_str()),
        "selected_text must survive patch_comment regardless of surgery vs lossy branch"
    );
}

/// L319 path: `.review.json` exists (no `.review.yaml`), patch_comment
/// migrates to YAML. Whitespace-leading `selected_text` must survive
/// the JSON→YAML emission through the chokepoint.
#[test]
fn patch_comment_json_to_yaml_migration_preserves_whitespace() {
    let tmp = TempDir::new().unwrap();
    let file_path = tmp.path().join("doc.md");
    std::fs::write(&file_path, "# Test").unwrap();

    let original = " leading-space text\nline two\nline three";
    let json_path = tmp.path().join("doc.md.review.json");
    let json = serde_json::json!({
        "mrsf_version": "1.0",
        "document": "doc.md",
        "comments": [{
            "id": "c1",
            "author": "test",
            "timestamp": "2025-01-01T00:00:00Z",
            "text": "test comment",
            "resolved": false,
            "line": 1,
            "selected_text": original,
        }]
    });
    std::fs::write(&json_path, serde_json::to_string(&json).unwrap()).unwrap();

    patch_comment(
        file_path.to_str().unwrap(),
        "c1",
        &[CommentMutation::SetResolved(true)],
    )
    .unwrap();

    // Loaded back via the YAML path (newly written by migration).
    let yaml_path = tmp.path().join("doc.md.review.yaml");
    assert!(yaml_path.exists(), "migration must produce a .review.yaml");
    let loaded = load_sidecar(file_path.to_str().unwrap()).unwrap().unwrap();
    let c = loaded.comments.iter().find(|c| c.id == "c1").unwrap();
    assert!(c.resolved);
    assert_eq!(c.selected_text.as_deref(), Some(original));
}

/// Table-driven matrix: every (field × prefix) combination must
/// round-trip byte-exact. Catches any one-cell regression in a single
/// test, with descriptive failure messages.
#[test]
fn round_trip_every_string_field_with_every_whitespace_prefix() {
    #[derive(Copy, Clone)]
    enum Field {
        Text,
        SelectedText,
        AnchoredText,
    }
    let fields = [Field::Text, Field::SelectedText, Field::AnchoredText];
    let prefixes: &[&str] = &[" ", "\t", "  ", ""];
    let body = "\nbody line two\nbody line three";

    for (fi, field) in fields.iter().enumerate() {
        for (pi, prefix) in prefixes.iter().enumerate() {
            let value = format!("{prefix}content{body}");
            let id = format!("c-{fi}-{pi}");
            let comment = sample_comment_with(&id, |b| match field {
                Field::Text => b.text = value.clone(),
                Field::SelectedText => b.selected_text = Some(value.clone()),
                Field::AnchoredText => b.anchored_text = Some(value.clone()),
            });

            let tmp = TempDir::new().unwrap();
            let file_path = tmp.path().join("doc.md");
            std::fs::write(&file_path, "# Test").unwrap();
            save_sidecar(file_path.to_str().unwrap(), "doc.md", &[comment]).unwrap();
            let loaded = load_sidecar(file_path.to_str().unwrap()).unwrap().unwrap();
            let c = &loaded.comments[0];
            let actual = match field {
                Field::Text => c.text.clone(),
                Field::SelectedText => c.selected_text.clone().unwrap_or_default(),
                Field::AnchoredText => c.anchored_text.clone().unwrap_or_default(),
            };
            assert_eq!(
                actual, value,
                "round-trip failed: field={fi} prefix={pi:?} value={value:?}"
            );
        }
    }
}

/// Validation guard fires when the repair pass would otherwise produce
/// unparseable output. Pre-feed `validate_emitted_mrsf_yaml` a
/// hand-crafted broken document; assert it returns `YamlParse`.
#[test]
fn emit_mrsf_yaml_round_trip_validation_rejects_unparseable_output() {
    use super::io_guards::validate_emitted_mrsf_yaml;
    // `id: x` at col 4, but `text:` at col 6 — inconsistent indent in
    // the same map. saphyr's parser must reject this.
    let broken = "comments:\n  - id: x\n      text: |2-\n  no indent\n";
    let err =
        validate_emitted_mrsf_yaml(broken).expect_err("validator must reject unparseable yaml");
    assert!(
        matches!(err, SidecarError::YamlParse(_)),
        "expected YamlParse, got {:?}",
        err
    );
}

/// Structural round-trip equality check: emit then parse, the parsed
/// JSON Value must `==` the input. Catches a hypothetical repair-pass
/// bug that produces parseable-but-different YAML.
#[test]
fn emit_mrsf_yaml_round_trip_validates_structural_equality() {
    let value = serde_json::json!({
        "mrsf_version": "1.0",
        "document": "test.md",
        "comments": [{
            "id": "c1",
            "author": "test",
            "timestamp": "2025-01-01T00:00:00Z",
            "text": "test comment",
            "resolved": false,
            "line": 1,
            "selected_text": " leading space\nsecond line\nthird line",
        }]
    });
    let yaml = emit_mrsf_yaml(&value).expect("must emit");
    let re_parsed: serde_json::Value =
        serde_saphyr::from_str(&yaml).expect("emitted yaml must parse");
    assert_eq!(
        re_parsed, value,
        "structural round-trip mismatch: yaml=\n{yaml}"
    );
}
