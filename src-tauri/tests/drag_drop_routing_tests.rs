//! Source-text guard for the drag-drop file-open chokepoint.
//!
//! Most behaviour is now covered by **runtime** tests:
//!   - `src/registry.rs::tests` — `route_folder_for_target` /
//!     `route_file_for_target` decision tables and ghost-target
//!     fallbacks (must-fix follow-up).
//!   - `src/commands/launch.rs::tests` — sidecar redirect (co-located
//!     and `.mrsf.yaml`-aware), NTFS-ADS guard, parse_launch_args
//!     reuse contract.
//!   - `src/commands/drag_drop.rs::tests` — pure `classify_drop`
//!     classifier covering Empty / OverCap / AllFailed / Partial /
//!     Ok outcomes.
//!
//! What remains as a source-text guard is the **structural choice of
//! `spawn_blocking`** and the **delegation shape from `lib.rs`**: where
//! the code lives and what it imports — properties the runtime tests
//! cannot prove. String checks are the cheapest durable enforcement.
//!
//! `tauri::test::mock_app()` is unusable on the dev Windows host
//! (precedent: `launch_routing_tests.rs`, `comments_emit_test.rs`,
//! `watcher_emit_test.rs`, `window_register_tests.rs`). End-to-end
//! drop behaviour (real `WindowEvent::DragDrop`, real Tauri runtime,
//! real WebView2/WKWebView) is tracked separately as
//! `e2e/native/drag-drop.spec.ts` — see issue #373.

use std::fs;
use std::path::PathBuf;

fn lib_rs_src() -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs");
    fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()))
}

fn drag_drop_module_src() -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/commands/drag_drop.rs");
    fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()))
}

#[test]
fn drag_drop_arm_delegates_to_module() {
    // The lib.rs window-event arm should be a thin delegator — the
    // actual classification + routing lives in `commands::drag_drop`.
    // We don't pin the exact call site shape (helper-function
    // refactors are fine), only that lib.rs contains both the
    // `WindowEvent::DragDrop` match AND a call into the drag_drop
    // module's spawn-blocking wrapper.
    let src = lib_rs_src();
    assert!(
        src.contains("tauri::WindowEvent::DragDrop"),
        "lib.rs should still match WindowEvent::DragDrop somewhere"
    );
    assert!(
        src.contains("commands::drag_drop::spawn_drag_drop_task")
            || src.contains("drag_drop::spawn_drag_drop_task"),
        "lib.rs should delegate drag-drop to commands::drag_drop::spawn_drag_drop_task — \
         keeps the body unit-testable (architect-expert PR #372 M1)"
    );
}

#[test]
fn drag_drop_module_uses_spawn_blocking() {
    // The classification body uses `parse_launch_args` which performs
    // synchronous canonicalize + fs::metadata I/O. PR #372 review by
    // architect-expert (M4), security-expert (H1), and bug-expert (#1)
    // flagged running this on the window-event thread as a UI-freeze
    // hazard for large or slow-filesystem drops. The fix is
    // `tauri::async_runtime::spawn_blocking`. This guard pins the
    // structural choice.
    let src = drag_drop_module_src();
    assert!(
        src.contains("tauri::async_runtime::spawn_blocking")
            || src.contains("async_runtime::spawn_blocking"),
        "commands/drag_drop.rs should wrap the blocking work in \
         tauri::async_runtime::spawn_blocking — running canonicalize + \
         fs::metadata on the window-event thread freezes the UI on slow \
         filesystems / large drops (architect M4, security H1, bug #1)."
    );
}

#[test]
fn drag_drop_module_uses_route_args_to_window() {
    // Drag-drop must route through the **target-aware** variant
    // (`route_args_to_window`) — never the un-targeted
    // `route_args_through_registry`. Otherwise a drop on window B
    // can land in window A just because A appears first in
    // `find_file_only` (architect H1).
    let src = drag_drop_module_src();
    assert!(
        src.contains("route_args_to_window"),
        "commands/drag_drop.rs should call route_args_to_window so \
         the dropped-on window's identity biases the routing decision \
         (architect-expert PR #372 H1)."
    );
    assert!(
        !src.contains("route_args_through_registry"),
        "commands/drag_drop.rs MUST NOT call route_args_through_registry \
         — that variant ignores the dropped-on window (architect H1)."
    );
}

#[test]
fn drag_drop_module_caps_path_count() {
    // A single drop with thousands of paths could pin the
    // spawn_blocking worker for seconds; PR #372 security review (H1)
    // flagged this as a DoS-adjacent surface. The cap belongs in the
    // module before the per-path canonicalize cost.
    let src = drag_drop_module_src();
    assert!(
        src.contains("MAX_DROP_PATHS"),
        "commands/drag_drop.rs should declare a MAX_DROP_PATHS cap so \
         a runaway drop cannot pin the spawn_blocking worker."
    );
}
