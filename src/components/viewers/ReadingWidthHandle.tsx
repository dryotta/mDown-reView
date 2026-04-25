import { useRef, useState, type PointerEvent, type RefObject } from "react";
import { useStore } from "@/store";
import "@/styles/reading-width.css";

export const READING_WIDTH_MIN = 400;
export const READING_WIDTH_MAX = 1600;

interface Props {
  /** Ref to the `.reading-width` container element being resized. */
  containerRef: RefObject<HTMLElement | null>;
}

interface DragState {
  startX: number;
  startWidth: number;
  latest: number;
}

/**
 * Vertical drag handle pinned to the right edge of a `.reading-width`
 * container. Writes `--reading-width` directly to the container element
 * during pointermove (avoiding React re-renders on every frame), and only
 * commits to the Zustand store on pointerup.
 *
 * Multiplier of 2 on cursor delta: the container is centered with
 * `margin: 0 auto`, so growing N px on the right edge requires the width
 * to grow 2N to keep the right edge tracking the cursor.
 */
export function ReadingWidthHandle({ containerRef }: Props) {
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
    const raw = drag.startWidth + (e.clientX - drag.startX) * 2;
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
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize reading width"
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}
