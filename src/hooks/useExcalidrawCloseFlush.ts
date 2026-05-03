import { useEffect } from "react";

import { closeFlushComplete, markCloseFlushReady } from "@/lib/tauri-commands";
import { listenEvent } from "@/lib/tauri-events";
import { flushAllPendingExcalidrawSaves } from "@/lib/excalidraw/flush-registry";
import { error as logError, debug as logDebug } from "@/logger";

/**
 * Issue #352 / iter-12  pre-close flush handshake (data-loss bug #4).
 * Iter-16  generalised + ready-gated (bug-expert MEDIUM):
 *
 * Tauri's `WindowEvent::CloseRequested` fires synchronously and tears
 * down the WebView host process; React's `useEffect` cleanup does NOT
 * run, so the per-`<ExcalidrawView>` `flushAutoSave-on-unmount` never
 * fires for app close / Alt-F4. Without this hook, edits made within
 * the 2-second autosave debounce window are silently lost on every
 * app close  confirmed in the iter-12 bug review.
 *
 * **Iter-16 ready gate.** This hook calls `markCloseFlushReady()` on
 * first effect commit. Until that lands, Rust''s CloseRequested handler
 * does NOT prevent_close  Tauri closes immediately. Eliminates the
 * 2.5 s lag bug-expert flagged for cold-start closes (Alt-F4 fired
 * before React mounts) and for users with no Excalidraw editors open
 * (the registry is empty so the wait is wasted anyway).
 *
 * Handshake (lock-step with `src-tauri/src/commands/close_flush.rs`):
 *   1. User clicks close (or presses Alt-F4 / Cmd-Q / window X).
 *   2. Rust intercepts `CloseRequested`. If the window is NOT marked
 *      ready, Rust lets the close proceed normally  no handshake.
 *   3. If ready: Rust calls `api.prevent_close()`, emits
 *      `flush-before-close` to THIS window.
 *   4. This hook receives the event, drains every flush in
 *      `flush-registry.ts` via `Promise.all` (failures swallowed 
 *      best-effort on close).
 *   5. Hook calls `closeFlushComplete(label)` IPC.
 *   6. Rust sees the ack, drops the entry, calls `window.destroy()`
 *      (iter-16  destroy() rather than close() to bypass any
 *      CloseRequested re-entry hazard).
 *   7. If the renderer is unresponsive, Rust''s 2.5 s timeout fires
 *      and the window is destroyed anyway (data loss in worst case
 *      mirrors pre-iter-12 behaviour, never worse).
 *
 * Mounted at the App root (called once per webview); no
 * Excalidraw-specific imports here so the lazy boundary stays intact.
 *
 * Multi-window safety: `listenEvent` registers with target =
 * `WebviewWindow{label = currentLabel}`, so each window''s hook only
 * receives its own close request  closing window A doesn''t drain
 * window B''s pending saves.
 */
export function useExcalidrawCloseFlush(): void {
  useEffect(() => {
    void markCloseFlushReady().catch((err: unknown) => {
      void logError(
        `[close-flush] markCloseFlushReady failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });

    const unlisten = listenEvent("flush-before-close", (label) => {
      void (async () => {
        try {
          void logDebug(
            `[close-flush] flush requested for window=${label}`,
          );
          await flushAllPendingExcalidrawSaves();
        } catch (err: unknown) {
          void logError(
            `[close-flush] drain failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        try {
          await closeFlushComplete(label);
        } catch (err: unknown) {
          void logError(
            `[close-flush] ack IPC failed: ${
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
