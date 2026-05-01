/**
 * MermaidPopout slice — overlay state for the mermaid pop-out viewer.
 *
 * Extracted to its own file to keep `src/store/index.ts` under the 500-line
 * shared-chokepoint budget (rule 23 in `docs/architecture.md`). Mirrors the
 * extraction pattern of `src/store/viewerPrefs.ts` and `src/store/tabs.ts`.
 *
 * Persistence: NEVER persisted (rule 15). The popout is transient UI state —
 * an overlay open/closed toggle plus the source content currently shown. It
 * has no business reason to survive an app restart and would bloat the
 * persisted snapshot.
 *
 * Close-on-context-change: this slice is closed by store actions that change
 * app context — `setRoot`, `closeFolder`, `toggleCommentsPane` (in
 * `./index.ts`); `openFile`, `closeTab`, `closeAllTabs`, `setActiveTab` (in
 * `./tabs.ts`). The popout component itself only subscribes to Esc keydown
 * for additional close. Cross-slice action grouping per architecture rule 16.
 */
import type { StoreApi } from "zustand";
import type { Store } from "./index";

export interface MermaidPopoutSlice {
  /** Non-null when the mermaid popout overlay is mounted. NEVER persisted. */
  mermaidPopoutOpenFor: { content: string; path: string | null } | null;
  /** Open the popout with the given mermaid source. `path` is the dedicated-viewer file path, or null for embedded blocks. */
  openMermaidPopout: (content: string, path?: string | null) => void;
  /** Close the popout. Idempotent. */
  closeMermaidPopout: () => void;
}

type SliceSet = StoreApi<Store>["setState"];
type SliceGet = StoreApi<Store>["getState"];

export function createMermaidPopoutSlice(set: SliceSet, _get: SliceGet): MermaidPopoutSlice {
  return {
    mermaidPopoutOpenFor: null,
    openMermaidPopout: (content, path = null) =>
      set({ mermaidPopoutOpenFor: { content, path } }),
    closeMermaidPopout: () =>
      set((s) => (s.mermaidPopoutOpenFor === null ? s : { mermaidPopoutOpenFor: null })),
  };
}
