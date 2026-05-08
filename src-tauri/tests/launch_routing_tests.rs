//! Group D / iteration 1 of issue #359 — AC4: CLI/single-instance forwarding
//! to an existing window must grant asset-scope + watcher seed for the new
//! file's parent dir BEFORE emitting `open-file-tab`.
//!
//! Runtime check: `route_args_through_registry` takes `&tauri::AppHandle`
//! and `tauri::test::mock_app()` is unusable on the dev Windows host
//! (precedent: `comments_emit_test.rs`, `watcher_emit_test.rs`,
//! `window_register_tests.rs`). The asset-scope wiring is verified by the
//! native E2E layer (Group E, future iterations).
//!
//! What this file pins instead is the load-bearing source-level invariant:
//! the `AddToWindow` branch in `launch_routing::route_args_through_registry`
//! calls `extend_window_scope(..., ScopeGrant::FilesParents(...))` BEFORE
//! `emit_to(label, "open-file-tab", ...)`. The semantics of
//! `extend_window_scope` (FilesParents → deduped parent watcher seed in
//! `tree_watched_dirs[label]`) are covered by `window_register_tests.rs`,
//! so pinning the call-order at the chokepoint completes the proof.
//!
//! This mirrors the source-text guard pattern already used in
//! `forbid_app_webview_windows_iteration_test.rs`,
//! `forbid_hardcoded_main_label_test.rs`, and
//! `forbid_set_menu_test.rs`.

use std::fs;
use std::path::PathBuf;

fn launch_routing_src() -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/launch_routing.rs");
    fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("read {}: {e}", path.display()))
}

/// Locate the body of the `AddToWindow` arm by scanning for the arm header
/// and balancing `{`/`}` until the closing brace. Returns the substring
/// from the arm header to (and including) the closing brace.
fn add_to_window_arm_body(src: &str) -> String {
    let arm_marker = "RouteDecision::AddToWindow { label, files } =>";
    let start = src
        .find(arm_marker)
        .unwrap_or_else(|| panic!("AddToWindow arm header not found in launch_routing.rs"));

    // Find the opening `{` of the arm body after the `=>`.
    let after_marker = &src[start + arm_marker.len()..];
    let body_open_rel = after_marker
        .find('{')
        .unwrap_or_else(|| panic!("AddToWindow arm body opener `{{` not found"));
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
    panic!("unbalanced braces while scanning AddToWindow arm body");
}

#[test]
fn add_to_window_extends_scope_before_emit() {
    let src = launch_routing_src();
    let arm = add_to_window_arm_body(&src);

    // Both calls must be present in the AddToWindow arm.
    let extend_idx = arm.find("extend_window_scope").unwrap_or_else(|| {
        panic!(
            "AC4 violation: AddToWindow arm does not call `extend_window_scope`.\n\
             arm body:\n{arm}"
        )
    });
    let grant_idx = arm.find("ScopeGrant::FilesParents").unwrap_or_else(|| {
        panic!(
            "AC4 violation: AddToWindow arm does not pass `ScopeGrant::FilesParents`.\n\
             arm body:\n{arm}"
        )
    });
    let emit_idx = arm.find("emit_to").unwrap_or_else(|| {
        panic!("AddToWindow arm unexpectedly missing `emit_to` — test stale?\narm body:\n{arm}")
    });
    let open_file_tab_idx = arm.find("\"open-file-tab\"").unwrap_or_else(|| {
        panic!(
            "AddToWindow arm unexpectedly missing `\"open-file-tab\"` — test stale?\n\
             arm body:\n{arm}"
        )
    });

    // The grant must be passed to the same call site as `extend_window_scope`.
    assert!(
        grant_idx > extend_idx,
        "AC4 violation: `ScopeGrant::FilesParents` must appear inside the \
         `extend_window_scope(...)` call in the AddToWindow arm"
    );

    // The scope-extension must happen BEFORE the emit_to(open-file-tab) call —
    // otherwise the renderer races the grant and the workspace guard rejects
    // the early read on the freshly-forwarded file.
    assert!(
        extend_idx < emit_idx,
        "AC4 violation: `extend_window_scope` must precede `emit_to` in the \
         AddToWindow arm (otherwise the renderer drains `open-file-tab` \
         before the asset-scope + watcher seed land).\narm body:\n{arm}"
    );
    assert!(
        extend_idx < open_file_tab_idx,
        "AC4 violation: `extend_window_scope` must precede the \
         `open-file-tab` emit in the AddToWindow arm.\narm body:\n{arm}"
    );
}
