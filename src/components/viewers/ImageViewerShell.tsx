import { useZoom } from "@/hooks/useZoom";
import { ViewerToolbar } from "./ViewerToolbar";
import { FileActionsBar } from "./FileActionsBar";
import { ImageViewer } from "./ImageViewer";
import type { Severity } from "@/lib/tauri-commands";

interface Props {
  path: string;
  onCommentOnFile?: () => void;
  fileCommentCount?: number;
  fileCommentSeverity?: Severity | null;
}

/**
 * Shell component that owns zoom state and composes the ViewerToolbar
 * above ImageViewer. Zoom surfaces through the toolbar instead of the
 * image viewer's body. `fileCommentCount` drives the file-level badge
 * next to the "Comment on file" button.
 */
export function ImageViewerShell({ path, onCommentOnFile, fileCommentCount, fileCommentSeverity }: Props) {
  const { zoom, zoomIn, zoomOut, reset } = useZoom(".image");

  return (
    <div className="viewer-media-container">
      <ViewerToolbar
        activeView="visual"
        onViewChange={() => {}}
        hidden
        onCommentOnFile={onCommentOnFile}
        fileCommentCount={fileCommentCount}
        fileCommentSeverity={fileCommentSeverity}
        zoom={{ zoom, onZoomIn: zoomIn, onZoomOut: zoomOut, onReset: reset }}
        trailing={<FileActionsBar path={path} />}
      />
      <ImageViewer key={path} path={path} zoom={zoom} fit={true} />
    </div>
  );
}
