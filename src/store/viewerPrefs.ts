/**
 * ViewerPrefs slice — per-document, session-only viewer preferences.
 *
 * Owns small per-path maps that gate viewer features which require an explicit
 * user opt-in (e.g. loading remote images in markdown). All state in this
 * slice is intentionally session-only and is NEVER added to the persist
 * `partialize` allowlist (rule 15 in `docs/architecture.md`):
 *   - Trust decisions should not silently survive an app restart.
 *   - Maps grow per-document and would bloat the persisted snapshot.
 *
 * Composed into the combined store in `src/store/index.ts`. Follows the
 * extraction pattern of `src/store/tabs.ts`.
 */
import type { StoreApi } from "zustand";
import type { Store } from "./index";

export interface ViewerPrefsSlice {
  /** Per-document remote-image allowance (markdown viewer — A1). */
  allowedRemoteImageDocs: Record<string, boolean>;
  allowRemoteImagesForDoc: (filePath: string) => void;
}

type SliceSet = StoreApi<Store>["setState"];

export function createViewerPrefsSlice(set: SliceSet): ViewerPrefsSlice {
  return {
    allowedRemoteImageDocs: {},
    allowRemoteImagesForDoc: (filePath) =>
      set((s) => ({
        allowedRemoteImageDocs: { ...s.allowedRemoteImageDocs, [filePath]: true },
      })),
  };
}

