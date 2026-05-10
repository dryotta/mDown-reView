import "@/styles/drag-drop-overlay.css";

/**
 * Static SVG hoist (per `docs/best-practices-common/react/rendering-performance.md`
 * `rendering-hoist-jsx`): keep the icon literal at module scope so the
 * React Compiler / runtime never re-creates it on overlay mount.
 */
const dropIcon = (
  <svg
    width="48"
    height="48"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

interface DragDropOverlayProps {
  isDragging: boolean;
  /**
   * `true` when the receiving window already has a workspace folder
   * open. Drives the state-aware hint copy: a folder dropped onto a
   * folder-window spawns a NEW window (preserves the user's current
   * workspace), while a folder dropped onto an empty window claims
   * it. The two cases produce visibly different UX, so the hint
   * has to match.
   *
   * Product-expert PR #372 review (#2): "Folders open as workspaces"
   * was misleading mid-session — say what actually happens.
   */
  hasWorkspace: boolean;
  /**
   * Transient rejection notice fed by `useDragDropOverlay`. Shown as a
   * small toast when a drop's paths could not be classified (deleted,
   * renamed, NTFS-ADS, etc.). `null` hides the toast.
   */
  lastRejection: { count: number; reason: string } | null;
}

/**
 * Fullscreen overlay shown while the user is dragging files over the
 * window. The visible cue tells the user "you can drop here" — the
 * actual file-open work is performed in Rust
 * (`commands::drag_drop::handle_dropped_paths` →
 * `route_args_to_window`) so the overlay does not need to handle DOM
 * `drop` events itself.
 *
 * Pointer-events are disabled so the overlay never intercepts clicks
 * if the renderer mis-handles a `leave` event (defensive — in practice
 * Tauri reliably emits `leave` after a cancelled drag).
 *
 * Accessibility: the visual overlay carries `aria-hidden="true"` (it
 * is a decorative scrim), but a sibling sr-only `aria-live="polite"`
 * region announces the drop affordance for assistive tech (PR #372
 * product-expert finding #7).
 */
export function DragDropOverlay({
  isDragging,
  hasWorkspace,
  lastRejection,
}: DragDropOverlayProps) {
  const folderHint = hasWorkspace
    ? "Folders open in a new window"
    : "Folders open as this workspace";

  return (
    <>
      <span className="drag-drop-overlay-sr-only" aria-live="polite">
        {isDragging ? "Drop files or folders to open" : ""}
      </span>
      {isDragging && (
        <div className="drag-drop-overlay" role="presentation" aria-hidden="true">
          <div className="drag-drop-overlay-card">
            <div className="drag-drop-overlay-icon" aria-hidden="true">
              {dropIcon}
            </div>
            <div className="drag-drop-overlay-title">Drop to open</div>
            <div className="drag-drop-overlay-hint">
              Files open as tabs · {folderHint}
            </div>
          </div>
        </div>
      )}
      {lastRejection && !isDragging && (
        <div className="drag-drop-rejection-toast" role="status" aria-live="polite">
          {lastRejection.count === 1
            ? "Couldn't open the dropped item"
            : `Couldn't open ${lastRejection.count} dropped items`}
          <span className="drag-drop-rejection-detail"> — {lastRejection.reason}</span>
        </div>
      )}
    </>
  );
}
