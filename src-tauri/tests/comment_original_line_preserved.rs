//! Issue #280 AC5 — `MatchedComment.original_line` must be set to the line
//! the user authored against, even after the matcher relocates the comment
//! via the re-anchoring algorithm. Without this field, the panel
//! cannot surface "originally line X → re-anchored to Y" and the reanchor
//! is invisible to the user (the bug AC5 closes).

use mdown_review_lib::commands::comments::get_file_comments_inner;
use mdown_review_lib::core::sidecar::save_sidecar;
use mdown_review_lib::core::types::MrsfComment;
use mdown_review_lib::watcher::SidecarConfigState;

#[test]
fn line_anchored_comment_preserves_original_line_after_relocation() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("doc.md");
    // 8 lines of filler, "hello world" on line 9. The sidecar pins line=7,
    // so the matcher must relocate to line 9 via Step 1 exact-relocated.
    let mut content = String::new();
    for i in 1..=8 {
        content.push_str(&format!("filler line {}\n", i));
    }
    content.push_str("hello world\n");
    std::fs::write(&file, content.as_bytes()).unwrap();
    let file_path = file.to_str().unwrap().to_string();

    let comment = MrsfComment::new_legacy_line(
        "c1".into(),
        "Test (test)".into(),
        "2026-04-20T12:00:00-07:00".into(),
        "needs work".into(),
        false,
        Some(7),
        None,
        None,
        None,
        Some("hello world".into()),
        None,
    );
    save_sidecar(&file_path, "doc.md", &[comment]).unwrap();

    let config = SidecarConfigState::new();
    let result = get_file_comments_inner(&file_path, &config).expect("ok");
    assert_eq!(result.threads.len(), 1);
    let mc = &result.threads[0].root;
    assert_eq!(mc.matched_line_number, 9, "matcher should relocate to line 9");
    assert_eq!(
        mc.original_line,
        Some(7),
        "AC5: pre-rewrite line must survive on MatchedComment.original_line"
    );
    assert!(!mc.is_orphaned);
}
