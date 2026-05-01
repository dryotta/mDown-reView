//! Exhaustive routing test for `menu_event_delivery`.
//!
//! Per rule `multiwin-window-scoped-events` in
//! `docs/best-practices-common/tauri/v2-patterns.md`. Tauri 2.x's
//! `WebviewWindow::emit(...)` is a broadcast (verified at
//! `tauri-2.10.3/src/manager/mod.rs::emit` — iterates ALL webviews),
//! so menu events MUST route via explicit `emit_to(...)` (window-scoped)
//! or `app.emit(...)` (intentional broadcast for theme).
//!
//! `menu_event_delivery(action, firing_label)` is the pure mapping that
//! drives `on_menu_event`'s dispatch — every action's frontend event
//! name AND target are pinned here. A future regression that swaps a
//! `MenuEventDelivery::Window(...)` for `::All` (re-introducing the
//! original bug where every window fired the action) trips this test.
//!
//! The structural lint in `src/__tests__/event-emit-target.test.ts`
//! is the second half of the regression guard — it asserts that no
//! `.emit("<window-scoped-event>", ...)` literal appears in non-test
//! Rust source, catching the bug from the call-site direction.

use mdown_review_lib::{menu_event_delivery, MenuEventDelivery};

const FIRING_LABEL: &str = "secondary-window-7";

// ── Window-scoped actions ──────────────────────────────────────────────
//
// These MUST route to the firing window only. A regression to broadcast
// causes every window's listener to fire — the original user-reported
// bug.

#[test]
fn open_file_routes_to_firing_window() {
    assert_eq!(
        menu_event_delivery("open-file", FIRING_LABEL),
        Some(("menu-open-file", MenuEventDelivery::Window(FIRING_LABEL))),
    );
}

#[test]
fn open_folder_routes_to_firing_window() {
    assert_eq!(
        menu_event_delivery("open-folder", FIRING_LABEL),
        Some(("menu-open-folder", MenuEventDelivery::Window(FIRING_LABEL))),
    );
}

#[test]
fn close_folder_routes_to_firing_window() {
    assert_eq!(
        menu_event_delivery("close-folder", FIRING_LABEL),
        Some(("menu-close-folder", MenuEventDelivery::Window(FIRING_LABEL))),
    );
}

#[test]
fn close_tab_routes_to_firing_window() {
    assert_eq!(
        menu_event_delivery("close-tab", FIRING_LABEL),
        Some(("menu-close-tab", MenuEventDelivery::Window(FIRING_LABEL))),
    );
}

#[test]
fn close_all_tabs_routes_to_firing_window() {
    assert_eq!(
        menu_event_delivery("close-all-tabs", FIRING_LABEL),
        Some(("menu-close-all-tabs", MenuEventDelivery::Window(FIRING_LABEL))),
    );
}

#[test]
fn toggle_comments_pane_routes_to_firing_window() {
    assert_eq!(
        menu_event_delivery("toggle-comments-pane", FIRING_LABEL),
        Some((
            "menu-toggle-comments-pane",
            MenuEventDelivery::Window(FIRING_LABEL),
        )),
    );
}

#[test]
fn next_tab_routes_to_firing_window() {
    assert_eq!(
        menu_event_delivery("next-tab", FIRING_LABEL),
        Some(("menu-next-tab", MenuEventDelivery::Window(FIRING_LABEL))),
    );
}

#[test]
fn prev_tab_routes_to_firing_window() {
    assert_eq!(
        menu_event_delivery("prev-tab", FIRING_LABEL),
        Some(("menu-prev-tab", MenuEventDelivery::Window(FIRING_LABEL))),
    );
}

#[test]
fn about_routes_to_firing_window() {
    assert_eq!(
        menu_event_delivery("about", FIRING_LABEL),
        Some(("menu-about", MenuEventDelivery::Window(FIRING_LABEL))),
    );
}

#[test]
fn help_settings_routes_to_firing_window() {
    assert_eq!(
        menu_event_delivery("help-settings", FIRING_LABEL),
        Some(("menu-help-settings", MenuEventDelivery::Window(FIRING_LABEL))),
    );
}

// ── Main-window-only actions ──────────────────────────────────────────

#[test]
fn check_updates_routes_to_main() {
    // The updater backend is process-global and the UpdateBanner only
    // mounts in the main window — so even when a secondary window is
    // the firing label, the event must hit "main".
    assert_eq!(
        menu_event_delivery("check-updates", FIRING_LABEL),
        Some(("menu-check-updates", MenuEventDelivery::Main)),
    );
    // Same answer when fired from main itself.
    assert_eq!(
        menu_event_delivery("check-updates", "main"),
        Some(("menu-check-updates", MenuEventDelivery::Main)),
    );
}

// ── Broadcast actions (intentional) ───────────────────────────────────
//
// Theme is a cross-window preference (see
// `src/hooks/useCrossWindowPrefsSync.ts`). All windows must update
// simultaneously when one of these fires.

#[test]
fn theme_system_broadcasts() {
    assert_eq!(
        menu_event_delivery("theme-system", FIRING_LABEL),
        Some(("menu-theme-system", MenuEventDelivery::All)),
    );
}

#[test]
fn theme_light_broadcasts() {
    assert_eq!(
        menu_event_delivery("theme-light", FIRING_LABEL),
        Some(("menu-theme-light", MenuEventDelivery::All)),
    );
}

#[test]
fn theme_dark_broadcasts() {
    assert_eq!(
        menu_event_delivery("theme-dark", FIRING_LABEL),
        Some(("menu-theme-dark", MenuEventDelivery::All)),
    );
}

// ── Rust-handled / unknown actions ────────────────────────────────────

#[test]
fn rust_handled_actions_return_none() {
    // These are dispatched in `on_menu_event` BEFORE
    // `menu_event_delivery` is consulted (win-minimize / win-bring-all /
    // new-window / toggle-devtools branches). Any frontend event would
    // be wrong; returning None means "don't emit anything".
    for action in ["win-minimize", "win-bring-all", "new-window", "toggle-devtools"] {
        assert_eq!(
            menu_event_delivery(action, FIRING_LABEL),
            None,
            "{action} is Rust-handled and must not produce a frontend event",
        );
    }
}

#[test]
fn unknown_action_returns_none() {
    assert_eq!(menu_event_delivery("totally-made-up", FIRING_LABEL), None);
    assert_eq!(menu_event_delivery("", FIRING_LABEL), None);
}

// ── Cross-cutting invariants ──────────────────────────────────────────

#[test]
fn firing_label_is_threaded_into_window_delivery() {
    // The label string in `MenuEventDelivery::Window(...)` MUST be the
    // firing_label argument verbatim — the original bug was the call
    // site dropping the label and letting `Emitter::emit` broadcast.
    let cases = [
        ("main", "menu-open-file"),
        ("secondary-1", "menu-close-folder"),
        ("aux-9", "menu-help-settings"),
    ];
    for (label, expected_event) in cases {
        let (event, delivery) = menu_event_delivery(
            expected_event.strip_prefix("menu-").unwrap(),
            label,
        )
        .unwrap();
        assert_eq!(event, expected_event);
        match delivery {
            MenuEventDelivery::Window(got) => assert_eq!(got, label),
            other => panic!("expected Window({label}), got {other:?}"),
        }
    }
}
