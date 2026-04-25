import { memo } from "react";

interface Props {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

/**
 * Minimal zoom toolbar group: − {n%} + ↺.
 *
 * Rendered inside `ViewerToolbar` when a `zoom` prop is passed (visualizable
 * viewers and the source view), and inline by `ImageViewer` which does not
 * use the shared toolbar. The buttons mirror the global keyboard shortcuts
 * (Ctrl+- / Ctrl+= / Ctrl+0) so users can discover them via tooltips.
 *
 * R4 — memoized: parent zoom callbacks are stable (see `useZoom`), so this
 * only re-renders when `zoom` actually changes.
 */
function ZoomControlImpl({ zoom, onZoomIn, onZoomOut, onReset }: Props) {
  return (
    <div className="viewer-toolbar-zoom" role="group" aria-label="Zoom">
      <button
        type="button"
        className="viewer-toolbar-btn viewer-toolbar-zoom-btn"
        onClick={onZoomOut}
        aria-label="Zoom out"
        title="Zoom out (Ctrl+-)"
      >
        −
      </button>
      <span
        className="viewer-toolbar-zoom-value"
        aria-live="polite"
        aria-label={`Zoom ${Math.round(zoom * 100)} percent`}
      >
        {Math.round(zoom * 100)}%
      </span>
      <button
        type="button"
        className="viewer-toolbar-btn viewer-toolbar-zoom-btn"
        onClick={onZoomIn}
        aria-label="Zoom in"
        title="Zoom in (Ctrl+=)"
      >
        +
      </button>
      <button
        type="button"
        className="viewer-toolbar-btn viewer-toolbar-zoom-btn"
        onClick={onReset}
        aria-label="Reset zoom"
        title="Reset zoom (Ctrl+0)"
      >
        ↺
      </button>
    </div>
  );
}

export const ZoomControl = memo(ZoomControlImpl);
