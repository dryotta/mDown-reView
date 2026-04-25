import { useCallback } from "react";
import { useStore } from "@/store";
import { ZOOM_DEFAULT, ZOOM_STEP } from "@/store/viewerPrefs";

/**
 * Per-filetype zoom controller. Reads the current zoom for `filetype` from
 * the store (default 1.0), exposes step/reset actions, and a raw setter.
 *
 * Clamping happens inside the store action (`setZoom`) so callers never see
 * out-of-range values. Step is multiplicative (×1.1 in, ÷1.1 out).
 *
 * The same `filetype` key passed here must be used by the global zoom
 * keyboard shortcuts (Ctrl+= / Ctrl+- / Ctrl+0) — see
 * `getFiletypeKey()` in `@/lib/file-types`.
 */
export function useZoom(filetype: string) {
  const zoom = useStore((s) => s.zoomByFiletype[filetype] ?? ZOOM_DEFAULT);
  const setZoom = useStore((s) => s.setZoom);

  const zoomIn = useCallback(() => setZoom(filetype, zoom * ZOOM_STEP), [filetype, zoom, setZoom]);
  const zoomOut = useCallback(() => setZoom(filetype, zoom / ZOOM_STEP), [filetype, zoom, setZoom]);
  const reset = useCallback(() => setZoom(filetype, ZOOM_DEFAULT), [filetype, setZoom]);
  const setZoomFor = useCallback((z: number) => setZoom(filetype, z), [filetype, setZoom]);

  return { zoom, zoomIn, zoomOut, reset, setZoom: setZoomFor };
}
