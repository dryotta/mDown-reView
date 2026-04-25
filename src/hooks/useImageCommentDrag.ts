import { useCallback, useRef, useState, type PointerEventHandler, type RefObject } from "react";

/** Drag-distance below which a pointerup is treated as a click (single-point pin). */
const DRAG_THRESHOLD_PX = 4;

export interface ComposerState {
  /** Anchor coordinates already normalized to the natural image as fractions in [0,1]. */
  x_pct: number;
  y_pct: number;
  w_pct?: number;
  h_pct?: number;
  /** Popover position (canvas-relative px, post-clamp). */
  top: number;
  left: number;
}

interface DrawRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CommentDrag {
  startClientX: number;
  startClientY: number;
  pointerId: number;
  moved: boolean;
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

interface UseImageCommentDragOpts {
  imgRef: RefObject<HTMLImageElement | null>;
  canvasRef: RefObject<HTMLDivElement | null>;
  /** When false, the hook becomes inert (handlers no-op). */
  commentMode: boolean;
}

export interface UseImageCommentDragReturn {
  drawRect: DrawRect | null;
  composer: ComposerState | null;
  setComposer: (next: ComposerState | null) => void;
  /** Reset all transient state (clears composer + drawRect + in-flight drag). */
  reset: () => void;
  /** True iff a comment-mode pointer interaction is currently active. */
  isActive: (pointerId: number) => boolean;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onPointerMove: PointerEventHandler<HTMLDivElement>;
  onPointerUp: PointerEventHandler<HTMLDivElement>;
  onPointerCancel: PointerEventHandler<HTMLDivElement>;
}

/**
 * Owns comment-mode pointer authoring on the ImageViewer canvas: click→pin or
 * drag→rect. Emits coordinates as 0..1 fractions of the displayed image rect,
 * matching the Rust `image_rect` resolver contract (see
 * `src-tauri/src/core/anchors/image_rect.rs`).
 *
 * The hook is inert when `commentMode === false`; the caller still wires the
 * returned handlers and routes pan/non-comment behaviour around them.
 */
export function useImageCommentDrag(
  opts: UseImageCommentDragOpts,
): UseImageCommentDragReturn {
  const { imgRef, canvasRef, commentMode } = opts;
  const [drawRect, setDrawRect] = useState<DrawRect | null>(null);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const dragRef = useRef<CommentDrag | null>(null);

  const isActive = useCallback(
    (pointerId: number) => dragRef.current?.pointerId === pointerId,
    [],
  );

  const reset = useCallback(() => {
    dragRef.current = null;
    setDrawRect(null);
    setComposer(null);
  }, []);

  const onPointerDown = useCallback<PointerEventHandler<HTMLDivElement>>(
    (e) => {
      if (!commentMode) return;
      const img = imgRef.current;
      if (!img) return;
      const ir = img.getBoundingClientRect();
      // Only start authoring when the down lands inside the displayed image.
      if (e.clientX < ir.left || e.clientX > ir.right || e.clientY < ir.top || e.clientY > ir.bottom) return;
      e.preventDefault();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* jsdom */ }
      dragRef.current = {
        startClientX: e.clientX,
        startClientY: e.clientY,
        pointerId: e.pointerId,
        moved: false,
      };
    },
    [commentMode, imgRef],
  );

  const onPointerMove = useCallback<PointerEventHandler<HTMLDivElement>>(
    (e) => {
      const cd = dragRef.current;
      if (!cd || cd.pointerId !== e.pointerId) return;
      const dx = e.clientX - cd.startClientX;
      const dy = e.clientY - cd.startClientY;
      if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
        cd.moved = true;
      }
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
    },
    [canvasRef],
  );

  const onPointerUp = useCallback<PointerEventHandler<HTMLDivElement>>(
    (e) => {
      const cd = dragRef.current;
      if (!cd || cd.pointerId !== e.pointerId) return;
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* jsdom */ }
      dragRef.current = null;
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

      // Coordinates are normalized to [0,1] fractions of the displayed image
      // rect — matches the Rust `image_rect` resolver contract.
      if (!isDrag) {
        const x_pct = (endInsideX - ir.left) / ir.width;
        const y_pct = (endInsideY - ir.top) / ir.height;
        payload = { x_pct, y_pct };
        popoverTop = e.clientY - cr.top + 8;
        popoverLeft = e.clientX - cr.left + 8;
      } else {
        const x0 = Math.min(startInsideX, endInsideX);
        const y0 = Math.min(startInsideY, endInsideY);
        const x1 = Math.max(startInsideX, endInsideX);
        const y1 = Math.max(startInsideY, endInsideY);
        const x_pct = (x0 - ir.left) / ir.width;
        const y_pct = (y0 - ir.top) / ir.height;
        const w_pct = (x1 - x0) / ir.width;
        const h_pct = (y1 - y0) / ir.height;
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
    },
    [imgRef, canvasRef],
  );

  // pointercancel must NOT open a composer — a canceled gesture (touch
  // interrupt, capture loss, app switch) is not authorial intent.
  const onPointerCancel = useCallback<PointerEventHandler<HTMLDivElement>>(
    (e) => {
      const cd = dragRef.current;
      if (!cd || cd.pointerId !== e.pointerId) return;
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* jsdom */ }
      dragRef.current = null;
      setDrawRect(null);
    },
    [],
  );

  return {
    drawRect,
    composer,
    setComposer,
    reset,
    isActive,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  };
}
