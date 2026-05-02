//! Issue #352 / iter-12 — Excalidraw close-flush handshake.
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
//! close, emits `excalidraw-flush-before-close` to the closing window,
//! waits up to `CLOSE_FLUSH_TIMEOUT_MS` for the renderer to ack via the
//! `excalidraw_close_flush_complete` IPC, then closes the window. The
//! renderer hook (`useExcalidrawCloseFlush`) drains all pending Excalidraw
//! flushes synchronously upon receiving the event, then fires the ack.
//!
//! Race-safe by design: if the renderer is unresponsive (crashed JS,
//! main-thread block) the timeout fires and we close anyway — no
//! prevent-close deadlock. Worst case mirrors the pre-iter-12 behaviour
//! (data loss for the in-debounce edit), so the handshake is a strict
//! improvement.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

use crate::mdr_command;

/// Maximum wait for the renderer's flush ack before forcing close.
/// Long enough that a single in-flight workspace-write IPC (worst case
/// ~10 MB binary write to spinning disk) completes; short enough that a
/// crashed JS thread doesn't deadlock the close path.
const CLOSE_FLUSH_TIMEOUT_MS: u64 = 2500;

/// Per-window pending close-flush waiters. Keyed by window label.
/// Inserted by `flush_excalidraw_before_close`, completed by the
/// renderer's `excalidraw_close_flush_complete` IPC.
pub struct ExcalidrawCloseFlushState {
    pending: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

impl ExcalidrawCloseFlushState {
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for ExcalidrawCloseFlushState {
    fn default() -> Self {
        Self::new()
    }
}

/// Renderer-side ack for a close-flush request. Idempotent: a second call
/// (or a call before the request was registered) is a no-op.
#[mdr_command]
pub fn excalidraw_close_flush_complete(
    label: String,
    state: tauri::State<'_, ExcalidrawCloseFlushState>,
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
/// closes the window after the renderer acks (or after the timeout).
///
/// Caller MUST have already called `api.prevent_close()` on the
/// `CloseRequested` event before invoking this — this function does not
/// own the `CloseRequestedApi`.
pub fn flush_excalidraw_before_close(app: &AppHandle, label: String) {
    let Some(state) = app.try_state::<ExcalidrawCloseFlushState>() else {
        // State not registered (test harness?) — close immediately.
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.close();
        }
        return;
    };

    let (tx, rx) = oneshot::channel::<()>();
    {
        let Ok(mut map) = state.pending.lock() else {
            // Lock poisoned — close anyway, the user wants out.
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.close();
            }
            return;
        };
        // Replace any existing waiter (shouldn't happen but be idempotent).
        map.insert(label.clone(), tx);
    }

    // Emit flush request to the closing window only. The payload echoes
    // the label so the renderer's listener can target the IPC ack at the
    // right key in our pending map.
    let _ = app.emit_to(label.as_str(), "excalidraw-flush-before-close", &label);

    // Spawn the wait-and-close task on Tauri's async runtime so the
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
        // out, drop the entry and close the window. The renderer's IPC
        // ack will be a no-op if the entry is already gone.
        if let Some(state) = app_clone.try_state::<ExcalidrawCloseFlushState>() {
            if let Ok(mut map) = state.pending.lock() {
                map.remove(&label_clone);
            }
        }

        match result {
            Ok(Ok(())) => {
                tracing::info!(
                    target: "excalidraw-close",
                    "[excalidraw-close] saves flushed for {label_clone}, closing"
                );
            }
            Ok(Err(_)) => {
                tracing::warn!(
                    target: "excalidraw-close",
                    "[excalidraw-close] flush channel closed for {label_clone}, closing"
                );
            }
            Err(_) => {
                tracing::warn!(
                    target: "excalidraw-close",
                    "[excalidraw-close] flush timeout ({CLOSE_FLUSH_TIMEOUT_MS}ms) for {label_clone}, forcing close"
                );
            }
        }

        if let Some(window) = app_clone.get_webview_window(&label_clone) {
            let _ = window.close();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_flush_state_is_empty_by_default() {
        let state = ExcalidrawCloseFlushState::new();
        let map = state.pending.lock().unwrap();
        assert!(map.is_empty());
    }

    #[test]
    fn pending_entries_can_be_inserted_and_removed() {
        let state = ExcalidrawCloseFlushState::new();
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
}
