import { useState } from "react";
import { useZoom } from "@/hooks/useZoom";
import { ViewerToolbar } from "./ViewerToolbar";
import { FileActionsBar } from "./FileActionsBar";
import { ImageViewer } from "./ImageViewer";

interface Props {
  path: string;
  onCommentOnFile?: () => void;
}

/**
 * Shell component that owns zoom and fit state and composes the ViewerToolbar
 * above ImageViewer. Zoom and fit-toggle surface through the toolbar instead
 * of the image viewer's body.
 */
export function ImageViewerShell({ path, onCommentOnFile }: Props) {
  const [fit, setFit] = useState(true);
  const { zoom, zoomIn, zoomOut, reset } = useZoom(".image");

  return (
    <div className="viewer-media-container">
      <ViewerToolbar
        activeView="visual"
        onViewChange={() => {}}
        hidden
        onCommentOnFile={onCommentOnFile}
        zoom={{ zoom, onZoomIn: zoomIn, onZoomOut: zoomOut, onReset: reset }}
        trailing={
          <>
            <button
              type="button"
              className="viewer-toolbar-btn"
              onClick={() => setFit(!fit)}
              aria-label={fit ? "Original size" : "Fit to view"}
              title={fit ? "Show at original size" : "Fit image to view"}
            >
              {fit ? "Original size" : "Fit to view"}
            </button>
            <FileActionsBar path={path} />
          </>
        }
      />
      <ImageViewer key={path} path={path} zoom={zoom} fit={fit} />
    </div>
  );
}
