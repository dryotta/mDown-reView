import { useRef, useState, type PointerEvent, type RefObject } from "react";
import { useStore } from "@/store";
import "@/styles/reading-width.css";

export const READING_WIDTH_MIN = 400;
export const READING_WIDTH_MAX = 1600;

interface Props {
  /** Ref to the `.reading-width` container element being resized. */
  containerRef: RefObject<HTMLElement | null>;
  /**
   * Which edge of the container this handle pins to. Defaults to "right".
   * When "left", the cursor delta is sign-flipped so dragging outward (to
   * the left) grows the column — mirroring the right handle's behaviour and
   * keeping the column symmetric (spec #41 line 107).
   */
  side?: "left" | "right";
}

interface DragState {
  startX: number;
  startWidth: number;
  latest: number;
}

/**
 * Vertical drag handle pinned to one edge of a `.reading-width` container.
 * Writes `--reading-width` directly to the container element during
 * pointermove (avoiding React re-renders on every frame), and only commits
 * to the Zustand store on pointerup.
 *
 * Multiplier of 2 on cursor delta: the container is centered with
 * `margin: 0 auto`, so growing N px on one edge requires the width to grow
 * 2N to keep that edge tracking the cursor.
 *
 * Sign convention:
 *   right handle: width grows when cursor moves RIGHT  → +(clientX - startX)
 *   left  handle: width grows when cursor moves LEFT   → +(startX - clientX)
 */
export function ReadingWidthHandle({ containerRef, side = "right" }: Props) {
  const setReadingWidth = useStore((s) => s.setReadingWidth);
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;
    const startWidth = container.getBoundingClientRect().width;
    dragRef.current = { startX: e.clientX, startWidth, latest: startWidth };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const container = containerRef.current;
    if (!drag || !container) return;
    const cursorDelta = side === "left" ? drag.startX - e.clientX : e.clientX - drag.startX;
    const raw = drag.startWidth + cursorDelta * 2;
    const clamped = Math.max(READING_WIDTH_MIN, Math.min(READING_WIDTH_MAX, raw));
    drag.latest = clamped;
    container.style.setProperty("--reading-width", `${clamped}px`);
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setReadingWidth(drag.latest);
    dragRef.current = null;
    setDragging(false);
  };

  return (
    <div
      className="reading-width-handle"
      data-side={side}
      role="separator"
      aria-orientation="vertical"
      aria-label={side === "left" ? "Resize reading width (left edge)" : "Resize reading width"}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}
