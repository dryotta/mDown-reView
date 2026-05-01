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

beforeEach(() => {
  cleanup();

  // rAF — run synchronously so scheduleApply() flushes before assertions.
  originalRAF = window.requestAnimationFrame;
  originalCAF = window.cancelAnimationFrame;
  window.requestAnimationFrame = function rafSync(cb: FrameRequestCallback): number {
    cb(0);
    return 1;
  } as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = function cafNoop(): void {} as typeof window.cancelAnimationFrame;

  // ResizeObserver — jsdom omits it. Use a real class (vitest warns when
  // vi.fn() is invoked with `new`).
  originalRO = window.ResizeObserver;
  class StubResizeObserver {
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
  onFitMeasured?: (v: number) => void;
  content?: string;
  path?: string | null;
} = {}) {
  const setZoom = overrides.setZoom ?? vi.fn();
  const onFitMeasured = overrides.onFitMeasured ?? vi.fn();
  const utils = render(
    <MermaidCanvas
      content={overrides.content ?? "graph TD; A --> B"}
      path={overrides.path ?? null}
      zoom={overrides.zoom ?? 1}
      setZoom={setZoom}
      onFitMeasured={onFitMeasured}
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
  return { ...utils, canvas, transform, setZoom, onFitMeasured };
}

describe("MermaidCanvas — composition", () => {
  it("renders <MermaidRenderer/> inside the transform wrapper with content/path forwarded", async () => {
    const { container, transform } = await renderCanvas({ content: "graph TD; A --> B", path: "/x.md" });
    // MermaidRenderer's signature element is the title="Mermaid diagram" div.
    expect(container.querySelector('[title="Mermaid diagram"]')).not.toBeNull();
    // The renderer is inside the transform target (so transforms cascade onto it).
    expect(transform.contains(container.querySelector('[title="Mermaid diagram"]'))).toBe(true);
  });

  it("applies the initial transform on render (translate(0px, 0px) scale(1))", async () => {
    const { transform } = await renderCanvas({ zoom: 1 });
    expect(transform.style.transform).toContain("translate(0px, 0px)");
    expect(transform.style.transform).toContain("scale(1)");
  });
});

describe("MermaidCanvas — wheel gestures", () => {
  it("vertical wheel pans (deltaY 100 → pan.y -= 100)", async () => {
    const { canvas, transform } = await renderCanvas({ zoom: 1 });
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
    // newZoom = 1 * (1 - (-100)*0.001) = 1.1
    expect(setZoom).toHaveBeenCalledTimes(1);
    expect(setZoom.mock.calls[0][0]).toBeCloseTo(1.1, 5);
  });

  it("shift+wheel pans horizontally (deltaY 100 → pan.x -= 100)", async () => {
    const { canvas, transform } = await renderCanvas({ zoom: 1 });
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
    // bbox 2000×1500, container 800×600. At zoom=1 limitX=600 so a wheel
    // pan of (-100,0) is allowed. Drop zoom to 0.4 → scaledW=800=container,
    // limitX=0 → pan must snap back to (0,0) on the zoom-effect path.
    const { canvas, transform, rerender } = await renderCanvas({ zoom: 1 });
    await act(async () => {
      fireEvent.wheel(canvas, { deltaY: 100, clientX: 200, clientY: 200 });
    });
    expect(transform.style.transform).toContain("translate(0px, -100px)");
    await act(async () => {
      rerender(
        <MermaidCanvas
          content="graph TD; A --> B"
          path={null}
          zoom={0.4}
          setZoom={vi.fn()}
          onFitMeasured={vi.fn()}
        />,
      );
    });
    expect(transform.style.transform).toContain("translate(0px, 0px)");
    expect(transform.style.transform).toContain("scale(0.4)");
  });
});

describe("MermaidCanvas — pointer drag", () => {
  it("drag-pan: setPointerCapture called; pan updates; cursor cycles grab → grabbing → grab", async () => {
    const { canvas, transform } = await renderCanvas({ zoom: 1 });
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

describe("MermaidCanvas — fit measurement + reset", () => {
  it("emits onFitMeasured with min(cw/bw, ch/bh, 1) when SVG renders", async () => {
    const onFitMeasured = vi.fn();
    await renderCanvas({ onFitMeasured });
    // bbox 2000×1500 inside 800×600 → fit = min(0.4, 0.4, 1) = 0.4
    await waitFor(() => expect(onFitMeasured).toHaveBeenCalled());
    const last = onFitMeasured.mock.calls[onFitMeasured.mock.calls.length - 1][0];
    expect(last).toBeCloseTo(0.4, 5);
  });

  it("resets pan to (0,0) when content changes", async () => {
    const { canvas, transform, rerender } = await renderCanvas({ zoom: 1, content: "graph TD; A --> B" });
    await act(async () => {
      fireEvent.wheel(canvas, { deltaY: 100, clientX: 200, clientY: 200 });
    });
    expect(transform.style.transform).toContain("translate(0px, -100px)");

    await act(async () => {
      rerender(
        <MermaidCanvas
          content="graph TD; X --> Y"
          path={null}
          zoom={1}
          setZoom={vi.fn()}
          onFitMeasured={vi.fn()}
        />,
      );
    });
    // Content effect resets panRef; useLayoutEffect re-applies.
    expect(transform.style.transform).toContain("translate(0px, 0px)");
  });
});
