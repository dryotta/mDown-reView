import { useState, useEffect, useRef, useCallback, useLayoutEffect, useMemo } from "react";
import { useImageData } from "@/hooks/useImageData";
import { extname } from "@/lib/path-utils";
import { useZoom } from "@/hooks/useZoom";
import { ZoomControl } from "./ZoomControl";
import { useComments } from "@/lib/vm/use-comments";
import { useCommentActions } from "@/lib/vm/use-comment-actions";
import { useStore } from "@/store";
import { deriveAnchor, type Anchor } from "@/types/comments";
import { CommentInput } from "@/components/comments/CommentInput";
import type { CommentThread as CommentThreadType } from "@/lib/tauri-commands";
import "@/styles/image-viewer.css";

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

/** Drag-distance below which a pointerup is treated as a click (single-point pin). */
const DRAG_THRESHOLD_PX = 4;

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

interface ImageRectThread {
  thread: CommentThreadType;
  x_pct: number;
  y_pct: number;
  w_pct?: number;
  h_pct?: number;
}

interface ComposerState {
  /** Anchor coordinates already normalized to the natural image (in percent). */
  x_pct: number;
  y_pct: number;
  w_pct?: number;
  h_pct?: number;
  /** Popover position (canvas-relative px, pre-clamp). */
  top: number;
  left: number;
}

/** Clamp popover so it stays within the canvas bounds. */
function clampPopover(
  pos: { top: number; left: number },
  popover: { w: number; h: number },
  canvas: { w: number; h: number },
): { top: number; left: number } {
  const left = Math.max(4, Math.min(canvas.w - popover.w - 4, pos.left));
  const top = Math.max(4, Math.min(canvas.h - popover.h - 4, pos.top));
  return { top, left };
}

export function ImageViewer({ path }: Props) {
  const [fit, setFit] = useState(true);
  const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(null);
  // Drag-to-pan offset, only meaningful when zoom > 1.
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [commentMode, setCommentMode] = useState(false);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  // Live drag rectangle in canvas-relative px, used for the drawing-feedback overlay.
  const [drawRect, setDrawRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // Bumped when layout shifts (resize, zoom, pan, fit, dimensions) so the
  // existing-thread markers re-derive their absolute pixel positions from
  // the current img bounding rect.
  const [layoutTick, setLayoutTick] = useState(0);

  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number; pointerId: number } | null>(null);
  const commentDragRef = useRef<{ startClientX: number; startClientY: number; pointerId: number; moved: boolean } | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const filename = path.split(/[\\/]/).pop() || path;
  const mime = MIME_MAP[extname(path)] ?? "image/png";
  const { dataUrl, error } = useImageData(path, mime);
  const { zoom, zoomIn, zoomOut, reset } = useZoom(".image");
  const canPan = !commentMode && zoom > 1;

  const { threads } = useComments(path);
  const { addComment } = useCommentActions();
  const setFocusedThread = useStore((s) => s.setFocusedThread);

  // Index unresolved image_rect threads.
  const imageRectThreads = useMemo<ImageRectThread[]>(() => {
    const out: ImageRectThread[] = [];
    for (const t of threads) {
      if (t.root.resolved) continue;
      const a = deriveAnchor(t.root);
      if (a.kind !== "image_rect") continue;
      out.push({ thread: t, x_pct: a.x_pct, y_pct: a.y_pct, w_pct: a.w_pct, h_pct: a.h_pct });
    }
    return out;
  }, [threads]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset on prop change
  useEffect(() => { setDimensions(null); setPan({ x: 0, y: 0 }); setComposer(null); setDrawRect(null); }, [path]);

  // Reset / re-clamp pan whenever zoom changes.
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

  // Bump layoutTick on canvas resize so the marker overlays re-anchor.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setLayoutTick((t) => t + 1));
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // Force a marker re-render when pan/zoom/fit/dimensions change. We read the
  // <img>'s bounding rect lazily inside the layout effect below; this state
  // bumps the effect's deps to re-run after each pan/zoom mutation.
  // (No-op block kept intentionally — pan.x/pan.y/zoom/fit/dimensions are
  // wired into the layout effect at the bottom of the component.)

  // ── Pan handlers (zoom > 1, comment mode OFF) ─────────────────────────
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // In comment mode, the click/drag goes to the comment-authoring path.
    if (commentMode) {
      // Only start authoring if the down lands inside the displayed image.
      const img = imgRef.current;
      if (!img) return;
      const ir = img.getBoundingClientRect();
      if (e.clientX < ir.left || e.clientX > ir.right || e.clientY < ir.top || e.clientY > ir.bottom) return;
      e.preventDefault();
      const target = e.currentTarget;
      try { target.setPointerCapture(e.pointerId); } catch { /* jsdom */ }
      commentDragRef.current = { startClientX: e.clientX, startClientY: e.clientY, pointerId: e.pointerId, moved: false };
      return;
    }
    if (!canPan) return;
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: pan.x, baseY: pan.y, pointerId: e.pointerId };
    setDragging(true);
  }, [canPan, commentMode, pan.x, pan.y]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const cd = commentDragRef.current;
    if (cd && cd.pointerId === e.pointerId) {
      const dx = e.clientX - cd.startClientX;
      const dy = e.clientY - cd.startClientY;
      if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
        cd.moved = true;
      }
      // Live preview rectangle in canvas-relative px.
      const canvas = canvasRef.current;
      if (canvas && cd.moved) {
        const cr = canvas.getBoundingClientRect();
        const x0 = cd.startClientX - cr.left;
        const y0 = cd.startClientY - cr.top;
        const x1 = e.clientX - cr.left;
        const y1 = e.clientY - cr.top;
        setDrawRect({
          x: Math.min(x0, x1),
          y: Math.min(y0, y1),
          w: Math.abs(x1 - x0),
          h: Math.abs(y1 - y0),
        });
      }
      return;
    }
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const next = { x: d.baseX + (e.clientX - d.startX), y: d.baseY + (e.clientY - d.startY) };
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (canvas && img) {
      const displayed = { w: img.clientWidth, h: img.clientHeight };
      setPan(clampPan(next, { w: canvas.clientWidth, h: canvas.clientHeight }, displayed, zoom));
    } else {
      setPan(next);
    }
  }, [zoom]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const cd = commentDragRef.current;
    if (cd && cd.pointerId === e.pointerId) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* jsdom */ }
      commentDragRef.current = null;
      setDrawRect(null);
      const img = imgRef.current;
      const canvas = canvasRef.current;
      if (!img || !canvas) return;
      const ir = img.getBoundingClientRect();
      const cr = canvas.getBoundingClientRect();

      const startInsideX = Math.max(ir.left, Math.min(ir.right, cd.startClientX));
      const startInsideY = Math.max(ir.top, Math.min(ir.bottom, cd.startClientY));
      const endInsideX = Math.max(ir.left, Math.min(ir.right, e.clientX));
      const endInsideY = Math.max(ir.top, Math.min(ir.bottom, e.clientY));

      const dx = e.clientX - cd.startClientX;
      const dy = e.clientY - cd.startClientY;
      const isDrag = Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;

      let popoverTop: number;
      let popoverLeft: number;
      let payload: { x_pct: number; y_pct: number; w_pct?: number; h_pct?: number };

      if (!isDrag) {
        const x_pct = ((endInsideX - ir.left) / ir.width) * 100;
        const y_pct = ((endInsideY - ir.top) / ir.height) * 100;
        payload = { x_pct, y_pct };
        popoverTop = e.clientY - cr.top + 8;
        popoverLeft = e.clientX - cr.left + 8;
      } else {
        const x0 = Math.min(startInsideX, endInsideX);
        const y0 = Math.min(startInsideY, endInsideY);
        const x1 = Math.max(startInsideX, endInsideX);
        const y1 = Math.max(startInsideY, endInsideY);
        const x_pct = ((x0 - ir.left) / ir.width) * 100;
        const y_pct = ((y0 - ir.top) / ir.height) * 100;
        const w_pct = ((x1 - x0) / ir.width) * 100;
        const h_pct = ((y1 - y0) / ir.height) * 100;
        payload = { x_pct, y_pct, w_pct, h_pct };
        popoverTop = y1 - cr.top + 8;
        popoverLeft = x0 - cr.left;
      }

      const clamped = clampPopover(
        { top: popoverTop, left: popoverLeft },
        { w: 280, h: 140 },
        { w: cr.width, h: cr.height },
      );
      setComposer({ ...payload, top: clamped.top, left: clamped.left });
      return;
    }

    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    setDragging(false);
  }, []);

  const handleSaveComment = useCallback(
    (text: string) => {
      if (!composer) return;
      const anchor: Anchor = composer.w_pct !== undefined && composer.h_pct !== undefined
        ? { kind: "image_rect", x_pct: composer.x_pct, y_pct: composer.y_pct, w_pct: composer.w_pct, h_pct: composer.h_pct }
        : { kind: "image_rect", x_pct: composer.x_pct, y_pct: composer.y_pct };
      addComment(path, text, anchor).catch(() => {});
      setComposer(null);
    },
    [composer, addComment, path],
  );

  // Compute marker positions in canvas-relative px from the <img>'s current
  // bounding rect. Done in a layout effect so positions are correct before
  // paint and so we don't read refs during render. Re-runs whenever inputs
  // that affect the rect change (pan, zoom, fit, dimensions, dataUrl,
  // layoutTick from the ResizeObserver, or the threads list itself).
  const [markers, setMarkers] = useState<
    Array<{ idx: number; thread: CommentThreadType; top: number; left: number; width?: number; height?: number }>
  >([]);
  useLayoutEffect(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas || imageRectThreads.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- layout-derived state
      if (markers.length !== 0) setMarkers([]);
      return;
    }
    const ir = img.getBoundingClientRect();
    const cr = canvas.getBoundingClientRect();
    const next = imageRectThreads.map((t, idx) => {
      const left = ir.left - cr.left + (t.x_pct / 100) * ir.width;
      const top = ir.top - cr.top + (t.y_pct / 100) * ir.height;
      const width = t.w_pct !== undefined ? (t.w_pct / 100) * ir.width : undefined;
      const height = t.h_pct !== undefined ? (t.h_pct / 100) * ir.height : undefined;
      return { idx, thread: t.thread, top, left, width, height };
    });
    setMarkers(next);
  }, [imageRectThreads, pan.x, pan.y, zoom, fit, dimensions, dataUrl, layoutTick, markers.length]);

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
          type="button"
          aria-pressed={commentMode}
          aria-label={commentMode ? "Exit comment mode" : "Enter comment mode"}
          className={"image-viewer-comment-toggle" + (commentMode ? " is-active" : "")}
          onClick={() => { setCommentMode((m) => !m); setComposer(null); setDrawRect(null); }}
          style={{ marginLeft: "auto", padding: "2px 8px", border: "1px solid var(--color-border, #d0d7de)", background: commentMode ? "var(--color-accent, #0969da)" : "var(--color-surface, #f6f8fa)", color: commentMode ? "#fff" : undefined, borderRadius: 4, cursor: "pointer", fontSize: 12 }}
        >
          💬 Comment
        </button>
        <button
          type="button"
          onClick={() => setFit(!fit)}
          style={{ padding: "2px 8px", border: "1px solid var(--color-border, #d0d7de)", background: "var(--color-surface, #f6f8fa)", borderRadius: 4, cursor: "pointer", fontSize: 12 }}
        >
          {fit ? "Original size" : "Fit to view"}
        </button>
        <ZoomControl zoom={zoom} onZoomIn={zoomIn} onZoomOut={zoomOut} onReset={reset} />
      </div>
      <div
        ref={canvasRef}
        className="image-viewer-canvas"
        data-comment-mode={commentMode || undefined}
        style={{ flex: 1, overflow: "hidden", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: 16, position: "relative", cursor: commentMode ? "crosshair" : (canPan ? (dragging ? "grabbing" : "grab") : "default"), touchAction: (canPan || commentMode) ? "none" : "auto" }}
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
              pointerEvents: "none",
            }}
          />
        )}
        {/* Existing image_rect thread markers. Pointer-events: auto on each
            marker so the canvas-level pointer handlers ignore clicks that
            target a marker (the marker's own onClick handles them). */}
        {markers.map(({ idx, thread, top, left, width, height }) => {
          const number = idx + 1;
          const isRect = width !== undefined && height !== undefined;
          return (
            <button
              key={thread.root.id}
              type="button"
              className={"image-viewer-marker" + (isRect ? " is-rect" : " is-pin")}
              aria-label={`Open comment ${number}`}
              data-thread-id={thread.root.id}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setFocusedThread(thread.root.id);
              }}
              style={isRect
                ? { position: "absolute", top, left, width, height, padding: 0 }
                : { position: "absolute", top: top - 12, left: left - 12, width: 24, height: 24, padding: 0 }}
            >
              <span className="image-viewer-marker-label">{number}</span>
            </button>
          );
        })}
        {drawRect && (
          <div
            className="image-viewer-draw-preview"
            style={{ position: "absolute", top: drawRect.y, left: drawRect.x, width: drawRect.w, height: drawRect.h, pointerEvents: "none" }}
          />
        )}
        {composer && (
          <div
            className="image-viewer-composer"
            style={{ position: "absolute", top: composer.top, left: composer.left, zIndex: 10 }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <CommentInput
              onSave={handleSaveComment}
              onClose={() => setComposer(null)}
              placeholder="Comment on this region…"
            />
          </div>
        )}
      </div>
    </div>
  );
}
