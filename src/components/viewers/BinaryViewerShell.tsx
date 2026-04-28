import { useState } from "react";
import { copyToClipboard } from "@/lib/tauri-commands";
import { warn } from "@/logger";
import { BinaryPlaceholder } from "./BinaryPlaceholder";
import { HexView } from "./HexView";
import { ViewerToolbar } from "./ViewerToolbar";
import { FileActionsBar } from "./FileActionsBar";

interface Props {
  path: string;
  size?: number;
  mtime?: number | null;
  onCommentOnFile?: () => void;
}

/** Hex view is gated to keep memory + render cost predictable. */
const HEX_MAX_BYTES = 1024 * 1024;

/**
 * Shell component that owns hex-toggle state and composes the ViewerToolbar
 * above either BinaryPlaceholder (metadata) or HexView. All binary-viewer
 * actions (hex toggle, copy path, reveal) surface through the toolbar.
 */
export function BinaryViewerShell({ path, size, mtime, onCommentOnFile }: Props) {
  const [showHex, setShowHex] = useState(false);
  const sizeOk = size !== undefined && size < HEX_MAX_BYTES;

  const handleCopy = () => {
    void copyToClipboard(path).catch((e) =>
      warn(`copyToClipboard failed: ${String(e)}`),
    );
  };

  return (
    <div className="viewer-media-container">
      <ViewerToolbar
        activeView="visual"
        onViewChange={() => {}}
        hidden
        onCommentOnFile={onCommentOnFile}
        trailing={
          <>
            <button
              type="button"
              className="viewer-toolbar-btn"
              onClick={() => setShowHex(!showHex)}
              disabled={!sizeOk}
              title={
                sizeOk
                  ? showHex
                    ? "Show file metadata"
                    : "Show as hex"
                  : "Hex view is disabled for files ≥ 1 MB"
              }
              aria-label={showHex ? "Back to metadata" : "Show as hex"}
            >
              {showHex ? "← Back" : "Hex"}
            </button>
            <button
              type="button"
              className="viewer-toolbar-btn"
              onClick={handleCopy}
              aria-label="Copy path"
              title="Copy file path"
            >
              Copy path
            </button>
            <FileActionsBar path={path} />
          </>
        }
      />
      {showHex ? (
        <HexView path={path} />
      ) : (
        <BinaryPlaceholder path={path} size={size} mtime={mtime} />
      )}
    </div>
  );
}
