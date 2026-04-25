import { useCallback } from "react";
import { useStore } from "@/store";
import { ZOOM_DEFAULT } from "@/store/viewerPrefs";

/**
 * Per-filetype zoom controller. Reads the current zoom for `filetype` from
 * the store (default 1.0) and exposes step/reset actions backed by the
 * single `bumpZoom` slice action (L3).
 *
 * Callbacks are stable across renders: they read the current zoom inside
 * `bumpZoom` itself (via the slice's `get()`), so they do not depend on the
 * subscribed `zoom` value (R4). This keeps `ZoomControl` cheap to memoize.
 *
 * The same `filetype` key passed here must be used by the global zoom
 * keyboard shortcuts (Ctrl+= / Ctrl+- / Ctrl+0) — see
 * `getFiletypeKey()` in `@/lib/file-types`.
 */
export function useZoom(filetype: string) {
  const zoom = useStore((s) => s.zoomByFiletype[filetype] ?? ZOOM_DEFAULT);

  const zoomIn = useCallback(() => useStore.getState().bumpZoom(filetype, "in"), [filetype]);
  const zoomOut = useCallback(() => useStore.getState().bumpZoom(filetype, "out"), [filetype]);
  const reset = useCallback(() => useStore.getState().bumpZoom(filetype, "reset"), [filetype]);

  return { zoom, zoomIn, zoomOut, reset };
}
