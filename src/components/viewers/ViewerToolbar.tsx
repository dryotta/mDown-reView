import "@/styles/viewer-toolbar.css";
import { type ReactNode } from "react";
import { ZoomControl } from "./ZoomControl";

/**
 * L5 — share the same prop shape as `ZoomControl`. Callers spread it directly
 * into `<ZoomControl {...zoom} />` rather than re-wrapping.
 */
export interface ZoomProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

interface Props {
  activeView: "source" | "visual";
  onViewChange: (view: "source" | "visual") => void;
  hidden?: boolean;
  showWrapToggle?: boolean;
  wordWrap?: boolean;
  onToggleWrap?: () => void;
  zoom?: ZoomProps;
  /**
   * Optional center slot rendered between the left toggles and the right
   * actions. Callers compose a per-viewer affordance here (e.g.
   * `<ToolbarFileCommentPill filePath={path} onCommentOnFile={...} />` for
   * commentable viewers). The toolbar stays oblivious to comment domain
   * knowledge — composition over prop-bag growth (see
   * `architecture-avoid-boolean-props` and `patterns-children-over-render-props`
   * in `docs/best-practices-common/react/composition-patterns.md`).
   */
  centerSlot?: ReactNode;
  /**
   * Optional trailing slot rendered on the right edge of the toolbar.
   * `EnhancedViewer` plugs `FileActionsBar` in here so the file actions stay
   * pinned with the (sticky) toolbar instead of becoming a separate sibling
   * row that would scroll independently.
   */
  trailing?: ReactNode;
}

/**
 * View-mode toggle bar: source/visual tabs, optional wrap toggle, optional
 * zoom controls. File-action buttons (reveal in folder) live in
 * `FileActionsBar` and are composed via the `trailing` slot by
 * `EnhancedViewer`, or rendered above headerless media viewers by
 * `ViewerRouter`.
 */
export function ViewerToolbar({ activeView, onViewChange, hidden, showWrapToggle, wordWrap, onToggleWrap, zoom, centerSlot, trailing }: Props) {
  if (hidden && !showWrapToggle && !zoom && !trailing && !centerSlot) return null;

  return (
    <div className="viewer-toolbar" role="toolbar" aria-label="View mode">
      <div className="viewer-toolbar-left">
        {!hidden && (
          <div className="viewer-toolbar-toggle">
            <button
              className={`viewer-toolbar-btn${activeView === "source" ? " active" : ""}`}
              onClick={() => onViewChange("source")}
              aria-pressed={activeView === "source"}
            >
              Source
            </button>
            <button
              className={`viewer-toolbar-btn${activeView === "visual" ? " active" : ""}`}
              onClick={() => onViewChange("visual")}
              aria-pressed={activeView === "visual"}
            >
              Visual
            </button>
          </div>
        )}
        {showWrapToggle && (
          <button
            className={`viewer-toolbar-btn viewer-toolbar-wrap${wordWrap ? " active" : ""}`}
            onClick={onToggleWrap}
            aria-pressed={wordWrap}
            title={wordWrap ? "Disable word wrap" : "Enable word wrap"}
          >
            Wrap
          </button>
        )}
      </div>
      <div className="viewer-toolbar-center">{centerSlot}</div>
      <div className="viewer-toolbar-right">
        {zoom && <ZoomControl {...zoom} />}
        {trailing}
      </div>
    </div>
  );
}
