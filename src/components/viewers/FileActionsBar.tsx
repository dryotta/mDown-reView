import "@/styles/viewer-toolbar.css";
import { revealInFolder } from "@/lib/tauri-commands";
import { warn } from "@/logger";

interface Props {
  /** Absolute path the actions operate on. */
  path: string;
  /**
   * Optional MIME hint rendered before the buttons. Surfaces the file type
   * for viewers (audio/video) that no longer carry their own header.
   */
  mime?: string;
}

/**
 * L1 — slim action bar with a single icon button (Reveal in folder).
 * Replaces the inline action group that used to live inside `ViewerToolbar`
 * and the text buttons inside `BinaryPlaceholder`.
 *
 * Dispatches to the workspace-allowlisted `revealInFolder` Rust command via
 * the typed wrapper.
 */
export function FileActionsBar({ path, mime }: Props) {
  const handleReveal = () => {
    void revealInFolder(path).catch((e) => warn(`revealInFolder failed: ${String(e)}`));
  };
  return (
    <div className="file-actions-bar" aria-label="File actions">
      {mime && <span className="file-actions-bar__mime">{mime}</span>}
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
    </div>
  );
}
