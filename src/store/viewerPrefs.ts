/**
 * ViewerPrefs slice — per-document and per-filetype viewer preferences.
 *
 * Holds two kinds of state with deliberately different persistence policies:
 *
 *   1. `allowedRemoteImageDocs` — per-document remote-image trust (markdown
 *      A1). NEVER persisted: trust decisions must not silently survive an
 *      app restart, and the per-path map would bloat the persisted snapshot.
 *
 *   2. `zoomByFiletype` — per-filetype zoom level (#65 D1/D2/D3). PERSISTED
 *      via the `partialize` allowlist in `src/store/index.ts`. Bounded to a
 *      handful of small numeric entries (one per filetype key, ~10 max), so
 *      it does not bloat persistence.
 *
 * Composed into the combined store in `src/store/index.ts`. Follows the
 * extraction pattern of `src/store/tabs.ts`.
 */
import type { StoreApi } from "zustand";
import type { Store } from "./index";

/** Zoom clamp range — 25% .. 800%. */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 8.0;
/** Multiplicative zoom step (×1.1 in, ÷1.1 out). */
export const ZOOM_STEP = 1.1;
/** Default zoom level (100%). */
export const ZOOM_DEFAULT = 1.0;

function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return ZOOM_DEFAULT;
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
}

export interface ViewerPrefsSlice {
  /** Per-document remote-image allowance (markdown viewer — A1). Session-only. */
  allowedRemoteImageDocs: Record<string, boolean>;
  allowRemoteImagesForDoc: (filePath: string) => void;
  /** Per-filetype zoom level (e.g. `{ ".md": 1.21, ".image": 2.0 }`). Persisted. */
  zoomByFiletype: Record<string, number>;
  /** Set zoom for a filetype key. Value is clamped to [ZOOM_MIN, ZOOM_MAX]. */
  setZoom: (filetype: string, zoom: number) => void;
  /**
   * L3 — single zoom-mutation chokepoint. `dir` selects multiplicative step
   * direction: `"in"` → ×ZOOM_STEP, `"out"` → ÷ZOOM_STEP, `"reset"` → ZOOM_DEFAULT.
   * Reads current zoom via the slice setter rather than via stale closure args.
   */
  bumpZoom: (filetype: string, dir: "in" | "out" | "reset") => void;
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
    zoomByFiletype: {},
    setZoom: (filetype, zoom) =>
      set((s) => ({
        zoomByFiletype: { ...s.zoomByFiletype, [filetype]: clampZoom(zoom) },
      })),
    bumpZoom: (filetype, dir) => {
      const cur = get().zoomByFiletype[filetype] ?? ZOOM_DEFAULT;
      let next: number;
      if (dir === "in") next = cur * ZOOM_STEP;
      else if (dir === "out") next = cur / ZOOM_STEP;
      else next = ZOOM_DEFAULT;
      set((s) => ({
        zoomByFiletype: { ...s.zoomByFiletype, [filetype]: clampZoom(next) },
      }));
    },
  };
}

