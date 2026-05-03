import { useEffect } from "react";

import { listenEvent } from "@/lib/tauri-events";
import { useStore } from "@/store";
import { error as logError, debug as logDebug } from "@/logger";

/**
 * Issue #352 / iter-15 — multi-window file singleton (focus-existing).
 *
 * Mounted at the App root (one listener per webview). When another
 * window tries to open a file that THIS window already owns, Rust's
 * `claim_open_file` raises this window via `focus_window`
 * (un-minimize → show → set-focus) and emits `focus-tab` with the
 * path payload. We respond by selecting the corresponding tab so
 * the user sees the file the duplicate-open targeted.
 *
 * Multi-window safety: `listenEvent` registers with target =
 * `WebviewWindow{label: currentLabel}`, so each window only receives
 * its own focus requests. Cross-window emission is enforced by
 * Rust's `app.emit_to(label, …)`.
 */
export function useFocusTab(): void {
  useEffect(() => {
    const unlisten = listenEvent("focus-tab", (path) => {
      void logDebug(`[focus-tab] selecting tab path=${path}`);
      const state = useStore.getState();
      // Defensive: if the path isn't actually open in this window the
      // payload is stale (rare race — registry purge mid-flight).
      // Don't add a tab here; just no-op so the user isn't surprised.
      if (!state.tabs.some((t) => t.path === path)) {
        void logDebug(
          `[focus-tab] path=${path} not in this window's tabs; ignoring`,
        );
        return;
      }
      state.setActiveTab(path);
    });
    return () => {
      void unlisten
        .then((fn) => fn())
        .catch((err: unknown) => {
          void logError(
            `[focus-tab] unlisten failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
    };
  }, []);
}
