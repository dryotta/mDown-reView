/**
 * R2 — clamp pan so the image never leaves the viewport entirely. Limits are
 * symmetric: when the (zoomed) image is wider than the container, pan.x is
 * allowed within ±overflow/2; otherwise pinned at 0. Same for y.
 *
 * Used by both ImageViewer and MermaidCanvas (issue #276).
 */
export function clampPan(
  pan: { x: number; y: number },
  container: { w: number; h: number },
  content: { w: number; h: number },
  zoom: number,
): { x: number; y: number } {
  const scaledW = content.w * zoom;
  const scaledH = content.h * zoom;
  const overflowX = Math.max(0, scaledW - container.w);
  const overflowY = Math.max(0, scaledH - container.h);
  const limitX = overflowX / 2;
  const limitY = overflowY / 2;
  return {
    x: Math.max(-limitX, Math.min(limitX, pan.x)),
    y: Math.max(-limitY, Math.min(limitY, pan.y)),
  };
}
