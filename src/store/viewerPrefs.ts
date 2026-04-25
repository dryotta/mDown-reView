/**
 * ViewerPrefs slice — per-document, session-only viewer preferences.
 *
 * Owns small per-path maps that gate viewer features which require an explicit
 * user opt-in (e.g. loading remote images in markdown or HTML preview). All
 * state in this slice is intentionally session-only and is NEVER added to the
 * persist `partialize` allowlist (rule 15 in `docs/architecture.md`):
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
  isRemoteImageAllowed: (filePath: string) => boolean;

  /** Per-document HTML preview "allow external images" (foundation for H1). */
  htmlPreviewAllowExternalImages: Record<string, boolean>;
  setHtmlPreviewAllowExternalImages: (filePath: string, allowed: boolean) => void;
}

type SliceSet = StoreApi<Store>["setState"];
type SliceGet = StoreApi<Store>["getState"];

export function createViewerPrefsSlice(set: SliceSet, get: SliceGet): ViewerPrefsSlice {
  return {
    allowedRemoteImageDocs: {},
    allowRemoteImagesForDoc: (filePath) =>
      set((s) => ({
        allowedRemoteImageDocs: { ...s.allowedRemoteImageDocs, [filePath]: true },
      })),
    isRemoteImageAllowed: (filePath) => get().allowedRemoteImageDocs[filePath] === true,

    htmlPreviewAllowExternalImages: {},
    setHtmlPreviewAllowExternalImages: (filePath, allowed) =>
      set((s) => ({
        htmlPreviewAllowExternalImages: {
          ...s.htmlPreviewAllowExternalImages,
          [filePath]: allowed,
        },
      })),
  };
}
