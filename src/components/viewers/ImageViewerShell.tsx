import { useRef, type ReactNode } from "react";
import { useZoom } from "@/hooks/useZoom";
import { useCtrlWheelZoom } from "@/hooks/useCtrlWheelZoom";
import { ViewerToolbar } from "./ViewerToolbar";
import { FileActionsBar } from "./FileActionsBar";
import { ImageViewer } from "./ImageViewer";

interface Props {
  path: string;
  /** G4 — forwarded to `ViewerToolbar.centerSlot`. Composition over prop-bag. */
  centerSlot?: ReactNode;
}

/**
 * Shell component that owns zoom state and composes the ViewerToolbar
 * above ImageViewer. Zoom surfaces through the toolbar; the optional
 * `centerSlot` is where callers plug in `<ToolbarFileCommentPill ...>`.
 */
export function ImageViewerShell({ path, centerSlot }: Props) {
  const { zoom, zoomIn, zoomOut, reset } = useZoom(".image");
  const containerRef = useRef<HTMLDivElement>(null);
  useCtrlWheelZoom(containerRef, zoomIn, zoomOut);

  return (
    <div ref={containerRef} className="viewer-media-container">
      <ViewerToolbar
        activeView="visual"
        onViewChange={() => {}}
        hidden
        centerSlot={centerSlot}
        zoom={{ zoom, onZoomIn: zoomIn, onZoomOut: zoomOut, onReset: reset }}
        trailing={<FileActionsBar path={path} />}
      />
      <ImageViewer key={path} path={path} zoom={zoom} fit={true} />
    </div>
  );
}

