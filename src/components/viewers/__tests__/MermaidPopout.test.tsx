import { render, fireEvent, cleanup, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks (must be hoisted) ──────────────────────────────────────────
vi.mock("@/lib/mermaid-singleton", () => ({
  renderMermaid: vi
    .fn()
    .mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }),
}));
vi.mock("@/hooks/useTheme", () => ({ useTheme: () => "light" }));

// Capture props passed to MermaidCanvas / MermaidControls.
type CanvasProps = {
  content: string;
  path: string | null;
  zoom: number;
  setZoom: (v: number) => void;
  readOnly?: boolean;
};
type ControlsProps = {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onFit: () => void;
  onClose: () => void;
};
const captured: { canvas: CanvasProps | null; controls: ControlsProps | null } = {
  canvas: null,
  controls: null,
};

vi.mock("../mermaid/MermaidCanvas", () => ({
  MermaidCanvas: (props: CanvasProps) => {
    captured.canvas = props;
    return <div data-testid="mock-canvas" />;
  },
}));
vi.mock("../mermaid/MermaidControls", () => ({
  MermaidControls: (props: ControlsProps) => {
    captured.controls = props;
    return <div data-testid="mock-controls" />;
  },
}));

// Minimal in-memory store mock — selector-based hook + getState.
type StoreState = {
  mermaidPopoutOpenFor: { content: string; path: string | null } | null;
  closeMermaidPopout: ReturnType<typeof vi.fn>;
  zoomByFiletype: Record<string, number>;
  setZoom: ReturnType<typeof vi.fn>;
  bumpZoom: ReturnType<typeof vi.fn>;
};

let state: StoreState;
const listeners = new Set<() => void>();

vi.mock("@/store", () => {
  // Lazy access to module-scoped `state` (assigned in beforeEach below).
  type Selector<T> = (s: StoreState) => T;
  function useStore(): StoreState;
  function useStore<T>(sel: Selector<T>): T;
  function useStore<T>(sel?: Selector<T>): T | StoreState {
    // We don't actually need to subscribe — the tests force re-renders by
    // updating state then re-rendering with `rerender()` / new `render()`.
    return sel ? sel(state) : state;
  }
  (useStore as unknown as { getState: () => StoreState }).getState = () => state;
  (useStore as unknown as { subscribe: (fn: () => void) => () => void }).subscribe = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };
  return { useStore };
});

import { MermaidPopout } from "../mermaid/MermaidPopout";

function freshState(overrides: Partial<StoreState> = {}): StoreState {
  const s: StoreState = {
    mermaidPopoutOpenFor: null,
    closeMermaidPopout: vi.fn(() => {
      s.mermaidPopoutOpenFor = null;
    }),
    zoomByFiletype: { ".mmd": 1 },
    setZoom: vi.fn((k: string, v: number) => {
      s.zoomByFiletype[k] = v;
    }),
    bumpZoom: vi.fn(),
    ...overrides,
  };
  return s;
}

let errSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  cleanup();
  state = freshState();
  captured.canvas = null;
  captured.controls = null;
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  errSpy.mockRestore();
  warnSpy.mockRestore();
});

describe("MermaidPopout — visibility gating", () => {
  it("returns null when mermaidPopoutOpenFor is null", () => {
    const { container } = render(<MermaidPopout />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the dialog overlay + inner card when open", () => {
    state.mermaidPopoutOpenFor = { content: "graph TD; A-->B", path: "/x.mmd" };
    const { container } = render(<MermaidPopout />);
    const overlay = container.querySelector(
      '[role="dialog"][aria-label="Mermaid diagram preview"]',
    );
    expect(overlay).not.toBeNull();
    expect(overlay?.classList.contains("mermaid-popout-overlay")).toBe(true);
    // aria-modal=false reflects reality: no focus trap. The overlay paints
    // a backdrop dim for visual separation, but focus is not trapped.
    expect(overlay?.getAttribute("aria-modal")).toBe("false");
    // Inner card is the visible chrome (theme background, border, shadow);
    // overlay is the dimmed click interceptor matching About / Settings.
    const card = container.querySelector(".mermaid-popout-card");
    expect(card).not.toBeNull();
    expect(overlay?.contains(card)).toBe(true);
  });
});

describe("MermaidPopout — child wiring", () => {
  it("renders MermaidCanvas with readOnly=true and the source content/path", () => {
    state.mermaidPopoutOpenFor = { content: "graph TD; A-->B", path: "/y.mmd" };
    render(<MermaidPopout />);
    expect(captured.canvas).not.toBeNull();
    expect(captured.canvas?.readOnly).toBe(true);
    expect(captured.canvas?.content).toBe("graph TD; A-->B");
    expect(captured.canvas?.path).toBe("/y.mmd");
  });

  it("renders MermaidControls with a close handler", () => {
    state.mermaidPopoutOpenFor = { content: "graph TD; A-->B", path: null };
    render(<MermaidPopout />);
    expect(captured.controls).not.toBeNull();
    expect(typeof captured.controls?.onClose).toBe("function");
  });

  it("Fit handler calls bumpZoom('.mmd', 'reset') — 1.0 ≡ fit-to-window", () => {
    state.mermaidPopoutOpenFor = { content: "x", path: null };
    render(<MermaidPopout />);
    expect(captured.controls?.onFit).toBeDefined();
    act(() => {
      captured.controls?.onFit();
    });
    // useZoom('.mmd').reset() routes through bumpZoom('reset') → ZOOM_DEFAULT (1.0).
    expect(state.bumpZoom).toHaveBeenCalledWith(".mmd", "reset");
  });
});

describe("MermaidPopout — Esc keydown", () => {
  it("calls closeMermaidPopout on Escape when open", () => {
    state.mermaidPopoutOpenFor = { content: "x", path: null };
    render(<MermaidPopout />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(state.closeMermaidPopout).toHaveBeenCalledTimes(1);
  });

  it("does not call closeMermaidPopout on Escape when closed (no listener attached)", () => {
    // Render once open to attach the listener, then unmount-equivalent: flip
    // state to null and rerender so PopoutInner unmounts and removes listener.
    state.mermaidPopoutOpenFor = { content: "x", path: null };
    const { rerender } = render(<MermaidPopout />);
    // Sanity: listener works while open.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(state.closeMermaidPopout).toHaveBeenCalledTimes(1);
    state.closeMermaidPopout.mockClear();
    // Close by flipping state and rerender — useEffect cleanup must remove
    // the keydown listener.
    state.mermaidPopoutOpenFor = null;
    act(() => {
      rerender(<MermaidPopout />);
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(state.closeMermaidPopout).not.toHaveBeenCalled();
  });
});
