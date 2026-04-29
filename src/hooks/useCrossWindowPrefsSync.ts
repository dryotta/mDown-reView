import { useEffect } from "react";
import { useStore } from "@/store";

/** localStorage key used by Zustand persist middleware. */
const PERSIST_KEY = "mdownreview-ui";

/**
 * Listens for localStorage changes from other windows and rehydrates
 * the store's persisted (global prefs) state.  The browser `storage`
 * event fires in *other* windows sharing the same origin when
 * `localStorage.setItem` is called, so any prefs change made in one
 * window (theme, author, recents …) propagates live to every other
 * open window without IPC.
 *
 * **Equality guard:** each incoming field is compared to its current
 * value before being included in the `setState` patch.  Without this,
 * every `setState` call triggers the persist middleware to write ALL
 * partialize'd fields (including per-window ones like `folderPaneWidth`)
 * back to localStorage, which fires a `storage` event in the *other*
 * window, creating an infinite ping-pong loop.
 */
export function useCrossWindowPrefsSync(): void {
  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (event.key !== PERSIST_KEY) return;
      if (!event.newValue) return;

      try {
        const parsed = JSON.parse(event.newValue);
        const state = parsed?.state;
        if (!state) return;

        // Apply only global prefs — NOT per-window layout state.
        // folderPaneWidth, commentsPaneVisible are persisted as defaults
        // for new windows but never synced cross-window (issue #248).
        // showSidecarFiles is per-window AND not persisted — every fresh
        // window starts with the toggle OFF.
        // zoomByFiletype is session-only (not persisted or synced).
        //
        // Equality guard: only include fields whose value actually changed to
        // avoid a persist → storage-event → persist ping-pong between windows.
        const cur = useStore.getState();
        const patch: Record<string, unknown> = {};

        if (state.theme !== undefined && state.theme !== cur.theme) {
          patch.theme = state.theme;
        }
        if (state.authorName !== undefined && state.authorName !== cur.authorName) {
          patch.authorName = state.authorName;
        }
        if (state.updateChannel !== undefined && state.updateChannel !== cur.updateChannel) {
          patch.updateChannel = state.updateChannel;
        }
        if (state.readingWidth !== undefined && state.readingWidth !== cur.readingWidth) {
          patch.readingWidth = state.readingWidth;
        }
        if (state.recentItems !== undefined &&
            JSON.stringify(state.recentItems) !== JSON.stringify(cur.recentItems)) {
          patch.recentItems = state.recentItems;
        }

        if (Object.keys(patch).length > 0) {
          useStore.setState(patch);
        }
      } catch {
        // Malformed storage value — ignore silently.
      }
    };

    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);
}
