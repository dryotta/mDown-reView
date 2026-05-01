import "@/styles/mermaid-popout.css";

interface Props {
  /** Bottom-centred floating bar (− / 100% / + / Fit) plus a top-right close
   *  button used inside `MermaidPopout`. The previous `mode="inline"` variant
   *  used to render Fit + Pop-out at the dedicated `.mmd` viewer's top-right;
   *  it was removed because zoom + reset live in the chrome `ViewerToolbar`
   *  and Pop-out is a no-op when the viewer already IS the full-window view. */
  zoom: number;
  /** Handlers — chrome ViewerToolbar shortcuts also drive these via the
   *  same `useZoom` source-of-truth so the popout bar stays in sync. */
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  /** Mermaid-specific: compute fit-to-window scale and apply via setZoom. */
  onFit: () => void;
  /** Closes the overlay (X button). */
  onClose: () => void;
}

/**
 * Floating Mermaid popout chrome — controlled component, all state and
 * handlers flow in via props so `useZoom` in the parent is the single
 * source of truth.
 */
export function MermaidControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
  onFit,
  onClose,
}: Props) {
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
