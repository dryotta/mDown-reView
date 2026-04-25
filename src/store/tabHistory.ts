/**
 * TabHistory slice — per-window back/forward navigation history.
 *
 * Owns a single bounded ring buffer of paths (cap 50) plus a cursor. The
 * current tab is `history[historyIndex]`. `pushHistory(path)` is called by
 * sites that intentionally navigate to a tab (link clicks in
 * `MarkdownViewer`, manual tab clicks in `TabBar`); `back()` / `forward()`
 * move the cursor and return the target path so the caller can drive
 * `setActiveTab` — they intentionally do NOT push, so navigation does not
 * scribble over forward history.
 *
 * Pushing a new path while not at the head truncates forward history (browser
 * semantics). Re-pushing the current head is a no-op.
 *
 * Session-only — never added to the persist `partialize` allowlist (rule 15
 * in `docs/architecture.md`): history should not silently survive an app
 * restart and the buffer would bloat the persisted snapshot.
 */
import type { StoreApi } from "zustand";
import type { Store } from "./index";

/** Maximum number of entries kept in the history ring buffer. */
export const MAX_TAB_HISTORY = 50;

export interface TabHistorySlice {
  history: string[];
  historyIndex: number;
  pushHistory: (path: string) => void;
  back: () => string | null;
  forward: () => string | null;
}

type SliceSet = StoreApi<Store>["setState"];
type SliceGet = StoreApi<Store>["getState"];

export function createTabHistorySlice(set: SliceSet, get: SliceGet): TabHistorySlice {
  return {
    history: [],
    historyIndex: -1,

    pushHistory: (path) => {
      const { history, historyIndex } = get();
      // No-op when re-pushing the current head (e.g. clicking the already-active tab).
      if (historyIndex >= 0 && history[historyIndex] === path) return;
      // Truncate forward history, then append.
      let next = history.slice(0, historyIndex + 1);
      next.push(path);
      // Cap to MAX_TAB_HISTORY by dropping oldest entries.
      let nextIndex = next.length - 1;
      if (next.length > MAX_TAB_HISTORY) {
        const drop = next.length - MAX_TAB_HISTORY;
        next = next.slice(drop);
        nextIndex = next.length - 1;
      }
      set({ history: next, historyIndex: nextIndex });
    },

    back: () => {
      const { history, historyIndex } = get();
      if (historyIndex <= 0) return null;
      const nextIndex = historyIndex - 1;
      set({ historyIndex: nextIndex });
      return history[nextIndex];
    },

    forward: () => {
      const { history, historyIndex } = get();
      if (historyIndex < 0 || historyIndex >= history.length - 1) return null;
      const nextIndex = historyIndex + 1;
      set({ historyIndex: nextIndex });
      return history[nextIndex];
    },
  };
}
