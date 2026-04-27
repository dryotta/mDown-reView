import "@/styles/viewer-toolbar.css";
import { useMemo, type ReactNode } from "react";
import { ZoomControl } from "./ZoomControl";
import { useStore } from "@/store";
import { useFileBadges } from "@/hooks/useFileBadges";
import { IconComment, IconPrint } from "@/components/Icons";

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
   * #65 G3 — when provided, renders a "Print" button that invokes the
   * supplied callback (typically `() => window.print()`). Only viewers
   * whose visual output benefits from print (markdown/HTML preview) opt
   * in via `EnhancedViewer`; source/binary viewers leave it undefined so
   * the button is hidden.
   */
  onPrint?: () => void;
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
export function ViewerToolbar({ activeView, onViewChange, hidden, showWrapToggle, wordWrap, onToggleWrap, zoom, onCommentOnFile, onPrint, trailing }: Props) {
  // Iter 6 F8 — workspace-wide "Next unresolved" surfacing. Reads the action
  // and tab count straight from the Zustand store (MVVM rule 9 single-field
  // selectors).
  //
  // B2 (iter 7 forward-fix) — the disabled state now consults the existing
  // `useFileBadges` hook (reactive per-path unresolved counts via
  // `get_file_badges` IPC + `comments-changed` listener) instead of a
  // duplicate per-file thread cache. The button is enabled iff any
  // *other* tab has an unresolved badge count.
  const nextUnresolvedAcrossFiles = useStore((s) => s.nextUnresolvedAcrossFiles);
  const tabs = useStore((s) => s.tabs);
  const activePath = useStore((s) => s.activeTabPath);
  // Memoise the path-array so `useFileBadges` sees stable input even though
  // each `tabs` slice change otherwise produces a fresh `.map` array.
  const stablePaths = useMemo(() => tabs.map((t) => t.path), [tabs]);
  const badges = useFileBadges(stablePaths);
  const canNextUnresolved = Object.entries(badges).some(
    ([p, b]) => p !== activePath && (b?.count ?? 0) > 0,
  );

  if (hidden && !showWrapToggle && !zoom && !trailing && !onCommentOnFile && !onPrint) return null;

  return (
    <div className="viewer-toolbar" role="toolbar" aria-label="View mode">
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
      {zoom && <ZoomControl {...zoom} />}
      {onCommentOnFile && (
        <>
          <button
            className="viewer-toolbar-btn viewer-toolbar-comment-on-file"
            onClick={onCommentOnFile}
            title="Comment on file (Ctrl+Shift+M)"
            aria-label="Comment on file (Ctrl+Shift+M)"
          >
            <IconComment />
            <span className="viewer-toolbar-comment-on-file-label">Comment on file</span>
          </button>
          <button
            className="viewer-toolbar-btn viewer-toolbar-next-unresolved"
            onClick={() => { void nextUnresolvedAcrossFiles(); }}
            disabled={!canNextUnresolved}
            title="Jump to the next unresolved thread across the workspace (N)"
            aria-label="Next unresolved (workspace)"
          >
            <span aria-hidden="true">→</span>
            <span className="viewer-toolbar-next-unresolved-label">Next unresolved</span>
          </button>
        </>
      )}
      {onPrint && (
        <button
          type="button"
          className="viewer-toolbar-btn viewer-toolbar-print"
          onClick={onPrint}
          aria-label="Print"
          title="Print"
        >
          <IconPrint />
        </button>
      )}
      {trailing}
    </div>
  );
}
