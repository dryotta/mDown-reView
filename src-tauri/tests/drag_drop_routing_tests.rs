//! Source-text guard for the drag-drop file-open chokepoint.
//!
//! Drag-drop is a fourth entry point alongside CLI launch,
//! single-instance forwarding, and macOS `RunEvent::Opened` — all four
//! must funnel `LaunchArgs` through `route_args_through_registry` so
//! window-creation + scope-extension cannot drift between sites
//! (Architecture rule 1).
//!
//! Runtime check: the handler lives in
//! `lib.rs::on_window_event` which receives `&tauri::WebviewWindow`,
//! and `tauri::test::mock_app()` is unusable on the dev Windows host
//! (precedent: `launch_routing_tests.rs`, `comments_emit_test.rs`,
//! `watcher_emit_test.rs`, `window_register_tests.rs`). The end-to-end
//! drop behavior is verified by the native E2E layer (future iteration).
//!
//! What this file pins instead is the load-bearing source-level invariant:
//! `lib.rs` matches `WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. })`
//! AND routes through `route_args_through_registry`. Mirrors the
//! source-text guard pattern already used in
//! `launch_routing_tests.rs`, `forbid_app_webview_windows_iteration_test.rs`,
//! `forbid_hardcoded_main_label_test.rs`, and `forbid_set_menu_test.rs`.

use std::fs;
use std::path::PathBuf;

fn lib_rs_src() -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs");
    fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()))
}

/// Locate the body of the `WindowEvent::DragDrop(...) = event` arm by
/// scanning for the `if let` header and balancing braces until the
/// closing `}`. Returns the substring from the marker to (and
/// including) the closing brace.
fn drag_drop_arm_body(src: &str) -> String {
    // Match the `if let tauri::WindowEvent::DragDrop(...) = event {` line.
    // The `Drop { paths, .. }` pattern is a structural commitment — the
    // arm MUST extract `paths` (otherwise it can't forward them).
    let arm_marker = "tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. })";
    let start = src.find(arm_marker).unwrap_or_else(|| {
        panic!(
            "drag-drop arm header not found in lib.rs.\n\
             Expected a match arm matching `{arm_marker}` somewhere in `on_window_event`."
        )
    });

    // Find the opening `{` of the arm body after the `= event` clause.
    let after_marker = &src[start + arm_marker.len()..];
    let body_open_rel = after_marker.find('{').unwrap_or_else(|| {
        panic!("drag-drop arm body opener `{{` not found after marker")
    });
    let body_start = start + arm_marker.len() + body_open_rel;

    // Brace-balance to find the matching close.
    let bytes = src.as_bytes();
    let mut depth: i32 = 0;
    let mut i = body_start;
    while i < bytes.len() {
        match bytes[i] {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return src[start..=i].to_string();
                }
            }
            _ => {}
        }
        i += 1;
    }
    panic!("unbalanced braces while scanning drag-drop arm body");
}

#[test]
fn drag_drop_arm_routes_through_registry() {
    let src = lib_rs_src();
    let arm = drag_drop_arm_body(&src);

    assert!(
        arm.contains("route_args_through_registry"),
        "Drag-drop arm does not call `route_args_through_registry` — \
         opens MUST funnel through the same chokepoint as CLI / single-instance / \
         macOS RunEvent::Opened (Architecture rule 1).\nArm body:\n{arm}"
    );
}

#[test]
fn drag_drop_arm_passes_drag_drop_context_label() {
    let src = lib_rs_src();
    let arm = drag_drop_arm_body(&src);

    // Each call site to `route_args_through_registry` passes a context
    // string that shows up in `[window] {ctx}: …` log lines (single-
    // instance, macOS-open, drag-drop). The string is the only thing
    // distinguishing them in logs — pin it so future renames don't
    // silently drop diagnostic value.
    assert!(
        arm.contains("\"drag-drop\""),
        "Drag-drop arm does not pass the literal context string `\"drag-drop\"` \
         to `route_args_through_registry`; logs would not distinguish drag-drop \
         from other entry points.\nArm body:\n{arm}"
    );
}

#[test]
fn drag_drop_arm_classifies_via_parse_launch_args() {
    let src = lib_rs_src();
    let arm = drag_drop_arm_body(&src);

    // File-vs-folder classification must reuse `parse_launch_args` so
    // the metadata-probe rules cannot drift between CLI and drag-drop.
    assert!(
        arm.contains("parse_launch_args"),
        "Drag-drop arm does not use `parse_launch_args` for path \
         classification. Reusing the CLI parser keeps file-vs-folder \
         rules consistent across all four open entry points.\nArm body:\n{arm}"
    );
}
