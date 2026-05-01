import { useCallback } from "react";

import { MermaidCanvas } from "./mermaid/MermaidCanvas";
import { MermaidControls } from "./mermaid/MermaidControls";

import { useStore } from "@/store";

import "@/styles/mermaid-view.css";

interface Props {
  content: string;
  /** Optional file path; when provided, MermaidRenderer stamps data-source-line for click-to-comment. */
  path?: string;
  /** Per-filetype zoom from EnhancedViewer's useZoom('.mmd'). 1.0 = "fits the viewing area". */
  zoom?: number;
}

/**
 * Slim shell for the dedicated `.mmd` viewer (issue #276 — c2-mermaidview).
 *
 * Render + theme + transform + pan/zoom now live in MermaidCanvas (which
 * composes MermaidRenderer). This file only owns:
 *   1. Wiring the shared `.mmd` zoom (via `useStore`) into MermaidCanvas.
 *   2. Routing the Fit button click to a zoom reset (1.0 ≡ fit-to-window
 *      under the hybrid scale model owned by MermaidCanvas).
 *   3. Showing the inline Fit + Pop-out controls ONLY for the dedicated
 *      viewer path (signalled by the presence of `path`). The embedded
 *      markdown-block path (MarkdownComponentsMap → MermaidView, until
 *      c3-markdownmap swaps it for MermaidEmbedded) passes no path and
 *      therefore renders no controls inside the markdown body.
 */
export function MermaidView({ content, path, zoom = 1 }: Props) {
  const setZoom = useStore((s) => s.setZoom);
  const bumpZoom = useStore((s) => s.bumpZoom);
  const openMermaidPopout = useStore((s) => s.openMermaidPopout);

  // 1.0 ≡ fit under MermaidCanvas's scale model, so "Fit" is just a zoom
  // reset. Same chokepoint chrome's ViewerToolbar uses for Cmd+0 etc.
  const handleFitClick = useCallback(() => {
    bumpZoom(".mmd", "reset");
  }, [bumpZoom]);

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
