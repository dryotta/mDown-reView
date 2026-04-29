import "@/styles/viewer-toolbar.css";
import { type ReactNode } from "react";
import { ZoomControl } from "./ZoomControl";
import { IconComment } from "@/components/Icons";
import { CommentBadge } from "@/components/comments/CommentBadge";
import type { Severity } from "@/lib/tauri-commands";

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
   * Iter 5 Group B — when provided, renders a "Comment on file" button that
   * surfaces a file-anchored authoring entry point on every viewer (including
   * binary/media viewers that have no line gutter). Click invokes the
   * callback, which typically calls `requestFileLevelInput(path)` so the
   * `CommentsPanel` auto-opens its inline file-level input.
   */
  onCommentOnFile?: () => void;
  /**
   * Count of unresolved file-anchored threads (MRSF `anchor_kind: "file"`).
   * When > 0 a `CommentBadge` is rendered next to the "Comment on file"
   * button so users see the count without opening the panel. The badge is
   * only meaningful alongside the button — passing this without
   * `onCommentOnFile` is a no-op.
   */
  fileCommentCount?: number;
  /**
   * Worst severity across the file-anchored unresolved threads — drives the
   * badge colour. Optional; defaults to "none".
   */
  fileCommentSeverity?: Severity | null;
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
export function ViewerToolbar({ activeView, onViewChange, hidden, showWrapToggle, wordWrap, onToggleWrap, zoom, onCommentOnFile, fileCommentCount, fileCommentSeverity, trailing }: Props) {
  if (hidden && !showWrapToggle && !zoom && !trailing && !onCommentOnFile) return null;

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
      <div className="viewer-toolbar-center">
        {onCommentOnFile && (
          <button
            className="viewer-toolbar-btn viewer-toolbar-comment-on-file"
            onClick={onCommentOnFile}
            title="Comment on file (Ctrl+Shift+M)"
            aria-label="Comment on file (Ctrl+Shift+M)"
          >
            <IconComment />
            <span className="viewer-toolbar-comment-on-file-label">Comment on file</span>
            <CommentBadge
              count={fileCommentCount ?? 0}
              severity={fileCommentSeverity ?? null}
              className="viewer-toolbar-file-badge"
            />
          </button>
        )}
      </div>
      <div className="viewer-toolbar-right">
        {zoom && <ZoomControl {...zoom} />}
        {trailing}
      </div>
    </div>
  );
}
