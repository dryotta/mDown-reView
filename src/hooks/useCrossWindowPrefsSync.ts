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

        // Apply only the keys that `partialize` persists (global prefs).
        // Per-window state (tabs, expandedFolders, root…) is never touched.
        useStore.setState({
          ...(state.theme !== undefined && { theme: state.theme }),
          ...(state.authorName !== undefined && {
            authorName: state.authorName,
          }),
          ...(state.recentItems !== undefined && {
            recentItems: state.recentItems,
          }),
          ...(state.updateChannel !== undefined && {
            updateChannel: state.updateChannel,
          }),
          ...(state.readingWidth !== undefined && {
            readingWidth: state.readingWidth,
          }),
          ...(state.folderPaneWidth !== undefined && {
            folderPaneWidth: state.folderPaneWidth,
          }),
          ...(state.commentsPaneVisible !== undefined && {
            commentsPaneVisible: state.commentsPaneVisible,
          }),
          ...(state.zoomByFiletype !== undefined && {
            zoomByFiletype: state.zoomByFiletype,
          }),
        });
      } catch {
        // Malformed storage value — ignore silently.
      }
    };

    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);
}
