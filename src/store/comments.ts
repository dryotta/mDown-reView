/**
 * Comments slice — transient UI state for comment review flow.
 *
 * Owns non-persisted UI state:
 *   - `focusedThreadId` — the thread keyboard shortcuts target.
 *   - `pendingScrollTarget` — cross-file scroll queued by CommentsPanel.
 *   - `activeViewerContextMenu` — viewer-registered context-menu opener.
 */
import type { StoreApi } from "zustand";
import type { Store } from "./index";

/**
 * Iter 10 Group B — cross-file scroll target queued by `CommentsPanel` when
 * the user clicks a workspace-wide row whose source file is not yet mounted.
 * The destination viewer's `useScrollToLine` hook consumes the target on
 * mount via `consumePendingScrollTarget(filePath)`, which atomically clears
 * the field iff the queued `filePath` matches. This replaces the iter 9
 * `requestAnimationFrame×2 + setTimeout(0)` hack (B4 forward-fix).
 *
 * Rapid clicks supersede earlier targets because each `set` overwrites the
 * field — the field itself is the supersession primitive (no nonce needed).
 */
export interface PendingScrollTarget {
  filePath: string;
  line: number;
  commentId?: string;
}

/** F6 — viewer-registered "open context menu at (x,y)" callback.
 *  The active commentable viewer registers its handler on mount and clears
 *  it on unmount so the global Shift+F10 / ContextMenu key shortcut can
 *  drive the same code path as a real right-click. Replaces the iter 11
 *  synthetic `dispatchEvent("contextmenu")` hack, which never reached the
 *  viewer because `document.activeElement` was rarely the viewer body. */
export type OpenContextMenuFn = (x: number, y: number) => void;

export interface CommentsSlice {
  focusedThreadId: string | null;
  pendingScrollTarget: PendingScrollTarget | null;
  /** F6 — registered by the active commentable viewer; null when no
   *  commentable viewer is mounted (so the shortcut is a clean no-op). */
  activeViewerContextMenu: OpenContextMenuFn | null;

  setFocusedThread: (id: string | null) => void;
  setPendingScrollTarget: (target: PendingScrollTarget | null) => void;
  consumePendingScrollTarget: (
    filePath: string,
  ) => { line: number; commentId?: string } | null;
  setActiveViewerContextMenu: (fn: OpenContextMenuFn | null) => void;
}

type SliceSet = StoreApi<Store>["setState"];
type SliceGet = StoreApi<Store>["getState"];

export function createCommentsSlice(
  set: SliceSet,
  get: SliceGet,
): CommentsSlice {
  return {
    focusedThreadId: null,
    pendingScrollTarget: null,
    activeViewerContextMenu: null,

    setFocusedThread: (id) => set({ focusedThreadId: id }),
    setActiveViewerContextMenu: (fn) => set({ activeViewerContextMenu: fn }),

    setPendingScrollTarget: (target) => {
      set({ pendingScrollTarget: target });
    },

    consumePendingScrollTarget: (filePath) => {
      const t = get().pendingScrollTarget;
      if (!t || t.filePath !== filePath) return null;
      set({ pendingScrollTarget: null });
      return { line: t.line, commentId: t.commentId };
    },
  };
}

