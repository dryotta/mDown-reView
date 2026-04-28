import { useZoom } from "@/hooks/useZoom";
import { ViewerToolbar } from "./ViewerToolbar";
import { FileActionsBar } from "./FileActionsBar";
import { ImageViewer } from "./ImageViewer";

interface Props {
  path: string;
  onCommentOnFile?: () => void;
}

/**
 * Shell component that owns zoom state and composes the ViewerToolbar
 * above ImageViewer. Zoom surfaces through the toolbar instead of the
 * image viewer's body.
 */
export function ImageViewerShell({ path, onCommentOnFile }: Props) {
  const { zoom, zoomIn, zoomOut, reset } = useZoom(".image");

  return (
    <div className="viewer-media-container">
      <ViewerToolbar
        activeView="visual"
        onViewChange={() => {}}
        hidden
        onCommentOnFile={onCommentOnFile}
        zoom={{ zoom, onZoomIn: zoomIn, onZoomOut: zoomOut, onReset: reset }}
        trailing={<FileActionsBar path={path} />}
      />
      <ImageViewer key={path} path={path} zoom={zoom} fit={true} />
    </div>
  );
}
