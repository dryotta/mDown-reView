import { useCallback, useEffect, useRef } from "react";

import { MermaidCanvas } from "./MermaidCanvas";
import { MermaidControls } from "./MermaidControls";

import { useZoom } from "@/hooks/useZoom";
import { useStore } from "@/store";

import "@/styles/mermaid-popout.css";

/**
 * MermaidPopout — overlay sibling inside `.main-area` that shows the active
 * mermaid diagram in a maximised, interaction-rich surface (issue #276).
 *
 * Layering:
 * - Single-primitive store selector at the top (`mermaidPopoutOpenFor`) so the
 *   bulk of the inner component is gated behind the cheapest possible
 *   subscription. When closed (the common case) we render `null` and never
 *   subscribe to anything else.
 * - Cross-slice "close on context change" wiring (closing the source tab,
 *   switching active tab, etc.) lives in store actions per
 *   `docs/architecture.md` rule 16 — NOT here. The only reactive close path
 *   owned by this component is the document-level Esc keydown listener.
 *
 * Zoom: shares the `.mmd` zoom key with the dedicated viewer
 * (see `src/lib/file-types.ts`). The first time the popout ever opens (no
 * persisted `.mmd` zoom yet) we seed it to the canvas-measured fit scale;
 * subsequent opens preserve the user's chosen zoom. The "Fit" button is the
 * explicit re-fit affordance.
 */
export function MermaidPopout() {
  const openFor = useStore((s) => s.mermaidPopoutOpenFor);
  if (openFor === null) return null;
  return <PopoutInner content={openFor.content} path={openFor.path} />;
}

function PopoutInner({ content, path }: { content: string; path: string | null }) {
  const closeMermaidPopout = useStore((s) => s.closeMermaidPopout);
  const setZoom = useStore((s) => s.setZoom);
  // Same zoom key as the dedicated `.mmd` viewer — chrome shortcuts (Ctrl+= /
  // Ctrl+- / Ctrl+0) and the popout share a single source of truth.
  const { zoom, zoomIn, zoomOut, reset } = useZoom(".mmd");

  // Latest fit scale measured by MermaidCanvas. Held in a ref so the Fit
  // button can reapply it without re-rendering on every measurement.
  const lastFitRef = useRef<number | null>(null);

  // Esc closes the overlay. Document-level listener so focus need not be
  // inside the dialog (consistent with ImageViewer's overlay pattern).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMermaidPopout();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeMermaidPopout]);

  // Fit measurement callback: always cache, but only seed setZoom on the
  // first ever interaction (no `.mmd` entry yet). Subsequent opens keep the
  // user's current zoom — see "rubber-duck rule" docs/architecture.md#16.
  const handleFitMeasured = useCallback(
    (fit: number) => {
      lastFitRef.current = fit;
      const current = useStore.getState().zoomByFiletype[".mmd"];
      if (current === undefined) setZoom(".mmd", fit);
    },
    [setZoom],
  );

  // Explicit "Fit" button — re-applies the most recent measured fit.
  const handleFitClick = useCallback(() => {
    if (lastFitRef.current !== null) setZoom(".mmd", lastFitRef.current);
  }, [setZoom]);

  // Inline wrapper to bridge MermaidCanvas's setZoom(value) to the slice's
  // setZoom(filetype, value). Re-created per render — MermaidCanvas does not
  // memoize on prop identity for setZoom so reference stability is moot.
  const canvasSetZoom = (v: number) => setZoom(".mmd", v);

  return (
    <div
      className="mermaid-popout-overlay"
      role="dialog"
      aria-label="Mermaid diagram preview"
    >
      <MermaidCanvas
        content={content}
        path={path}
        zoom={zoom}
        setZoom={canvasSetZoom}
        readOnly
        onFitMeasured={handleFitMeasured}
      />
      <MermaidControls
        mode="popout"
        zoom={zoom}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onReset={reset}
        onFit={handleFitClick}
        onClose={closeMermaidPopout}
      />
    </div>
  );
}
