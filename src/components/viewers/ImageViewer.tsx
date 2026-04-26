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
import { useImageCommentDrag } from "@/hooks/useImageCommentDrag";
import { useCollisionLayout, type CollisionItem } from "@/hooks/useCollisionLayout";
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

export function ImageViewer({ path }: Props) {
  const [fit, setFit] = useState(true);
  const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(null);
  // Drag-to-pan offset, only meaningful when zoom > 1.
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [commentMode, setCommentMode] = useState(false);
  // Bumped when layout shifts (resize, zoom, pan, fit, dimensions) so the
  // existing-thread markers re-derive their absolute pixel positions from
  // the current img bounding rect.
  const [layoutTick, setLayoutTick] = useState(0);

  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number; pointerId: number } | null>(null);
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

  const commentDrag = useImageCommentDrag({ imgRef, canvasRef, commentMode });
  const { drawRect, composer, setComposer, reset: resetCommentDrag } = commentDrag;

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
  useEffect(() => { setDimensions(null); setPan({ x: 0, y: 0 }); resetCommentDrag(); }, [path, resetCommentDrag]);

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

  // ── Pan handlers (zoom > 1, comment mode OFF) ─────────────────────────
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (commentMode) {
      commentDrag.onPointerDown(e);
      return;
    }
    if (!canPan) return;
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: pan.x, baseY: pan.y, pointerId: e.pointerId };
    setDragging(true);
  }, [canPan, commentMode, pan.x, pan.y, commentDrag]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (commentDrag.isActive(e.pointerId)) {
      commentDrag.onPointerMove(e);
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
  }, [zoom, commentDrag]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (commentDrag.isActive(e.pointerId)) {
      commentDrag.onPointerUp(e);
      return;
    }
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    setDragging(false);
  }, [commentDrag]);

  const handlePointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (commentDrag.isActive(e.pointerId)) {
      commentDrag.onPointerCancel(e);
      return;
    }
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* jsdom */ }
    dragRef.current = null;
    setDragging(false);
  }, [commentDrag]);

  const handleSaveComment = useCallback(
    (text: string) => {
      if (!composer) return;
      const anchor: Anchor = composer.w_pct !== undefined && composer.h_pct !== undefined
        ? { kind: "image_rect", x_pct: composer.x_pct, y_pct: composer.y_pct, w_pct: composer.w_pct, h_pct: composer.h_pct }
        : { kind: "image_rect", x_pct: composer.x_pct, y_pct: composer.y_pct };
      addComment(path, text, anchor).catch(() => {});
      setComposer(null);
    },
    [composer, addComment, path, setComposer],
  );

  // Compute marker positions in canvas-relative px from the <img>'s current
  // bounding rect. Done in a layout effect so positions are correct before
  // paint and so we don't read refs during render. Re-runs whenever inputs
  // that affect the rect change (pan, zoom, fit, dimensions, dataUrl,
  // layoutTick from the ResizeObserver, or the threads list itself).
  // x_pct/y_pct/w_pct/h_pct are NORMALIZED FRACTIONS in [0,1] (matches the
  // Rust `image_rect` resolver contract — see core/anchors/image_rect.rs).
  const [markers, setMarkers] = useState<
    Array<{ idx: number; thread: CommentThreadType; top: number; left: number; width?: number; height?: number }>
  >([]);
  useLayoutEffect(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) {
      // setMarkers([]) against an already-empty array bails out via Object.is.
      setMarkers([]);
      return;
    }
    const ir = img.getBoundingClientRect();
    const cr = canvas.getBoundingClientRect();
    const next = imageRectThreads.map((t, idx) => {
      const left = ir.left - cr.left + t.x_pct * ir.width;
      const top = ir.top - cr.top + t.y_pct * ir.height;
      const width = t.w_pct !== undefined ? t.w_pct * ir.width : undefined;
      const height = t.h_pct !== undefined ? t.h_pct * ir.height : undefined;
      return { idx, thread: t.thread, top, left, width, height };
    });
    setMarkers(next);
  }, [imageRectThreads, pan.x, pan.y, zoom, fit, dimensions, dataUrl, layoutTick]);

  // Collision layout: stack 2-3 overlapping markers; collapse ≥4 into +N.
  const collisionItems = useMemo<CollisionItem[]>(
    () => markers.map((m) => ({
      id: m.thread.root.id,
      rect: { top: m.top, left: m.left, width: m.width, height: m.height },
    })),
    [markers],
  );
  const layoutGroups = useCollisionLayout(collisionItems);
  const markersById = useMemo(() => {
    const map = new Map<string, typeof markers[number]>();
    for (const m of markers) map.set(m.thread.root.id, m);
    return map;
  }, [markers]);

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
          onClick={() => { setCommentMode((m) => !m); commentDrag.reset(); }}
          style={{ marginLeft: "auto", padding: "2px 8px", border: "1px solid var(--color-border, #d0d7de)", borderRadius: 4, cursor: "pointer", fontSize: 12 }}
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
        onPointerCancel={handlePointerCancel}
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
            target a marker (the marker's own onClick handles them).

            Markers are routed through useCollisionLayout so that 2-3
            overlapping markers stack with a small offset and ≥4 collide
            into a single "+N" cluster badge. */}
        {layoutGroups.map((group) => {
          if (group.kind === "cluster") {
            const { rect: cr, count, ids } = group;
            return (
              <button
                key={`cluster:${ids.join(",")}`}
                type="button"
                className="image-viewer-cluster-badge"
                aria-label={`${count} comments at this location`}
                data-cluster-count={count}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setFocusedThread(ids[0]); }}
                style={{ position: "absolute", top: cr.top, left: cr.left, padding: 0 }}
              >+{count}</button>
            );
          }
          const id = group.kind === "single" ? group.id : group.ids[group.offsetIndex];
          const marker = markersById.get(id);
          if (!marker) return null;
          const { idx, thread, top, left, width, height } = marker;
          const number = idx + 1;
          const isRect = width !== undefined && height !== undefined;
          const stackOff = group.kind === "stack" ? group.offsetIndex * 6 : 0;
          const baseStyle = isRect
            ? { position: "absolute" as const, top, left, width, height, padding: 0 }
            : { position: "absolute" as const, top: top - 12, left: left - 12, width: 24, height: 24, padding: 0 };
          const style = stackOff
            ? { ...baseStyle, transform: `translate(${stackOff}px, ${stackOff}px)` }
            : baseStyle;
          return (
            <button
              key={thread.root.id}
              type="button"
              className={"image-viewer-marker" + (isRect ? " is-rect" : " is-pin")}
              aria-label={`Open comment ${number}`}
              data-thread-id={thread.root.id}
              data-stack-index={group.kind === "stack" ? group.offsetIndex : undefined}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); setFocusedThread(thread.root.id); }}
              style={style}
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
