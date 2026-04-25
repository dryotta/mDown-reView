import { useState, useEffect, useRef, useCallback } from "react";
import { useImageData } from "@/hooks/useImageData";
import { extname } from "@/lib/path-utils";
import { useZoom } from "@/hooks/useZoom";
import { ZoomControl } from "./ZoomControl";

interface Props {
  path: string;
}

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};

export function ImageViewer({ path }: Props) {
  const [fit, setFit] = useState(true);
  const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(null);
  // Drag-to-pan offset, only meaningful when zoom > 1.
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  const filename = path.split(/[\\/]/).pop() || path;
  const mime = MIME_MAP[extname(path)] ?? "image/png";
  const { dataUrl, error } = useImageData(path, mime);
  const { zoom, zoomIn, zoomOut, reset } = useZoom(".image");
  const canPan = zoom > 1;

  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset on prop change
  useEffect(() => { setDimensions(null); setPan({ x: 0, y: 0 }); }, [path]);
  // Reset pan whenever zoom returns to ≤1 — pan is only meaningful when zoomed in.
  useEffect(() => {
    if (zoom > 1) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot reset on zoom-out edge
    setPan((p) => (p.x === 0 && p.y === 0 ? p : { x: 0, y: 0 }));
  }, [zoom]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!canPan) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: pan.x, baseY: pan.y };
    setDragging(true);
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setPan({ x: d.baseX + (ev.clientX - d.startX), y: d.baseY + (ev.clientY - d.startY) });
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [canPan, pan.x, pan.y]);

  return (
    <div className="image-viewer" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="image-viewer-header" style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderBottom: "1px solid var(--color-border, #d0d7de)", fontSize: 13 }}>
        <span style={{ fontWeight: 600 }}>{filename}</span>
        {dimensions && (
          <span style={{ color: "var(--color-muted, #656d76)" }}>
            {dimensions.w} × {dimensions.h}
          </span>
        )}
        <button
          onClick={() => setFit(!fit)}
          style={{ marginLeft: "auto", padding: "2px 8px", border: "1px solid var(--color-border, #d0d7de)", background: "var(--color-surface, #f6f8fa)", borderRadius: 4, cursor: "pointer", fontSize: 12 }}
        >
          {fit ? "Original size" : "Fit to view"}
        </button>
        <ZoomControl zoom={zoom} onZoomIn={zoomIn} onZoomOut={zoomOut} onReset={reset} />
      </div>
      <div
        className="image-viewer-canvas"
        style={{ flex: 1, overflow: "hidden", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: 16, cursor: canPan ? (dragging ? "grabbing" : "grab") : "default" }}
        onMouseDown={handleMouseDown}
      >
        {error && <div style={{ color: "var(--color-danger, #cf222e)", padding: 16 }}>Error loading image: {error}</div>}
        {!dataUrl && !error && <div style={{ color: "var(--color-muted, #656d76)", padding: 16 }}>Loading image…</div>}
        {dataUrl && (
          <img
            src={dataUrl}
            alt={filename}
            data-zoom={zoom}
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              setDimensions({ w: img.naturalWidth, h: img.naturalHeight });
            }}
            style={{
              maxWidth: fit ? "100%" : undefined,
              maxHeight: fit ? "100%" : undefined,
              objectFit: fit ? "contain" : undefined,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "center center",
              transition: dragging ? "none" : "transform 0.05s linear",
              userSelect: "none",
            }}
          />
        )}
      </div>
    </div>
  );
}
