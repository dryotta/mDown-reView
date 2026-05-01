import { useCallback, useRef } from "react";

import { MermaidCanvas } from "./mermaid/MermaidCanvas";
import { MermaidControls } from "./mermaid/MermaidControls";

import { useStore } from "@/store";

import "@/styles/mermaid-view.css";

interface Props {
  content: string;
  /** Optional file path; when provided, MermaidRenderer stamps data-source-line for click-to-comment. */
  path?: string;
  /** Per-filetype zoom from EnhancedViewer's useZoom('.mmd'). */
  zoom?: number;
}

/**
 * Slim shell for the dedicated `.mmd` viewer (issue #276 — c2-mermaidview).
 *
 * Render + theme + transform + pan/zoom now live in MermaidCanvas (which
 * composes MermaidRenderer). This file only owns:
 *   1. Wiring the shared `.mmd` zoom (via `useStore`) into MermaidCanvas.
 *   2. Capturing the most recent fit-to-window scale and routing the Fit
 *      button click to it. EnhancedViewer is the zoom source-of-truth — we
 *      mutate via setZoom('.mmd', …) rather than holding local zoom state.
 *   3. Showing the inline Fit + Pop-out controls ONLY for the dedicated
 *      viewer path (signalled by the presence of `path`). The embedded
 *      markdown-block path (MarkdownComponentsMap → MermaidView, until
 *      c3-markdownmap swaps it for MermaidEmbedded) passes no path and
 *      therefore renders no controls inside the markdown body.
 */
export function MermaidView({ content, path, zoom = 1 }: Props) {
  const setZoom = useStore((s) => s.setZoom);
  const openMermaidPopout = useStore((s) => s.openMermaidPopout);

  // Fit logic: store the most recent fit scale in a ref. On Fit-button
  // click, write it to the shared '.mmd' zoom. On first measurement (when
  // '.mmd' zoom is undefined), seed the shared zoom too so the initial
  // open lands at fit-to-window rather than 100%.
  const lastFitRef = useRef<number | null>(null);
  const handleFitMeasured = useCallback(
    (fit: number) => {
      lastFitRef.current = fit;
      const current = useStore.getState().zoomByFiletype[".mmd"];
      if (current === undefined) {
        setZoom(".mmd", fit);
      }
    },
    [setZoom],
  );

  const handleFitClick = useCallback(() => {
    if (lastFitRef.current !== null) setZoom(".mmd", lastFitRef.current);
  }, [setZoom]);

  const handlePopout = useCallback(() => {
    openMermaidPopout(content, path ?? null);
  }, [openMermaidPopout, content, path]);

  return (
    <div
      className="mermaid-view"
      style={{ display: "flex", flexDirection: "column", height: "100%" }}
    >
      <MermaidCanvas
        content={content}
        path={path ?? null}
        zoom={zoom}
        setZoom={(v) => setZoom(".mmd", v)}
        readOnly={false}
        onFitMeasured={handleFitMeasured}
      />
      {path !== undefined && (
        <MermaidControls
          mode="inline"
          zoom={zoom}
          onZoomIn={() => useStore.getState().bumpZoom(".mmd", "in")}
          onZoomOut={() => useStore.getState().bumpZoom(".mmd", "out")}
          onReset={() => useStore.getState().bumpZoom(".mmd", "reset")}
          onFit={handleFitClick}
          onPopout={handlePopout}
        />
      )}
    </div>
  );
}
