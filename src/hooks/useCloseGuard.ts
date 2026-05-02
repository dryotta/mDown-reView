/**
 * Issue #352 / iter-9 user-reported BUG#1 — window-close confirm guard.
 *
 * The tab-close (×), Ctrl+W, and File ▸ Close menu paths all route
 * through `closeTab()` in `src/store/tabs.ts`, which prompts before
 * discarding unsaved Excalidraw edits. The window-close path
 * (window `×` button, Alt+F4, Cmd+Q on macOS) bypasses `closeTab()`
 * entirely — Tauri fires `WindowEvent::CloseRequested` and the
 * webview process is torn down without giving the user a chance to
 * save.
 *
 * Fix: register a frontend-side `onCloseRequested` listener that
 * counts dirty Excalidraw editor tabs and prompts via the same
 * `window.confirm` path used elsewhere. If the user cancels, call
 * `event.preventDefault()` so Tauri keeps the window open.
 *
 * Why frontend-only: the dirty state lives in the Zustand store,
 * which Rust has no direct access to. Bouncing through an IPC
 * (Rust → frontend prompt → frontend → Rust allow/prevent) would
 * add latency and a round-trip; the JS API supports async handlers
 * with `event.preventDefault()` natively.
 *
 * The handler is registered ONCE on first mount of the hook; the
 * unlisten Promise is awaited on cleanup to release the listener.
 * Errors from `getCurrentWebviewWindow()` (e.g. headless test
 * environments without `__TAURI_INTERNALS__`) are swallowed — the
 * guard is best-effort and must NEVER break app startup if the
 * Tauri host is unavailable.
 */
import { useEffect } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import { useStore } from "@/store";
import { warn as logWarn } from "@/logger";

export function useCloseGuard(): void {
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    const register = async (): Promise<void> => {
      try {
        const win = getCurrentWebviewWindow();
        const fn = await win.onCloseRequested((event) => {
          // Count tabs that are dirty Excalidraw editors. Reading the
          // store inside the handler (not in a closure) ensures we see
          // the LIVE state at close time, not a stale snapshot from
          // hook-mount.
          const { excalidrawDirtyByTab, viewModeByTab } = useStore.getState();
          const dirtyCount = Object.entries(excalidrawDirtyByTab).filter(
            ([path, dirty]) =>
              dirty === true && viewModeByTab[path] === "editor",
          ).length;
          if (dirtyCount === 0) return;
          // `confirmDiscard` semantics: identical wording to closeTab /
          // closeAllTabs / setActiveTab so the user sees one consistent
          // prompt across every close path.
          const message =
            dirtyCount > 1
              ? `Discard changes to ${dirtyCount} files?`
              : "Discard changes?";
          if (typeof globalThis.confirm !== "function") {
            // Fail-closed in headless contexts — don't silently destroy
            // unsaved work just because the host can't prompt.
            event.preventDefault();
            return;
          }
          if (!globalThis.confirm(message)) {
            event.preventDefault();
          }
        });
        if (cancelled) {
          // Hook unmounted between resolve and now — release the listener.
          fn();
        } else {
          unlisten = fn;
        }
      } catch (err: unknown) {
        // Tauri host unavailable (e.g. browser-E2E without
        // __TAURI_INTERNALS__). Swallow — the guard is best-effort.
        const msg = err instanceof Error ? err.message : String(err);
        void logWarn(`[close-guard] onCloseRequested registration failed: ${msg}`);
      }
    };

    void register();

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
        unlisten = null;
      }
    };
  }, []);
}
