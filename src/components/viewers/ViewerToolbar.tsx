import "@/styles/viewer-toolbar.css";
import { openInDefaultApp, revealInFolder } from "@/lib/tauri-commands";
import { warn } from "@/logger";
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
   * G4 — when provided, the toolbar renders "Reveal in folder" and "Open
   * externally" buttons on the right edge for the given absolute path. Both
   * buttons dispatch to workspace-allowlisted Rust commands via the
   * `revealInFolder` / `openInDefaultApp` typed wrappers.
   */
  path?: string;
}

export function ViewerToolbar({ activeView, onViewChange, hidden, showWrapToggle, wordWrap, onToggleWrap, zoom, path }: Props) {
  if (hidden && !showWrapToggle && !zoom && !path) return null;

  const handleReveal = () => {
    if (!path) return;
    void revealInFolder(path).catch((e) => warn(`revealInFolder failed: ${String(e)}`));
  };
  const handleOpen = () => {
    if (!path) return;
    void openInDefaultApp(path).catch((e) => warn(`openInDefaultApp failed: ${String(e)}`));
  };

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
      {path && (
        <div className="viewer-toolbar-actions">
          <button
            type="button"
            className="viewer-toolbar-btn viewer-toolbar-icon-btn"
            onClick={handleReveal}
            title="Reveal in folder"
            aria-label="Reveal in folder"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <path d="M9 14l3-3 3 3M12 11v6" />
            </svg>
          </button>
          <button
            type="button"
            className="viewer-toolbar-btn viewer-toolbar-icon-btn"
            onClick={handleOpen}
            title="Open externally"
            aria-label="Open externally"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 4h6v6" />
              <path d="M10 14L20 4" />
              <path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
