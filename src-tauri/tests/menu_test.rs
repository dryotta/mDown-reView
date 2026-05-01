//! Integration tests for the menu module: pure routing helper +
//! dispatcher seam.
//!
//! Per rule `multiwin-window-scoped-events` in
//! `docs/best-practices-common/tauri/v2-patterns.md`. The structural
//! lint at `src/__tests__/event-emit-target.test.ts` catches broadcast
//! calls written with a string-literal event name; THESE tests close
//! the variable-shape blind spot by mocking `MenuEmitter` and pinning
//! the call shape (`emit_to(target, event)` vs `broadcast(event)`)
//! that reaches the emitter — independent of how the event-name was
//! computed.

use std::cell::RefCell;

use mdown_review_lib::menu::{
    dispatch_menu_event, menu_event_delivery, MenuEmitter, MenuEventDelivery,
};

const FIRING: &str = "secondary-window-7";

// ── Pure routing table ─────────────────────────────────────────────────

#[test]
fn routing_table_pinned() {
    use MenuEventDelivery::{Broadcast, Targeted};
    let cases: &[(&str, Option<(&'static str, MenuEventDelivery<'_>)>)] = &[
        // Window-scoped (firing window).
        ("open-file", Some(("menu-open-file", Targeted(FIRING)))),
        ("open-folder", Some(("menu-open-folder", Targeted(FIRING)))),
        ("close-folder", Some(("menu-close-folder", Targeted(FIRING)))),
        ("close-tab", Some(("menu-close-tab", Targeted(FIRING)))),
        ("close-all-tabs", Some(("menu-close-all-tabs", Targeted(FIRING)))),
        ("toggle-comments-pane", Some(("menu-toggle-comments-pane", Targeted(FIRING)))),
        ("next-tab", Some(("menu-next-tab", Targeted(FIRING)))),
        ("prev-tab", Some(("menu-prev-tab", Targeted(FIRING)))),
        ("about", Some(("menu-about", Targeted(FIRING)))),
        ("help-settings", Some(("menu-help-settings", Targeted(FIRING)))),
        // Main-only — Targeted("main") regardless of firing window.
        // The "main" literal is justified for the updater backend
        // (process-global; UpdateBanner only mounts in main).
        ("check-updates", Some(("menu-check-updates", Targeted("main")))),
        // Broadcast (cross-window preference).
        ("theme-system", Some(("menu-theme-system", Broadcast))),
        ("theme-light", Some(("menu-theme-light", Broadcast))),
        ("theme-dark", Some(("menu-theme-dark", Broadcast))),
        // Rust-handled — never produce a frontend event.
        ("new-window", None),
        ("win-minimize", None),
        ("win-bring-all", None),
        ("toggle-devtools", None),
        // Unknown.
        ("totally-made-up", None),
        ("", None),
    ];
    for (action, expected) in cases {
        assert_eq!(
            menu_event_delivery(action, FIRING),
            *expected,
            "routing mismatch for action {action:?}",
        );
    }
}

// ── Dispatcher with mock emitter (Bug-1 regression guard) ─────────────

#[derive(Debug, PartialEq, Eq)]
enum Shape {
    Targeted,
    Broadcast,
}

#[derive(Default)]
struct RecordingEmitter {
    calls: RefCell<Vec<(Shape, String, String)>>,
}

impl MenuEmitter for RecordingEmitter {
    fn emit_to(&self, label: &str, event: &str) {
        self.calls
            .borrow_mut()
            .push((Shape::Targeted, label.to_string(), event.to_string()));
    }
    fn broadcast(&self, event: &str) {
        self.calls
            .borrow_mut()
            .push((Shape::Broadcast, String::new(), event.to_string()));
    }
}

#[test]
fn dispatch_window_scoped_action_calls_emit_to_with_firing_label() {
    // BUG-1 REGRESSION GUARD. If the production dispatcher ever
    // collapses to `app.emit(event_name, ())` (broadcast) for a
    // window-scoped action, the recorded shape becomes Broadcast and
    // this test fails — even though the call site uses a variable
    // `event_name` that the string-literal structural lint cannot see.
    let emitter = RecordingEmitter::default();
    let forwarded = dispatch_menu_event(&emitter, "open-file", "w2");
    assert!(forwarded);
    let calls = emitter.calls.borrow();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, Shape::Targeted);
    assert_eq!(calls[0].1, "w2");
    assert_eq!(calls[0].2, "menu-open-file");
}

#[test]
fn dispatch_check_updates_targets_main_regardless_of_firing_window() {
    let emitter = RecordingEmitter::default();
    let forwarded = dispatch_menu_event(&emitter, "check-updates", "secondary-3");
    assert!(forwarded);
    let calls = emitter.calls.borrow();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, Shape::Targeted);
    assert_eq!(calls[0].1, "main");
    assert_eq!(calls[0].2, "menu-check-updates");
}

#[test]
fn dispatch_theme_action_broadcasts_not_emit_to() {
    // The flip side of the bug-1 guard: if the dispatcher wrongly
    // routed theme-* through emit_to(label, …), we'd see Targeted
    // instead of Broadcast. Pin the broadcast shape too.
    let emitter = RecordingEmitter::default();
    let forwarded = dispatch_menu_event(&emitter, "theme-light", "w2");
    assert!(forwarded);
    let calls = emitter.calls.borrow();
    assert_eq!(calls[0].0, Shape::Broadcast);
    assert_eq!(calls[0].2, "menu-theme-light");
}

#[test]
fn dispatch_unknown_action_emits_nothing_and_returns_false() {
    let emitter = RecordingEmitter::default();
    let forwarded = dispatch_menu_event(&emitter, "no-such-action", "w2");
    assert!(!forwarded);
    assert!(emitter.calls.borrow().is_empty());
}
