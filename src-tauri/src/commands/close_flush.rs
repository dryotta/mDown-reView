//! Issue #352 / iter-12 — pre-close flush handshake.
//! Iter-16 — renamed from `excalidraw_close` to `close_flush` and
//! generalised: this is now a primitive any feature can register
//! into via the renderer-side flush registry, not Excalidraw-specific.
//!
//! Bug #4 (data-loss): under autosave-only semantics, edits made within the
//! 2-second debounce window before the user closes the app/window are
//! silently discarded. React's `useEffect` cleanup does NOT run on
//! webview destruction (Tauri tears down the WebView2 / WKWebView host
//! process before any React lifecycle fires), so the renderer's
//! flushAutoSave-on-unmount mechanism only catches tab-close / mode-leave —
//! not window/app close.
//!
//! Solution: Tauri intercepts `WindowEvent::CloseRequested`, prevents the
//! close, emits `flush-before-close` to the closing window, waits up to
//! `CLOSE_FLUSH_TIMEOUT_MS` for the renderer to ack via the
//! `close_flush_complete` IPC, then DESTROYS the window. (Iter-16: use
//! `destroy()` rather than `close()` to definitively bypass any
//! `CloseRequested` re-emission — bug-expert "suspected re-entrant
//! loop" finding.) The renderer hook (`useExcalidrawCloseFlush`) drains
//! every registered flush synchronously upon receiving the event, then
//! fires the ack.
//!
//! **Iter-16 ready gate (bug-expert MEDIUM):** the renderer's hook calls
//! `mark_close_flush_ready()` on first effect commit; until that lands,
//! the close handler does NOT prevent_close — Tauri closes immediately,
//! eliminating the 2.5 s lag for cold-start closes (Alt-F4 fired before
//! React mounts) and for users with no Excalidraw editors open.
//!
//! Race-safe by design: if the renderer becomes unresponsive after
//! marking ready (crashed JS, main-thread block) the timeout fires and
//! we destroy anyway — no prevent-close deadlock. Worst case mirrors the
//! pre-iter-12 behaviour (data loss for the in-debounce edit), so the
//! handshake is a strict improvement.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

use crate::mdr_command;

/// Maximum wait for the renderer's flush ack before forcing destroy.
/// Long enough that a single in-flight workspace-write IPC (worst case
/// ~10 MB binary write to spinning disk) completes; short enough that a
/// crashed JS thread doesn't deadlock the close path.
const CLOSE_FLUSH_TIMEOUT_MS: u64 = 2500;

/// Per-window pending close-flush waiters + ready set. Keyed by window
/// label. Pending entries are inserted by `flush_pending_writes_before_close`,
/// completed by the renderer's `close_flush_complete` IPC. Ready entries
/// are inserted by `mark_close_flush_ready` on hook mount.
pub struct CloseFlushState {
    pending: Mutex<HashMap<String, oneshot::Sender<()>>>,
    /// Iter-16 — windows whose renderer has signalled "I am mounted and
    /// can ack a flush request." Close-handler skips the prevent_close
    /// + ack-wait round-trip for windows NOT in this set, eliminating
    /// the ~2.5 s lag for cold-start close and non-Excalidraw users.
    ready: Mutex<HashSet<String>>,
}

impl CloseFlushState {
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
            ready: Mutex::new(HashSet::new()),
        }
    }

    /// Idempotent — second mark for the same label is a no-op.
    pub fn mark_ready(&self, label: &str) {
        if let Ok(mut set) = self.ready.lock() {
            set.insert(label.to_string());
        }
    }

    /// Called from the `WindowEvent::Destroyed` handler so a window
    /// recycled by the OS doesn't leak a "ready" entry.
    pub fn forget_window(&self, label: &str) {
        if let Ok(mut set) = self.ready.lock() {
            set.remove(label);
        }
        if let Ok(mut map) = self.pending.lock() {
            map.remove(label);
        }
    }

    pub fn is_ready(&self, label: &str) -> bool {
        self.ready
            .lock()
            .map(|s| s.contains(label))
            .unwrap_or(false)
    }
}

impl Default for CloseFlushState {
    fn default() -> Self {
        Self::new()
    }
}

/// Renderer marks itself ready to handle `flush-before-close` requests.
/// Called once from the `useExcalidrawCloseFlush` mount effect. Until
/// this fires, the close handler skips the prevent_close round-trip
/// to avoid the 2.5 s timeout lag for cold-start closes.
#[mdr_command]
pub fn mark_close_flush_ready(
    window: tauri::Window,
    state: tauri::State<'_, CloseFlushState>,
) -> Result<(), String> {
    state.mark_ready(window.label());
    Ok(())
}

/// Renderer-side ack for a close-flush request. Idempotent: a second call
/// (or a call before the request was registered) is a no-op.
#[mdr_command]
pub fn close_flush_complete(
    label: String,
    state: tauri::State<'_, CloseFlushState>,
) -> Result<(), String> {
    let mut map = state
        .pending
        .lock()
        .map_err(|e| format!("close-flush state lock poisoned: {e}"))?;
    if let Some(tx) = map.remove(&label) {
        let _ = tx.send(());
    }
    Ok(())
}

/// Emit the flush request to the closing window and spawn a task that
/// destroys the window after the renderer acks (or after the timeout).
///
/// Caller MUST have already called `api.prevent_close()` on the
/// `CloseRequested` event before invoking this — this function does not
/// own the `CloseRequestedApi`.
///
/// Iter-16: uses `window.destroy()` (not `close()`) to skip
/// `CloseRequested` re-emission entirely, eliminating any potential
/// re-entrant loop hazard.
pub fn flush_pending_writes_before_close(app: &AppHandle, label: String) {
    let Some(state) = app.try_state::<CloseFlushState>() else {
        // State not registered (test harness?) — destroy immediately.
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.destroy();
        }
        return;
    };

    let (tx, rx) = oneshot::channel::<()>();
    {
        let Ok(mut map) = state.pending.lock() else {
            // Lock poisoned — destroy anyway, the user wants out.
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.destroy();
            }
            return;
        };
        // Replace any existing waiter (shouldn't happen but be idempotent).
        map.insert(label.clone(), tx);
    }

    // Emit flush request to the closing window only. The payload echoes
    // the label so the renderer's listener can target the IPC ack at the
    // right key in our pending map.
    let _ = app.emit_to(label.as_str(), "flush-before-close", &label);

    // Spawn the wait-and-destroy task on Tauri's async runtime so the
    // synchronous `on_window_event` callback returns immediately.
    let app_clone = app.clone();
    let label_clone = label.clone();
    tauri::async_runtime::spawn(async move {
        let result = tokio::time::timeout(
            Duration::from_millis(CLOSE_FLUSH_TIMEOUT_MS),
            rx,
        )
        .await;

        // Whether the ack arrived, the channel was dropped, or we timed
        // out, drop the entry and destroy the window. The renderer's
        // IPC ack will be a no-op if the entry is already gone.
        if let Some(state) = app_clone.try_state::<CloseFlushState>() {
            if let Ok(mut map) = state.pending.lock() {
                map.remove(&label_clone);
            }
        }

        match result {
            Ok(Ok(())) => {
                tracing::info!(
                    target: "close-flush",
                    "[close-flush] saves flushed for {label_clone}, destroying"
                );
            }
            Ok(Err(_)) => {
                tracing::warn!(
                    target: "close-flush",
                    "[close-flush] flush channel closed for {label_clone}, destroying"
                );
            }
            Err(_) => {
                tracing::warn!(
                    target: "close-flush",
                    "[close-flush] flush timeout ({CLOSE_FLUSH_TIMEOUT_MS}ms) for {label_clone}, forcing destroy"
                );
            }
        }

        if let Some(window) = app_clone.get_webview_window(&label_clone) {
            let _ = window.destroy();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_flush_state_is_empty_by_default() {
        let state = CloseFlushState::new();
        assert!(state.pending.lock().unwrap().is_empty());
        assert!(state.ready.lock().unwrap().is_empty());
    }

    #[test]
    fn pending_entries_can_be_inserted_and_removed() {
        let state = CloseFlushState::new();
        let (tx, _rx) = oneshot::channel::<()>();
        // Use a synthetic label (not the bootstrap `"main"` literal) so
        // the project-wide forbid-hardcoded-main-label gate stays clean.
        let label = "test-window";
        state
            .pending
            .lock()
            .unwrap()
            .insert(label.to_string(), tx);
        assert_eq!(state.pending.lock().unwrap().len(), 1);
        let removed = state.pending.lock().unwrap().remove(label);
        assert!(removed.is_some());
        assert_eq!(state.pending.lock().unwrap().len(), 0);
    }

    #[test]
    fn mark_ready_is_idempotent() {
        let state = CloseFlushState::new();
        state.mark_ready("test-window");
        state.mark_ready("test-window");
        assert!(state.is_ready("test-window"));
        assert_eq!(state.ready.lock().unwrap().len(), 1);
    }

    #[test]
    fn forget_window_clears_both_maps() {
        let state = CloseFlushState::new();
        state.mark_ready("test-window");
        let (tx, _rx) = oneshot::channel::<()>();
        state.pending.lock().unwrap().insert("test-window".to_string(), tx);
        assert!(state.is_ready("test-window"));
        assert!(!state.pending.lock().unwrap().is_empty());
        state.forget_window("test-window");
        assert!(!state.is_ready("test-window"));
        assert!(state.pending.lock().unwrap().is_empty());
    }

    #[test]
    fn is_ready_false_for_unmarked_windows() {
        let state = CloseFlushState::new();
        assert!(!state.is_ready("never-marked"));
    }
}
