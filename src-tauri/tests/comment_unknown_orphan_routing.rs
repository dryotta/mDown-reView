//! Issue #280 AC7 — `Anchor::Unknown` (typed-anchor passthrough that the
//! current renderer cannot author) must surface as **orphaned** so the
//! toolbar's orphan pill makes it visible. Previously it was silently
//! anchored at synthetic line 0 with `is_orphaned: false`, which the UI
//! treated as file-level (causing the AC7 "invisible orphan" bug).
//!
//! The companion invariant (issue #131): `Anchor::File` MUST remain
//! anchored at line 1 and non-orphaned. This test pins both behaviours
//! in the same fixture so a future refactor cannot regress one without
//! the other.

use mdown_review_lib::commands::comments::get_file_comments_inner;
use mdown_review_lib::core::sidecar::save_sidecar;
use mdown_review_lib::core::types::{Anchor, MrsfComment};
use mdown_review_lib::watcher::SidecarConfigState;

fn typed_comment(id: &str, anchor: Anchor) -> MrsfComment {
    MrsfComment {
        id: id.into(),
        author: "Test (test)".into(),
        timestamp: "2026-04-20T12:00:00-07:00".into(),
        text: "typed".into(),
        resolved: false,
        anchor,
        ..Default::default()
    }
}

#[test]
fn anchor_file_anchored_at_one_unknown_orphans() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("doc.md");
    std::fs::write(&file, b"line one\nline two\n").unwrap();
    let file_path = file.to_str().unwrap().to_string();

    let file_c = typed_comment("c-file", Anchor::File);
    let unknown_c = typed_comment(
        "c-unknown",
        Anchor::Unknown {
            kind: "csv_cell".into(),
            data: serde_json::json!({"row": 0, "col": 0}),
        },
    );
    save_sidecar(&file_path, "doc.md", &[file_c, unknown_c]).unwrap();

    let config = SidecarConfigState::new();
    let result = get_file_comments_inner(&file_path, &config).expect("ok");
    assert_eq!(result.threads.len(), 2);

    let by_id: std::collections::HashMap<&str, _> = result
        .threads
        .iter()
        .map(|t| (t.root.comment.id.as_str(), &t.root))
        .collect();

    let file_mc = by_id["c-file"];
    assert_eq!(file_mc.matched_line_number, 1, "#131: File anchor stays at line 1");
    assert!(!file_mc.is_orphaned, "#131: File anchor never orphans");
    assert_eq!(file_mc.original_line, None);

    let unk_mc = by_id["c-unknown"];
    assert_eq!(unk_mc.matched_line_number, 0, "Unknown stays at sentinel line 0 (rule 31)");
    assert!(unk_mc.is_orphaned, "AC7: Unknown must surface as orphaned for the toolbar pill");
    assert_eq!(unk_mc.original_line, None);
}
