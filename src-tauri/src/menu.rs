//! Custom menu event routing.
//!
//! Per rule `multiwin-window-scoped-events` in
//! `.claude/agents/tauri-coding-expert/knowledge/tauri-v2-patterns.md`: Tauri's
//! `Emitter::emit` is a global broadcast regardless of receiver
//! (`AppManager::emit` iterates every webview). To scope delivery to
//! one window we MUST call `emit_to(label, …)`.
//!
//! This module is the single source of truth for menu-action →
//! frontend-event routing. `dispatch_menu_event` is the seam that
//! integration tests mock to prove the routing actually calls
//! `emit_to(...)` for window-scoped events (closing the call-site
//! coverage gap that a string-literal lint cannot fill).

use tauri::{AppHandle, Emitter, Runtime};

/// Where a frontend menu event must be delivered.
#[derive(Debug, PartialEq, Eq)]
pub enum MenuEventDelivery<'a> {
    /// Deliver to exactly one window by label (`emit_to(label, …)`).
    /// Used for both per-window actions (firing window) and the
    /// `"main"`-only updater action — the call site supplies the
    /// label, and `MenuEventDelivery` does not need to distinguish.
    Targeted(&'a str),
    /// Broadcast to every window (`app.emit(…)`). Reserved for
    /// genuinely cross-window state changes — currently theme-*.
    Broadcast,
}

/// Map a custom-menu action to its frontend event name and delivery
/// target. Pure function — exhaustively table-tested.
///
/// Returns `None` for actions that are handled in Rust
/// (`new-window`, `win-minimize`, `win-bring-all`, `toggle-devtools`)
/// and never forwarded to the frontend.
pub fn menu_event_delivery<'a>(
    action: &str,
    firing_label: &'a str,
) -> Option<(&'static str, MenuEventDelivery<'a>)> {
    let event_name: &'static str = match action {
        "open-file" => "menu-open-file",
        "open-folder" => "menu-open-folder",
        "close-folder" => "menu-close-folder",
        "close-tab" => "menu-close-tab",
        "close-all-tabs" => "menu-close-all-tabs",
        "toggle-comments-pane" => "menu-toggle-comments-pane",
        "next-tab" => "menu-next-tab",
        "prev-tab" => "menu-prev-tab",
        "theme-system" => "menu-theme-system",
        "theme-light" => "menu-theme-light",
        "theme-dark" => "menu-theme-dark",
        "about" => "menu-about",
        "check-updates" => "menu-check-updates",
        "help-settings" => "menu-help-settings",
        _ => return None,
    };
    let delivery = match event_name {
        "menu-theme-system" | "menu-theme-light" | "menu-theme-dark" => {
            MenuEventDelivery::Broadcast
        }
        "menu-check-updates" => MenuEventDelivery::Targeted("main"),
        _ => MenuEventDelivery::Targeted(firing_label),
    };
    Some((event_name, delivery))
}

/// Trait abstraction over the two emit shapes used by menu dispatch.
///
/// The production impl on `AppHandle` calls `Emitter::emit_to` and
/// `Emitter::emit`; integration tests provide a mock that records the
/// `(label, event_name)` tuple per call so a regression that types
/// `app.emit(event_name, ())` instead of `emit_to(target, event_name, ())`
/// is observable as a wrong record (and a failing test) rather than
/// a silent broadcast at runtime.
pub trait MenuEmitter {
    /// Window-scoped delivery (`emit_to(label, event, ())`).
    fn emit_to(&self, label: &str, event: &str);
    /// Cross-window broadcast (`emit(event, ())`).
    fn broadcast(&self, event: &str);
}

impl<R: Runtime> MenuEmitter for AppHandle<R> {
    fn emit_to(&self, label: &str, event: &str) {
        let _ = Emitter::emit_to(self, label, event, ());
    }
    fn broadcast(&self, event: &str) {
        let _ = Emitter::emit(self, event, ());
    }
}

/// Dispatch a menu action through the supplied emitter.
///
/// Returns `true` if the action was forwarded to the frontend (any
/// known forwarded action), `false` otherwise (Rust-handled or
/// unknown). Callers in `lib.rs::on_menu_event` short-circuit
/// Rust-handled actions BEFORE calling this dispatcher, so the
/// `false` return is exclusively the unknown-action path.
pub fn dispatch_menu_event<E: MenuEmitter>(
    emitter: &E,
    action: &str,
    firing_label: &str,
) -> bool {
    let Some((event_name, delivery)) = menu_event_delivery(action, firing_label) else {
        log::info!(
            "[menu] dispatch action={action:?} firing-label={firing_label:?} \
             delivery=none (rust-handled or unknown)"
        );
        return false;
    };
    match delivery {
        MenuEventDelivery::Targeted(target) => {
            log::info!(
                "[menu] dispatch action={action:?} firing-label={firing_label:?} \
                 event={event_name:?} delivery=emit_to(target={target:?})"
            );
            emitter.emit_to(target, event_name);
        }
        MenuEventDelivery::Broadcast => {
            log::info!(
                "[menu] dispatch action={action:?} firing-label={firing_label:?} \
                 event={event_name:?} delivery=broadcast"
            );
            emitter.broadcast(event_name);
        }
    }
    true
}

// Tests live in `src-tauri/tests/menu_test.rs` (integration test) so
// the per-line `"main"` literal forbidden-pattern lint does not need
// to allowlist test fixtures.
