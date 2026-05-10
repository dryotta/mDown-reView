import "@/styles/drag-drop-overlay.css";

interface DragDropOverlayProps {
  isDragging: boolean;
}

/**
 * Fullscreen overlay shown while the user is dragging files over the
 * window. The visible cue tells the user "you can drop here" — the
 * actual file-open work is performed in Rust (`WindowEvent::DragDrop`
 * → `launch_routing::route_args_through_registry`) so the overlay
 * does not need to handle DOM `drop` events itself.
 *
 * Pointer-events are disabled so the overlay never intercepts clicks
 * if the renderer mis-handles a `leave` event (defensive — in practice
 * Tauri reliably emits `leave` after a cancelled drag).
 */
export function DragDropOverlay({ isDragging }: DragDropOverlayProps) {
  if (!isDragging) return null;
  return (
    <div className="drag-drop-overlay" role="presentation" aria-hidden="true">
      <div className="drag-drop-overlay-card">
        <div className="drag-drop-overlay-icon" aria-hidden="true">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <div className="drag-drop-overlay-title">Drop to open</div>
        <div className="drag-drop-overlay-hint">
          Files open as tabs · Folders open as workspaces
        </div>
      </div>
    </div>
  );
}
