import "@/styles/mermaid-popout.css";
import "@/styles/mermaid-view.css";

interface Props {
  /** "inline" → small floating top-right buttons (Fit + Pop-out) used inside the dedicated `.mmd` viewer's MermaidCanvas.
   *  "popout" → bottom-centred floating bar (− / 100% / + / Fit) plus a top-right close button used inside MermaidPopout. */
  mode: "inline" | "popout";
  /** Current zoom value (e.g. 1.21 for 121%). */
  zoom: number;
  /** Required for both modes — chrome ViewerToolbar shortcuts continue to drive these too (single source of truth via useZoom). */
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  /** Mermaid-specific: compute fit-to-window scale and apply via setZoom. */
  onFit: () => void;
  /** Inline mode: opens the popout overlay. Required when mode === "inline". */
  onPopout?: () => void;
  /** Popout mode: closes the overlay (X button). Required when mode === "popout". */
  onClose?: () => void;
}

/**
 * Floating Mermaid canvas controls. Pure controlled component — all state
 * (zoom + handlers) flows in via props. `useZoom` in the parent is the
 * single source of truth so chrome ViewerToolbar shortcuts stay in sync.
 */
export function MermaidControls({
  mode,
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
  onFit,
  onPopout,
  onClose,
}: Props) {
  if (mode === "inline") {
    return (
      <div className="mermaid-canvas-actions">
        <button type="button" title="Fit to window" aria-label="Fit to window" onClick={onFit}>
          Fit
        </button>
        {onPopout ? (
          <button type="button" title="Pop out" aria-label="Pop out" onClick={onPopout}>
            ⤢
          </button>
        ) : null}
      </div>
    );
  }

  // mode === "popout"
  const percent = `${Math.round(zoom * 100)}%`;
  return (
    <>
      <div className="mermaid-popout-bar">
        <button type="button" title="Zoom out" aria-label="Zoom out" onClick={onZoomOut}>
          −
        </button>
        <span
          className="mermaid-popout-bar-zoom-display"
          role="button"
          tabIndex={0}
          aria-label="Reset zoom"
          onClick={onReset}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onReset();
            }
          }}
        >
          {percent}
        </span>
        <button type="button" title="Zoom in" aria-label="Zoom in" onClick={onZoomIn}>
          +
        </button>
        <button type="button" title="Fit to window" aria-label="Fit to window" onClick={onFit}>
          Fit
        </button>
      </div>
      <button
        type="button"
        className="mermaid-popout-close"
        title="Close popout"
        aria-label="Close popout"
        onClick={onClose}
      >
        ×
      </button>
    </>
  );
}
