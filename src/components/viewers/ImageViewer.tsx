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

/**
 * R2 — clamp pan so the image never leaves the viewport entirely. Limits are
 * symmetric: when the (zoomed) image is wider than the container, pan.x is
 * allowed within ±overflow/2; otherwise pinned at 0. Same for y.
 */
function clampPan(
  pan: { x: number; y: number },
  container: { w: number; h: number },
  imgNatural: { w: number; h: number },
  zoom: number,
): { x: number; y: number } {
  const scaledW = imgNatural.w * zoom;
  const scaledH = imgNatural.h * zoom;
  const overflowX = Math.max(0, scaledW - container.w);
  const overflowY = Math.max(0, scaledH - container.h);
  const limitX = overflowX / 2;
  const limitY = overflowY / 2;
  return {
    x: Math.max(-limitX, Math.min(limitX, pan.x)),
    y: Math.max(-limitY, Math.min(limitY, pan.y)),
  };
}

export function ImageViewer({ path }: Props) {
  const [fit, setFit] = useState(true);
  const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(null);
  // Drag-to-pan offset, only meaningful when zoom > 1.
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number; pointerId: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const filename = path.split(/[\\/]/).pop() || path;
  const mime = MIME_MAP[extname(path)] ?? "image/png";
  const { dataUrl, error } = useImageData(path, mime);
  const { zoom, zoomIn, zoomOut, reset } = useZoom(".image");
  const canPan = zoom > 1;

  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset on prop change
  useEffect(() => { setDimensions(null); setPan({ x: 0, y: 0 }); }, [path]);
  // Reset / re-clamp pan whenever zoom changes. When zoom ≤ 1 the image fits
  // the viewport so pan must be zero. While still zoomed in, the valid pan
  // limits shrink as zoom decreases — clamp so previous drags stay in-bounds.
  useEffect(() => {
    if (zoom <= 1) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot reset on zoom-out edge
      setPan((p) => (p.x === 0 && p.y === 0 ? p : { x: 0, y: 0 }));
      return;
    }
    const canvas = canvasRef.current;
    const displayed = dimensions;
    if (!canvas || !displayed) return;
    setPan((p) => {
      const next = clampPan(p, { w: canvas.clientWidth, h: canvas.clientHeight }, displayed, zoom);
      return next.x === p.x && next.y === p.y ? p : next;
    });
  }, [zoom, dimensions]);

  // R1 — pointer-event drag with setPointerCapture. No window listeners, so
  // unmount-during-drag never leaves dangling handlers; capture is implicitly
  // released by the browser when the element is removed.
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!canPan) return;
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: pan.x, baseY: pan.y, pointerId: e.pointerId };
    setDragging(true);
  }, [canPan, pan.x, pan.y]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const next = { x: d.baseX + (e.clientX - d.startX), y: d.baseY + (e.clientY - d.startY) };
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (canvas && img) {
      // Use the laid-out (pre-transform) image size — `clientWidth/Height` is
      // the box CSS produces (after `object-fit: contain` / `maxWidth`), so it
      // already accounts for the case where natural size > container.
      const displayed = { w: img.clientWidth, h: img.clientHeight };
      setPan(clampPan(next, { w: canvas.clientWidth, h: canvas.clientHeight }, displayed, zoom));
    } else {
      setPan(next);
    }
  }, [zoom]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    setDragging(false);
  }, []);

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
        ref={canvasRef}
        className="image-viewer-canvas"
        style={{ flex: 1, overflow: "hidden", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: 16, cursor: canPan ? (dragging ? "grabbing" : "grab") : "default", touchAction: canPan ? "none" : "auto" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {error && <div style={{ color: "var(--color-danger, #cf222e)", padding: 16 }}>Error loading image: {error}</div>}
        {!dataUrl && !error && <div style={{ color: "var(--color-muted, #656d76)", padding: 16 }}>Loading image…</div>}
        {dataUrl && (
          <img
            ref={imgRef}
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
