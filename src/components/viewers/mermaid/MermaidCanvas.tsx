import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MermaidRenderer } from "./MermaidRenderer";
import { clampPan } from "@/lib/pan-utils";
import { ZOOM_MAX, ZOOM_MIN } from "@/store/viewerPrefs";
import "@/styles/mermaid-view.css";

interface Props {
  content: string;
  /** Source path; forwarded to MermaidRenderer for the data-source-line walk. */
  path?: string | null;
  /** Current zoom (1.0 = 100%). React-owned via useZoom('.mmd') from the parent. */
  zoom: number;
  /** Setter for the zoom state. Used by wheel-zoom + pinch + Fit. */
  setZoom: (value: number) => void;
  /** When true: data-source-line walk skipped (popout). */
  readOnly?: boolean;
  /**
   * Called once per content change with the computed fit-to-window scale.
   * Caller decides whether to seed setZoom (avoid clobbering shared zoom on
   * subsequent opens).
   */
  onFitMeasured?: (fitScale: number) => void;
}

/** Cursor-anchored zoom sensitivity (unitless: deltaY * sens scales 1.0 → 1.1 per ~100px wheel tick). */
const ZOOM_SENSITIVITY = 0.001;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Interaction shell for the dedicated Mermaid viewer (issue #276).
 *
 * Composes <MermaidRenderer/> inside a transform wrapper and owns wheel /
 * pointer / pinch gestures plus the pan + transform state. Pan and zoom are
 * applied imperatively — refs hold the live values, a single
 * useLayoutEffect on every render writes `style.transform` so React cannot
 * stomp the value when re-rendering for unrelated reasons (per
 * `docs/best-practices-common/react/rerender-optimization.md`: the
 * "pan tick = no re-render" pattern).
 */
export function MermaidCanvas({ content, path, zoom, setZoom, readOnly, onFitMeasured }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<HTMLDivElement>(null);

  // Imperative state — pan in pixels, natural svg bbox, latest fit scale.
  const panRef = useRef({ x: 0, y: 0 });
  const naturalRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const fitScaleRef = useRef(1);

  // Drag + pinch state. Plain refs so updates never trigger re-render.
  const draggingRef = useRef<
    { pointerId: number; baseX: number; baseY: number; startX: number; startY: number } | null
  >(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ initialDistance: number; initialZoom: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  // Sole React state — drives the cursor: grab vs grabbing.
  const [isDragging, setIsDragging] = useState(false);

  // Imperative transform writer. Reads zoom prop directly from closure.
  const applyTransform = () => {
    const el = transformRef.current;
    if (!el) return;
    el.style.transform = `translate(${panRef.current.x}px, ${panRef.current.y}px) scale(${zoom})`;
  };

  const scheduleApply = () => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      applyTransform();
    });
  };

  // Re-apply on every render. Any React render (theme switch, parent
  // re-render, etc.) would otherwise reset the imperatively-written
  // transform back to "" because the wrapper div has no inline style.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: runs every render
  useLayoutEffect(() => {
    applyTransform();
  });

  // Reset pan when content changes (new diagram → start centered). Path
  // change comes for free since the parent re-keys content too, but reset
  // also when only path changes for safety.
  useEffect(() => {
    panRef.current = { x: 0, y: 0 };
    applyTransform();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyTransform intentionally reads live refs
  }, [content, path]);

  // Cleanup pending rAF on unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Fit-to-window measurement — invoked when MermaidRenderer injects the
  // <svg/>. Captures natural bbox into naturalRef (used by clampPan) and
  // emits the computed fit scale through onFitMeasured. The parent decides
  // whether to seed setZoom — this component never auto-applies it.
  const handleSvgReady = useCallback((svg: SVGSVGElement) => {
    let bbox: { width: number; height: number };
    try {
      const b = svg.getBBox();
      bbox = { width: b.width, height: b.height };
    } catch {
      return; // jsdom without getBBox shim — bail silently.
    }
    if (bbox.width <= 0 || bbox.height <= 0) return;
    naturalRef.current = { w: bbox.width, h: bbox.height };
    const c = containerRef.current;
    const cw = c?.clientWidth ?? 0;
    const ch = c?.clientHeight ?? 0;
    if (cw <= 0 || ch <= 0) return;
    const fit = Math.min(cw / bbox.width, ch / bbox.height, 1);
    fitScaleRef.current = fit;
    onFitMeasured?.(fit);
  }, [onFitMeasured]);

  // ResizeObserver — recompute fit when the container resizes. We DO NOT
  // auto-apply; the parent owns the seed-vs-keep decision.
  useEffect(() => {
    const c = containerRef.current;
    if (!c || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const nat = naturalRef.current;
      if (nat.w <= 0 || nat.h <= 0) return;
      const cw = c.clientWidth;
      const ch = c.clientHeight;
      if (cw <= 0 || ch <= 0) return;
      const fit = Math.min(cw / nat.w, ch / nat.h, 1);
      fitScaleRef.current = fit;
      onFitMeasured?.(fit);
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, [onFitMeasured]);

  // Wheel — preventDefault always (we own scroll inside the canvas).
  // ctrl/meta = cursor-anchored zoom; shift = horizontal pan; else vertical.
  // Native addEventListener with { passive: false } — React's onWheel
  // attaches passive in modern React, blocking preventDefault.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const container = { w: el.clientWidth || rect.width, h: el.clientHeight || rect.height };
      const nat = naturalRef.current;
      if (e.ctrlKey || e.metaKey) {
        const cx = e.clientX - rect.left - rect.width / 2 - panRef.current.x;
        const cy = e.clientY - rect.top - rect.height / 2 - panRef.current.y;
        const newZoom = clamp(zoom * (1 - e.deltaY * ZOOM_SENSITIVITY), ZOOM_MIN, ZOOM_MAX);
        if (newZoom === zoom) return;
        const ratio = newZoom / zoom;
        const nextPan = {
          x: panRef.current.x + cx * (1 - ratio),
          y: panRef.current.y + cy * (1 - ratio),
        };
        panRef.current = nat.w > 0 && nat.h > 0 ? clampPan(nextPan, container, nat, newZoom) : nextPan;
        setZoom(newZoom);
        // Don't scheduleApply — setZoom triggers a render and the
        // useLayoutEffect re-applies synchronously before paint.
        return;
      }
      const dx = e.shiftKey ? -e.deltaY : 0;
      const dy = e.shiftKey ? 0 : -e.deltaY;
      const nextPan = { x: panRef.current.x + dx, y: panRef.current.y + dy };
      panRef.current =
        nat.w > 0 && nat.h > 0 ? clampPan(nextPan, container, nat, zoom) : nextPan;
      scheduleApply();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom, setZoom]);

  // ── Pointer handlers (mirror ImageViewer.tsx:61-98) ──────────────────
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      // Switch to pinch mode — record initial distance + zoom.
      const pts = Array.from(pointersRef.current.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      pinchRef.current = { initialDistance: Math.hypot(dx, dy) || 1, initialZoom: zoom };
      // Cancel any in-flight drag.
      draggingRef.current = null;
      setIsDragging(false);
      return;
    }
    if (!e.isPrimary) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* jsdom */ }
    draggingRef.current = {
      pointerId: e.pointerId,
      baseX: panRef.current.x,
      baseY: panRef.current.y,
      startX: e.clientX,
      startY: e.clientY,
    };
    setIsDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    const pinch = pinchRef.current;
    if (pinch && pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const dist = Math.hypot(dx, dy) || 1;
      const newZoom = clamp(
        pinch.initialZoom * (dist / pinch.initialDistance),
        ZOOM_MIN,
        ZOOM_MAX,
      );
      if (newZoom !== zoom) setZoom(newZoom);
      return;
    }
    const d = draggingRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const next = {
      x: d.baseX + (e.clientX - d.startX),
      y: d.baseY + (e.clientY - d.startY),
    };
    const c = containerRef.current;
    const nat = naturalRef.current;
    if (c && nat.w > 0 && nat.h > 0) {
      panRef.current = clampPan(next, { w: c.clientWidth, h: c.clientHeight }, nat, zoom);
    } else {
      panRef.current = next;
    }
    scheduleApply();
  };

  const releasePointer = (e: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    const d = draggingRef.current;
    if (d && d.pointerId === e.pointerId) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* jsdom */ }
      draggingRef.current = null;
      setIsDragging(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`mermaid-canvas mermaid-canvas--interactive${isDragging ? " mermaid-canvas--dragging" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={releasePointer}
      onPointerCancel={releasePointer}
    >
      <div ref={transformRef} className="mermaid-canvas-transform">
        <MermaidRenderer content={content} path={path} readOnly={readOnly} onSvgReady={handleSvgReady} />
      </div>
    </div>
  );
}
