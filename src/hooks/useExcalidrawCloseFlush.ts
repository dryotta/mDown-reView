import { useEffect } from "react";

import { excalidrawCloseFlushComplete } from "@/lib/tauri-commands";
import { listenEvent } from "@/lib/tauri-events";
import { flushAllPendingExcalidrawSaves } from "@/lib/excalidraw/flush-registry";
import { error as logError, debug as logDebug } from "@/logger";

/**
 * Issue #352 / iter-12 — Excalidraw close-flush handshake (data-loss
 * bug #4).
 *
 * Tauri's `WindowEvent::CloseRequested` fires synchronously and tears
 * down the WebView host process; React's `useEffect` cleanup does NOT
 * run, so the per-`<ExcalidrawView>` `flushAutoSave-on-unmount` never
 * fires for app close / Alt-F4. Without this hook, edits made within
 * the 2-second autosave debounce window are silently lost on every
 * app close — confirmed in the iter-12 bug review.
 *
 * Handshake (lock-step with `src-tauri/src/commands/excalidraw_close.rs`):
 *   1. User clicks close (or presses Alt-F4 / Cmd-Q / window X).
 *   2. Rust intercepts `CloseRequested`, calls `api.prevent_close()`,
 *      emits `excalidraw-flush-before-close` to THIS window.
 *   3. This hook receives the event, drains every flush in
 *      `flush-registry.ts` via `Promise.all` (failures swallowed —
 *      best-effort on close).
 *   4. Hook calls `excalidraw_close_flush_complete(label)` IPC.
 *   5. Rust sees the ack, drops the entry, calls `window.close()`.
 *   6. If the renderer is unresponsive, Rust's 2.5 s timeout fires
 *      and the window closes anyway (data loss in worst case mirrors
 *      pre-iter-12 behaviour, never worse).
 *
 * Mounted at the App root (called once per webview); no
 * Excalidraw-specific imports here so the lazy boundary stays intact.
 *
 * Multi-window safety: `listenEvent` registers with target =
 * `WebviewWindow{label = currentLabel}`, so each window's hook only
 * receives its own close request — closing window A doesn't drain
 * window B's pending saves.
 */
export function useExcalidrawCloseFlush(): void {
  useEffect(() => {
    const unlisten = listenEvent("excalidraw-flush-before-close", (label) => {
      void (async () => {
        try {
          void logDebug(
            `[excalidraw-close] flush requested for window=${label}`,
          );
          await flushAllPendingExcalidrawSaves();
        } catch (err: unknown) {
          // flushAllPendingExcalidrawSaves already swallows individual
          // failures; this catch is for the framework error case.
          void logError(
            `[excalidraw-close] drain failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        try {
          await excalidrawCloseFlushComplete(label);
        } catch (err: unknown) {
          // IPC failure shouldn't block the close — Rust's 2.5 s
          // timeout will fire and close the window anyway.
          void logError(
            `[excalidraw-close] ack IPC failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      })();
    });
    return () => {
      void unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);
}
