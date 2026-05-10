import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MermaidRenderer } from "./MermaidRenderer";
import { clampPan } from "@/lib/pan-utils";
import { ZOOM_MAX, ZOOM_MIN } from "@/store/viewerPrefs";
import "@/styles/mermaid-view.css";

interface Props {
  content: string;
  /** Source path; forwarded to MermaidRenderer for the data-source-line walk. */
  path?: string | null;
  /**
   * Current zoom (1.0 = "fits the viewing area"). React-owned via
   * `useZoom('.mmd')` from the parent. The diagram's effective on-screen
   * scale is `zoom × fitScale`, where `fitScale = min(cw/naturalW, ch/naturalH)`
   * is recomputed from the rendered SVG. This is a deliberate departure
   * from "1.0 = natural pixels" — Mermaid SVGs have no meaningful natural
   * pixel size (vector-only), so anchoring 100% to fit-to-window matches
   * user expectations and produces a sensible default open size for both
   * tiny and oversized diagrams.
   */
  zoom: number;
  /** Setter for the zoom state. Used by wheel-zoom + pinch + Fit. */
  setZoom: (value: number) => void;
  /** When true: data-source-line walk skipped (popout). */
  readOnly?: boolean;
}

/** Cursor-anchored zoom sensitivity (unitless: deltaY * sens scales 1.0 → 1.1 per ~100px wheel tick). */
const ZOOM_SENSITIVITY = 0.001;

/** Hard cap on the SVG's baked pixel dimensions per axis. Prevents
 *  pathological cases where a tiny diagram + uncapped fit-upscale +
 *  ZOOM_MAX (8.0) could produce gigantic intrinsic sizes. Per
 *  `docs/performance.md` rule 1 (every unbounded input has a hard cap).
 *  8192 is a common GPU texture limit; staying under it keeps each
 *  axis representable as a single GPU layer if the browser promotes one. */
const MAX_BAKED_PX = 8192;

/** Idle window after which interactive `transform: scale(...)` is
 *  committed to crisp baked SVG `style.width/height`. Keeps wheel/pinch
 *  zoom on the cheap GPU compositor path during interaction; only pays
 *  the layout/paint cost once per "settle". */
const SETTLE_MS = 150;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Interaction shell for the dedicated Mermaid viewer (issue #276).
 *
 * Composes <MermaidRenderer/> inside a transform wrapper and owns wheel /
 * pointer / pinch gestures plus the pan + transform state.
 *
 * Hybrid scale model:
 *   - **Effective scale** = `zoom × fitScale`. `zoom = 1.0` ≡ fit-to-window.
 *   - **During interaction**: cheap CSS `transform: scale(effective/committed)`
 *     on the wrapper div (pan applied via `translate(...)` on the same
 *     wrapper). GPU-composited; no DOM reflow per frame.
 *   - **On settle** (150 ms idle): write the new effective scale into the
 *     SVG's intrinsic `style.width/height` and reset the wrapper's
 *     transform scale to 1. The browser re-rasterizes text /
 *     foreignObject content at the new intrinsic size → crisp output.
 *
 * Imperative refs hold the live values (pan, committed scale, fit, zoom
 * mirror) and a single `useLayoutEffect` on every render writes the
 * wrapper's `style.transform`, so React cannot stomp the value when
 * re-rendering for unrelated reasons (per
 * `.claude/agents/performance-expert/knowledge/react-rerender-optimization.md`: the
 * "pan tick = no re-render" pattern).
 */
export function MermaidCanvas({ content, path, zoom, setZoom, readOnly }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Imperative state — pan in pixels, natural svg size in CSS px,
  // latest fit scale, latest committed (baked) scale, zoom mirror.
  const panRef = useRef({ x: 0, y: 0 });
  const naturalRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const fitScaleRef = useRef(1);
  const committedScaleRef = useRef(1);
  const zoomRef = useRef(zoom);

  // Drag + pinch state. Plain refs so updates never trigger re-render.
  const draggingRef = useRef<
    { pointerId: number; baseX: number; baseY: number; startX: number; startY: number } | null
  >(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ initialDistance: number; initialZoom: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);

  // Sole React state — drives the cursor: grab vs grabbing.
  const [isDragging, setIsDragging] = useState(false);

  /** Bake `scale` into the SVG's intrinsic CSS dimensions so the browser
   *  re-rasterizes text/foreignObject at the new size (crisp). Capped at
   *  MAX_BAKED_PX per axis with aspect preserved. */
  const applyScaleToSvg = (scale: number): number => {
    const svg = svgRef.current;
    const nat = naturalRef.current;
    if (!svg || nat.w <= 0 || nat.h <= 0) return scale;
    let w = nat.w * scale;
    let h = nat.h * scale;
    if (w > MAX_BAKED_PX || h > MAX_BAKED_PX) {
      const k = Math.min(MAX_BAKED_PX / w, MAX_BAKED_PX / h);
      w *= k;
      h *= k;
    }
    svg.style.maxWidth = "none";
    svg.style.width = `${w}px`;
    svg.style.height = `${h}px`;
    // Return the actually-applied scale (may differ from input when capped)
    // so the caller can keep `committedScaleRef` in sync.
    return nat.w > 0 ? w / nat.w : scale;
  };

  /** Imperative transform writer. The wrapper owns translate (pan) AND a
   *  scale ratio (`effective / committed`) that bridges the gap between
   *  the user's current effective scale and the most recently baked SVG
   *  size. After settle, ratio = 1 and the transform is translate-only.
   *
   *  Reads `zoomRef.current` (not the `zoom` prop) so the function
   *  remains correct when invoked from a closure captured at mount —
   *  e.g. the ResizeObserver callback in the `[]`-deps useEffect below
   *  closes over the first render's `applyTransform`. Routing through
   *  the per-render-updated ref defeats that stale-closure trap. */
  const applyTransform = () => {
    const el = transformRef.current;
    if (!el) return;
    const effective = zoomRef.current * fitScaleRef.current;
    const committed = committedScaleRef.current || 1;
    const ratio = effective / committed;
    el.style.transform = `translate(${panRef.current.x}px, ${panRef.current.y}px) scale(${ratio})`;
  };

  const scheduleApply = () => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      applyTransform();
    });
  };

  /** Debounced "settle" — after `SETTLE_MS` of no zoom changes, commit
   *  the current effective scale into the SVG's intrinsic dimensions and
   *  reset the wrapper's transform scale to 1. Cheap no-op when the
   *  effective scale already equals the committed scale. */
  const scheduleSettle = () => {
    if (settleTimerRef.current !== null) {
      clearTimeout(settleTimerRef.current);
    }
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      const effective = zoomRef.current * fitScaleRef.current;
      if (Math.abs(effective - committedScaleRef.current) < 1e-6) return;
      const applied = applyScaleToSvg(effective);
      committedScaleRef.current = applied;
      applyTransform();
    }, SETTLE_MS);
  };

  // Mirror the latest zoom into a ref so the deferred settle callback
  // reads fresh state, then write transform + schedule settle. Runs every
  // render (any React re-render — theme switch, parent re-render, etc.
  // — would otherwise leave the imperatively-written transform stale).
  useLayoutEffect(() => {
    zoomRef.current = zoom;
    applyTransform();
    scheduleSettle();
  });

  // Reset pan when content changes (new diagram → start centered). Path
  // change comes for free since the parent re-keys content too, but reset
  // also when only path changes for safety.
  useEffect(() => {
    panRef.current = { x: 0, y: 0 };
    applyTransform();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyTransform intentionally reads live refs
  }, [content, path]);

  // Cleanup pending rAF + settle timer on unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current);
    };
  }, []);

  // SVG-ready callback — fires when MermaidRenderer injects the rendered
  // SVG. Captures natural size (preferring `viewBox` for accuracy, falling
  // back to `getBBox()` for jsdom), recomputes fit (uncapped — small
  // diagrams scale UP to fit), bakes the current effective scale into the
  // SVG's intrinsic dimensions, and re-clamps pan against the new natural
  // size. Theme switches re-render mermaid (new SVG, possibly different
  // bbox) without changing `zoom` or container dimensions, so the
  // existing `[zoom]` and ResizeObserver re-clamp paths can miss the
  // change — re-clamping here covers them.
  const handleSvgReady = useCallback((svg: SVGSVGElement) => {
    svgRef.current = svg;
    // Defeat mermaid's inline `style="max-width: 100%; ..."` so the SVG
    // can grow past its natural rendered size when we bake larger dims.
    svg.style.maxWidth = "none";

    let natW = 0;
    let natH = 0;
    const vb = svg.viewBox?.baseVal;
    if (vb && vb.width > 0 && vb.height > 0) {
      natW = vb.width;
      natH = vb.height;
    } else {
      try {
        const b = svg.getBBox();
        natW = b.width;
        natH = b.height;
      } catch {
        return; // jsdom without getBBox shim — bail silently.
      }
    }
    if (natW <= 0 || natH <= 0) return;
    naturalRef.current = { w: natW, h: natH };

    const c = containerRef.current;
    const cw = c?.clientWidth ?? 0;
    const ch = c?.clientHeight ?? 0;
    if (cw <= 0 || ch <= 0) return;
    // No `, 1` cap — fit > 1 is allowed so small diagrams scale UP to
    // fill the viewport. Effective scale is then capped on the user-
    // facing side via ZOOM_MIN/MAX × fit.
    const fit = Math.min(cw / natW, ch / natH);
    fitScaleRef.current = fit;

    const effective = zoomRef.current * fit;
    const applied = applyScaleToSvg(effective);
    committedScaleRef.current = applied;

    // Re-clamp pan against the new natural+effective. Pan was set in
    // user-pixel space at a previous (now-stale) scale and may sit
    // outside the new permissible window.
    const next = clampPan(panRef.current, { w: cw, h: ch }, naturalRef.current, effective);
    panRef.current = next;
    applyTransform();
  }, []);

  // Re-clamp pan whenever zoom changes (Fit / Reset / chrome shortcuts /
  // popout open) so a previously-allowed pan offset can't leave the diagram
  // off-screen at the new scale. NOT a layout effect — running after paint
  // is fine because applyTransform() in the per-render layout effect above
  // has already painted at the new zoom; this just nudges pan back inside
  // the new limits and triggers one more transform write.
  useEffect(() => {
    const c = containerRef.current;
    const nat = naturalRef.current;
    if (!c || nat.w <= 0 || nat.h <= 0) return;
    const effective = zoom * fitScaleRef.current;
    const next = clampPan(
      panRef.current,
      { w: c.clientWidth, h: c.clientHeight },
      nat,
      effective,
    );
    if (next.x !== panRef.current.x || next.y !== panRef.current.y) {
      panRef.current = next;
      applyTransform();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyTransform reads live refs/zoom
  }, [zoom]);

  // ResizeObserver — recompute fit, re-bake SVG dims at the new effective
  // scale (so a window resize keeps the diagram sized to the new viewport
  // even when the user has not touched zoom), and re-clamp pan. We do NOT
  // rate-limit further — ResizeObserver itself is throttled by the browser.
  useEffect(() => {
    const c = containerRef.current;
    if (!c || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const nat = naturalRef.current;
      if (nat.w <= 0 || nat.h <= 0) return;
      const cw = c.clientWidth;
      const ch = c.clientHeight;
      if (cw <= 0 || ch <= 0) return;
      const fit = Math.min(cw / nat.w, ch / nat.h);
      fitScaleRef.current = fit;
      const effective = zoomRef.current * fit;
      const applied = applyScaleToSvg(effective);
      committedScaleRef.current = applied;
      // Re-clamp pan against the new container dims at current effective
      // scale so shrinking the window doesn't leave the diagram off-screen.
      const next = clampPan(panRef.current, { w: cw, h: ch }, nat, effective);
      if (next.x !== panRef.current.x || next.y !== panRef.current.y) {
        panRef.current = next;
      }
      applyTransform();
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

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
      const fit = fitScaleRef.current;
      if (e.ctrlKey || e.metaKey) {
        const cx = e.clientX - rect.left - rect.width / 2 - panRef.current.x;
        const cy = e.clientY - rect.top - rect.height / 2 - panRef.current.y;
        const newZoom = clamp(zoom * (1 - e.deltaY * ZOOM_SENSITIVITY), ZOOM_MIN, ZOOM_MAX);
        if (newZoom === zoom) return;
        // Cursor-anchored math: the ratio S'/S in screen space is
        // (newZoom×fit) / (zoom×fit) = newZoom/zoom — fit cancels.
        const ratio = newZoom / zoom;
        const nextPan = {
          x: panRef.current.x + cx * (1 - ratio),
          y: panRef.current.y + cy * (1 - ratio),
        };
        const nextEffective = newZoom * fit;
        panRef.current =
          nat.w > 0 && nat.h > 0 ? clampPan(nextPan, container, nat, nextEffective) : nextPan;
        setZoom(newZoom);
        // Don't scheduleApply — setZoom triggers a render and the
        // useLayoutEffect re-applies synchronously before paint.
        return;
      }
      const dx = e.shiftKey ? -e.deltaY : 0;
      const dy = e.shiftKey ? 0 : -e.deltaY;
      const nextPan = { x: panRef.current.x + dx, y: panRef.current.y + dy };
      const effective = zoom * fit;
      panRef.current =
        nat.w > 0 && nat.h > 0 ? clampPan(nextPan, container, nat, effective) : nextPan;
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
      const effective = zoom * fitScaleRef.current;
      panRef.current = clampPan(next, { w: c.clientWidth, h: c.clientHeight }, nat, effective);
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
