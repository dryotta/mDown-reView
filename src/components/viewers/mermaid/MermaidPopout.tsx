import { useCallback, useEffect } from "react";

import { MermaidCanvas } from "./MermaidCanvas";
import { MermaidControls } from "./MermaidControls";

import { useZoom } from "@/hooks/useZoom";
import { useStore } from "@/store";

import "@/styles/mermaid-popout.css";

/**
 * MermaidPopout — overlay sibling inside `.main-area` that shows the active
 * mermaid diagram in a maximised, interaction-rich surface (issue #276).
 *
 * DOM structure:
 *   <div class="mermaid-popout-overlay">     ← transparent full-bleed
 *                                              click interceptor (so gap
 *                                              clicks don't fall through
 *                                              to the underlying viewer)
 *     <div class="mermaid-popout-card">      ← visible card with border,
 *                                              shadow, theme background
 *       <MermaidCanvas .../>
 *       <MermaidControls mode="popout" .../>
 *     </div>
 *   </div>
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
 * Zoom: shares the `.mmd` zoom key with the dedicated viewer. `zoom = 1.0`
 * ≡ "fits the viewing area" under MermaidCanvas's hybrid scale model, so
 * no fit-seeding dance is needed: the popout simply opens at whatever
 * zoom is shared, and the "Fit" button is a `bumpZoom(".mmd", "reset")`
 * call (reset = ZOOM_DEFAULT = 1.0).
 *
 * `aria-modal="false"` reflects reality: there's no focus trap and no
 * backdrop dim. The dialog is dismissable via Esc + the close button.
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

  // Esc closes the overlay. Document-level listener so focus need not be
  // inside the dialog (consistent with ImageViewer's overlay pattern).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMermaidPopout();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeMermaidPopout]);

  // Inline wrapper to bridge MermaidCanvas's setZoom(value) to the slice's
  // setZoom(filetype, value). Re-created per render — MermaidCanvas does not
  // memoize on prop identity for setZoom so reference stability is moot.
  const canvasSetZoom = (v: number) => setZoom(".mmd", v);

  // Fit = reset (1.0 ≡ fit-to-window under the hybrid scale model).
  const handleFit = useCallback(() => reset(), [reset]);

  return (
    <div
      className="mermaid-popout-overlay"
      role="dialog"
      aria-label="Mermaid diagram preview"
      aria-modal="false"
    >
      <div className="mermaid-popout-card">
        <MermaidCanvas
          content={content}
          path={path}
          zoom={zoom}
          setZoom={canvasSetZoom}
          readOnly
        />
        <MermaidControls
          mode="popout"
          zoom={zoom}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onReset={reset}
          onFit={handleFit}
          onClose={closeMermaidPopout}
        />
      </div>
    </div>
  );
}
