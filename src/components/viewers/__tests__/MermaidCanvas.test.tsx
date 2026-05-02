import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup, fireEvent, act } from "@testing-library/react";
import { ZOOM_MAX } from "@/store/viewerPrefs";

// ── Mocks (must be hoisted) ──────────────────────────────────────────
vi.mock("@/lib/mermaid-singleton", () => ({
  renderMermaid: vi.fn().mockResolvedValue({
    svg: '<svg xmlns="http://www.w3.org/2000/svg" data-test="mermaid"><g class="node"></g></svg>',
  }),
}));
vi.mock("@/hooks/useTheme", () => ({ useTheme: () => "light" }));

import { MermaidCanvas } from "../mermaid/MermaidCanvas";

// ── jsdom shims required by MermaidCanvas + MermaidRenderer ──────────
const RECT = {
  left: 100,
  top: 50,
  width: 800,
  height: 600,
  right: 900,
  bottom: 650,
  x: 100,
  y: 50,
  toJSON: () => ({}),
};

let originalRAF: typeof window.requestAnimationFrame;
let originalCAF: typeof window.cancelAnimationFrame;
let originalRO: typeof window.ResizeObserver | undefined;
let originalGetBBox: PropertyDescriptor | undefined;
let originalClientWidth: PropertyDescriptor | undefined;
let originalClientHeight: PropertyDescriptor | undefined;
let originalGetBoundingClientRect: PropertyDescriptor | undefined;
const capturedROCallbacks: ResizeObserverCallback[] = [];

beforeEach(() => {
  cleanup();
  capturedROCallbacks.length = 0;

  // rAF — run synchronously so scheduleApply() flushes before assertions.
  originalRAF = window.requestAnimationFrame;
  originalCAF = window.cancelAnimationFrame;
  window.requestAnimationFrame = function rafSync(cb: FrameRequestCallback): number {
    cb(0);
    return 1;
  } as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = function cafNoop(): void {} as typeof window.cancelAnimationFrame;

  // ResizeObserver — jsdom omits it. Use a real class (vitest warns when
  // vi.fn() is invoked with `new`). Capture the ctor callback per-instance
  // on the instance itself so individual specs can opt into firing it
  // (the stale-closure regression test in particular). The ctor signature
  // must match the spec: `new ResizeObserver(cb)` is what production code
  // uses.
  originalRO = window.ResizeObserver;
  class StubResizeObserver {
    public callback: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.callback = cb;
      capturedROCallbacks.push(cb);
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(window, "ResizeObserver", {
    writable: true,
    configurable: true,
    value: StubResizeObserver,
  });

  // SVG getBBox — used by handleSvgReady to compute fit.
  originalGetBBox = Object.getOwnPropertyDescriptor(SVGElement.prototype, "getBBox");
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 2000, height: 1500 }),
  });

  // clientWidth/Height — stubbed on the prototype so the canvas div reports
  // 800×600 (zero by default in jsdom, which would short-circuit fit calc).
  originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 });

  originalGetBoundingClientRect = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "getBoundingClientRect",
  );
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => RECT,
  });
});

afterEach(() => {
  window.requestAnimationFrame = originalRAF;
  window.cancelAnimationFrame = originalCAF;
  if (originalRO) {
    Object.defineProperty(window, "ResizeObserver", { writable: true, configurable: true, value: originalRO });
  } else {
    delete (window as unknown as { ResizeObserver?: unknown }).ResizeObserver;
  }
  if (originalGetBBox) Object.defineProperty(SVGElement.prototype, "getBBox", originalGetBBox);
  else delete (SVGElement.prototype as unknown as { getBBox?: unknown }).getBBox;
  if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
  if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
  if (originalGetBoundingClientRect)
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", originalGetBoundingClientRect);
});

// Helper — render with controlled props and stub pointer-capture on the canvas.
async function renderCanvas(overrides: {
  zoom?: number;
  setZoom?: (v: number) => void;
  content?: string;
  path?: string | null;
} = {}) {
  const setZoom = overrides.setZoom ?? vi.fn();
  const utils = render(
    <MermaidCanvas
      content={overrides.content ?? "graph TD; A --> B"}
      path={overrides.path ?? null}
      zoom={overrides.zoom ?? 1}
      setZoom={setZoom}
    />,
  );
  // Wait for the async renderMermaid → useLayoutEffect → svg injection.
  await waitFor(() => {
    expect(utils.container.querySelector("svg")).not.toBeNull();
  });
  const canvas = utils.container.querySelector(".mermaid-canvas") as HTMLDivElement;
  const transform = utils.container.querySelector(".mermaid-canvas-transform") as HTMLDivElement;
  // Stub pointer-capture for jsdom (mirror ImageViewer.test.tsx:76-77).
  canvas.setPointerCapture = vi.fn();
  canvas.releasePointerCapture = vi.fn();
  return { ...utils, canvas, transform, setZoom };
}

describe("MermaidCanvas — composition", () => {
  it("renders <MermaidRenderer/> inside the transform wrapper with content/path forwarded", async () => {
    const { container, transform } = await renderCanvas({ content: "graph TD; A --> B", path: "/x.md" });
    // MermaidRenderer's signature element is the title="Mermaid diagram" div.
    expect(container.querySelector('[title="Mermaid diagram"]')).not.toBeNull();
    // The renderer is inside the transform target (so transforms cascade onto it).
    expect(transform.contains(container.querySelector('[title="Mermaid diagram"]'))).toBe(true);
  });

  it("applies the initial transform on render and bakes scale into SVG dimensions", async () => {
    // Hybrid scale model: scale is baked into svg.style.width/height
    // (committed scale), and the wrapper transform's scale = effective /
    // committed. After handleSvgReady, committed = effective = zoom × fit
    // = 1 × 0.4 = 0.4, so transform scale ratio = 1.
    const { container, transform } = await renderCanvas({ zoom: 1 });
    expect(transform.style.transform).toContain("translate(0px, 0px)");
    expect(transform.style.transform).toContain("scale(1)");
    const svg = container.querySelector("svg") as SVGSVGElement;
    // bbox 2000×1500 baked at scale 0.4 → 800×600 (fits the 800×600 container).
    expect(svg.style.width).toBe("800px");
    expect(svg.style.height).toBe("600px");
    // maxWidth disabled so the SVG can grow past mermaid's inline `max-width: 100%`.
    expect(svg.style.maxWidth).toBe("none");
  });
});

describe("MermaidCanvas — wheel gestures", () => {
  it("vertical wheel pans (deltaY 100 → pan.y -= 100)", async () => {
    // Start at zoom=2: under the 100%-as-fit model effective scale = 0.8,
    // scaledH=1200 vs container 600 → limitY=300, so pan -100 has room.
    // (At zoom=1 effective=fit=0.4, scaledH=container.h, limitY=0, no pan.)
    const { canvas, transform } = await renderCanvas({ zoom: 2 });
    await act(async () => {
      fireEvent.wheel(canvas, { deltaY: 100, clientX: 200, clientY: 200 });
    });
    expect(transform.style.transform).toContain("translate(0px, -100px)");
  });

  it("ctrl+wheel zooms (cursor-anchored), zooms in for deltaY < 0", async () => {
    const setZoom = vi.fn();
    const { canvas } = await renderCanvas({ zoom: 1, setZoom });
    await act(async () => {
      fireEvent.wheel(canvas, { deltaY: -100, ctrlKey: true, clientX: 200, clientY: 200 });
    });
    // newZoom = 1 * (1 - (-100)*0.001) = 1.1. The ratio S'/S = newZoom/zoom
    // (fit cancels) so the formula is identical to the old natural-scale
    // model and `setZoom` still receives the zoom value, not the effective.
    expect(setZoom).toHaveBeenCalledTimes(1);
    expect(setZoom.mock.calls[0][0]).toBeCloseTo(1.1, 5);
  });

  it("shift+wheel pans horizontally (deltaY 100 → pan.x -= 100)", async () => {
    const { canvas, transform } = await renderCanvas({ zoom: 2 });
    await act(async () => {
      fireEvent.wheel(canvas, { deltaY: 100, shiftKey: true, clientX: 200, clientY: 200 });
    });
    expect(transform.style.transform).toContain("translate(-100px, 0px)");
  });

  it("clamps zoom — never calls setZoom above ZOOM_MAX (8.0)", async () => {
    const setZoom = vi.fn();
    const { canvas } = await renderCanvas({ zoom: 7.9, setZoom });
    for (let i = 0; i < 100; i++) {
      await act(async () => {
        fireEvent.wheel(canvas, { deltaY: -1000, ctrlKey: true, clientX: 200, clientY: 200 });
      });
    }
    expect(setZoom.mock.calls.length).toBeGreaterThan(0);
    for (const call of setZoom.mock.calls) {
      expect(call[0]).toBeLessThanOrEqual(8.0);
    }
    // Strengthen the oracle: with deltaY=-1000 cursor-anchored zoom for
    // 100 ticks starting at 7.9 the loop must hit the ceiling at least
    // once.
    const maxCalled = Math.max(...setZoom.mock.calls.map((c) => c[0] as number));
    expect(maxCalled).toBeCloseTo(ZOOM_MAX, 5);
  });

  it("pinch: two pointers update zoom proportionally to distance ratio", async () => {
    const setZoom = vi.fn();
    const { canvas } = await renderCanvas({ zoom: 1, setZoom });
    // Two pointers down — initial distance = 100.
    await act(async () => {
      fireEvent.pointerDown(canvas, {
        pointerId: 1,
        clientX: 100,
        clientY: 100,
        isPrimary: true,
      });
      fireEvent.pointerDown(canvas, {
        pointerId: 2,
        clientX: 200,
        clientY: 100,
        isPrimary: false,
      });
    });
    // Move second pointer further away — new distance 200, ratio 2.0.
    await act(async () => {
      fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 300, clientY: 100 });
    });
    expect(setZoom).toHaveBeenCalled();
    const last = setZoom.mock.calls[setZoom.mock.calls.length - 1][0] as number;
    expect(last).toBeCloseTo(2.0, 5);
    // Pointer up clears pinch state — subsequent move must NOT call setZoom.
    setZoom.mockClear();
    await act(async () => {
      fireEvent.pointerUp(canvas, { pointerId: 2 });
      fireEvent.pointerUp(canvas, { pointerId: 1 });
    });
    expect(setZoom).not.toHaveBeenCalled();
  });
});

describe("MermaidCanvas — pan re-clamp on zoom change", () => {
  it("re-clamps panRef when zoom decreases past the previous limit", async () => {
    // Start at zoom=2.5 (effective = 2.5 × 0.4 = 1.0): scaledH=1500 vs
    // container 600 → limitY=450, so a wheel pan of (0,-100) is allowed.
    // Drop zoom to 1 → effective=0.4 → scaledH=600=container → limitY=0,
    // pan must snap back to (0,0) on the zoom-effect path. The wrapper
    // scale ratio drops from 1.0/1.0=1 (committed at initial bake) to
    // 0.4/1.0=0.4 (new effective / committed).
    const { canvas, transform, rerender } = await renderCanvas({ zoom: 2.5 });
    await act(async () => {
      fireEvent.wheel(canvas, { deltaY: 100, clientX: 200, clientY: 200 });
    });
    expect(transform.style.transform).toContain("translate(0px, -100px)");
    await act(async () => {
      rerender(
        <MermaidCanvas
          content="graph TD; A --> B"
          path={null}
          zoom={1}
          setZoom={vi.fn()}
        />,
      );
    });
    expect(transform.style.transform).toContain("translate(0px, 0px)");
    expect(transform.style.transform).toContain("scale(0.4)");
  });
});

describe("MermaidCanvas — resize after zoom (stale-closure regression)", () => {
  it("ResizeObserver fires after zoom change → applyTransform reads CURRENT zoom, not the mount-time closure", async () => {
    // BUG: applyTransform used to close over the `zoom` PROP from the
    // render that defined it. The ResizeObserver callback is registered
    // in a `useEffect(..., [])` (mount-once), so it captures the FIRST
    // render's applyTransform. After a zoom change, the RO would
    // - bake the SVG correctly via applyScaleToSvg(zoomRef.current × fit)
    //   (zoomRef IS updated by the per-render layout effect)
    // - but then call the stale applyTransform, which writes a CSS
    //   transform with effective = INITIAL zoom × fit.
    // Net visible effect: the wrapper's CSS scale ratio (effective /
    // committed) became (initialZoom / currentZoom), so a 4x zoom
    // displayed at ~1x after resize, a 0.5x zoom displayed at ~1x, etc.
    //
    // FIX: applyTransform reads `zoomRef.current` instead of `zoom`.
    // This regression test fires the captured RO callback after a zoom
    // re-render and asserts the resulting transform's scale ratio is 1
    // (effective ≡ committed because the RO already baked the SVG at
    // the new effective).
    //
    // Initial render at zoom=1: bbox 2000×1500 in 800×600 container →
    // fit=0.4, effective=committed=0.4, ratio=1.
    const { rerender, transform } = await renderCanvas({ zoom: 1 });
    expect(transform.style.transform).toContain("scale(1)");

    // Re-render at zoom=4. Per-render layout effect updates zoomRef=4
    // and writes scale(4) (effective=4×0.4=1.6 vs committed=0.4 → ratio=4).
    await act(async () => {
      rerender(
        <MermaidCanvas content="graph TD; A --> B" path={null} zoom={4} setZoom={vi.fn()} />,
      );
    });
    expect(transform.style.transform).toContain("scale(4)");

    // Now simulate a window resize. The container size in jsdom is
    // pinned to 800×600 by the prototype shim, so the RO callback re-
    // computes fit at the SAME 0.4 — what matters for this regression
    // is the call sequence (RO → applyScaleToSvg → applyTransform), not
    // a numeric fit change. After: applyScaleToSvg bakes at 4×0.4=1.6
    // (committedScaleRef=1.6); applyTransform must read zoomRef=4 and
    // emit ratio=1, NOT ratio=0.25 (the buggy pre-fix value where
    // applyTransform read the mount-time zoom=1 and computed
    // 1×0.4 / 1.6 = 0.25).
    expect(capturedROCallbacks.length).toBeGreaterThan(0);
    const fire = capturedROCallbacks[capturedROCallbacks.length - 1];
    await act(async () => {
      // Cast to any-ish ResizeObserverEntry[] — the production callback
      // never reads its args (it queries `c.clientWidth`/`clientHeight`
      // imperatively), so an empty entry list is fine.
      fire([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
    });
    expect(transform.style.transform).toContain("scale(1)");
    // Sanity: still translated to (0,0) — the re-clamp shouldn't have
    // moved pan because we didn't pan.
    expect(transform.style.transform).toContain("translate(0px, 0px)");
  });

  it("zoom=0.5 → resize must NOT visually 'reset to 100%' (pre-fix symptom)", async () => {
    // Pre-fix: at zoom=0.5 the RO baked SVG at 0.5×0.4=0.2 (committed=0.2)
    // then the stale applyTransform wrote ratio = (1×0.4)/0.2 = 2 — a 2x
    // CSS upscale that visually rendered the diagram at fit (~100%
    // effective), exactly the user-reported symptom. Post-fix the ratio
    // is (0.5×0.4)/0.2 = 1.
    const { rerender, transform } = await renderCanvas({ zoom: 1 });
    await act(async () => {
      rerender(
        <MermaidCanvas content="graph TD; A --> B" path={null} zoom={0.5} setZoom={vi.fn()} />,
      );
    });
    expect(transform.style.transform).toContain("scale(0.5)");
    const fire = capturedROCallbacks[capturedROCallbacks.length - 1];
    await act(async () => {
      fire([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
    });
    expect(transform.style.transform).toContain("scale(1)");
  });
});

describe("MermaidCanvas — pointer drag", () => {
  it("drag-pan: setPointerCapture called; pan updates; cursor cycles grab → grabbing → grab", async () => {
    // Use zoom=2 (effective 0.8) so pan limits give room for a (50,80)
    // delta — at zoom=1 (effective=fit=0.4) scaledW=container.w → no pan.
    const { canvas, transform } = await renderCanvas({ zoom: 2 });
    expect(canvas.className).toContain("mermaid-canvas--interactive");
    expect(canvas.className).not.toContain("mermaid-canvas--dragging");

    await act(async () => {
      fireEvent.pointerDown(canvas, {
        pointerId: 7,
        clientX: 200,
        clientY: 200,
        isPrimary: true,
        button: 0,
      });
    });
    expect(canvas.setPointerCapture).toHaveBeenCalledWith(7);
    expect(canvas.className).toContain("mermaid-canvas--dragging");

    await act(async () => {
      fireEvent.pointerMove(canvas, { pointerId: 7, clientX: 250, clientY: 280 });
    });
    expect(transform.style.transform).toContain("translate(50px, 80px)");

    await act(async () => {
      fireEvent.pointerUp(canvas, { pointerId: 7, clientX: 250, clientY: 280 });
    });
    expect(canvas.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(canvas.className).not.toContain("mermaid-canvas--dragging");
  });
});

describe("MermaidCanvas — fit-to-window + reset + bake", () => {
  it("sizes SVG to fit the container at zoom=1 (uncapped fit, allows scaling up too)", async () => {
    const { container } = await renderCanvas({ zoom: 1 });
    // bbox 2000×1500 in 800×600 → fit = min(0.4, 0.4) = 0.4 (no `,1` cap).
    // Effective = 1 × 0.4 = 0.4. SVG baked at 2000×0.4 = 800px wide.
    const svg = container.querySelector("svg") as SVGSVGElement;
    expect(svg.style.width).toBe("800px");
    expect(svg.style.height).toBe("600px");
  });

  it("upscales SVG when natural is smaller than container (fit > 1, no `,1` cap)", async () => {
    // Override getBBox shim for this test: tiny diagram 200×150 in 800×600.
    Object.defineProperty(SVGElement.prototype, "getBBox", {
      configurable: true,
      value: () => ({ x: 0, y: 0, width: 200, height: 150 }),
    });
    const { container } = await renderCanvas({ zoom: 1 });
    // fit = min(800/200, 600/150) = min(4, 4) = 4.
    // Effective = 1 × 4 = 4. SVG baked at 200×4 = 800px wide.
    const svg = container.querySelector("svg") as SVGSVGElement;
    expect(svg.style.width).toBe("800px");
    expect(svg.style.height).toBe("600px");
  });

  it("caps baked SVG dimensions at 8192px to prevent pathological growth", async () => {
    // Container 2000×2000, bbox 2000×1500 (default shim) → fit=min(1,1.33)=1.
    // At zoom=ZOOM_MAX=8 effective=8, would bake at 16000×12000.
    // Cap kicks in: k = min(8192/16000, 8192/12000) = 0.512 → 8192×6144.
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 2000 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 2000 });
    const { container } = await renderCanvas({ zoom: 8 });
    const svg = container.querySelector("svg") as SVGSVGElement;
    expect(parseFloat(svg.style.width)).toBeCloseTo(8192, 0);
    expect(parseFloat(svg.style.height)).toBeCloseTo(6144, 0);
  });

  it("resets pan to (0,0) when content changes and re-bakes SVG dimensions", async () => {
    const { canvas, container, transform, rerender } = await renderCanvas({
      zoom: 2,
      content: "graph TD; A --> B",
    });
    await act(async () => {
      fireEvent.wheel(canvas, { deltaY: 100, clientX: 200, clientY: 200 });
    });
    expect(transform.style.transform).toContain("translate(0px, -100px)");

    await act(async () => {
      rerender(
        <MermaidCanvas
          content="graph TD; X --> Y"
          path={null}
          zoom={2}
          setZoom={vi.fn()}
        />,
      );
    });
    // Content effect resets panRef; useLayoutEffect re-applies.
    expect(transform.style.transform).toContain("translate(0px, 0px)");
    // Re-bake fired (handleSvgReady runs again on new svg) — SVG dims still
    // reflect natural × effective at the new content's measurement.
    const svg = container.querySelector("svg") as SVGSVGElement;
    // bbox 2000×1500 (shim is module-level), zoom=2, fit=0.4 → effective=0.8.
    expect(svg.style.width).toBe("1600px");
    expect(svg.style.height).toBe("1200px");
  });
});
