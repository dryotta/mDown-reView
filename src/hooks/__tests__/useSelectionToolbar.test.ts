import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSelectionToolbar } from "../useSelectionToolbar";
import { useStore } from "@/store";

vi.mock("@/lib/tauri-commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri-commands")>();
  return {
    ...actual,
    computeAnchorHash: vi.fn().mockResolvedValue("abc123hash"),
  };
});

vi.mock("@/lib/comment-utils", () => ({
  truncateSelectedText: vi.fn((t: string) => t),
}));

beforeEach(() => {
  // Reset the panel-seed store field between tests so an earlier
  // `requestLineCompose` doesn't bleed into the next `expect`.
  useStore.setState({ pendingLineCompose: null });
});

describe("useSelectionToolbar", () => {
  it("starts with null selectionToolbar", () => {
    const { result } = renderHook(() => useSelectionToolbar());
    expect(result.current.selectionToolbar).toBeNull();
  });

  it("handleMouseUp clears toolbar when selection is collapsed", () => {
    const mockSelection = { isCollapsed: true } as Selection;
    vi.spyOn(window, "getSelection").mockReturnValue(mockSelection);

    const { result } = renderHook(() => useSelectionToolbar());
    act(() => result.current.handleMouseUp());
    expect(result.current.selectionToolbar).toBeNull();
  });

  it("handleMouseUp clears toolbar when no selection exists", () => {
    vi.spyOn(window, "getSelection").mockReturnValue(null);

    const { result } = renderHook(() => useSelectionToolbar());
    act(() => result.current.handleMouseUp());
    expect(result.current.selectionToolbar).toBeNull();
  });

  it("dismissToolbar clears the toolbar", () => {
    const { result } = renderHook(() => useSelectionToolbar());
    act(() => {
      result.current.setSelectionToolbar({
        position: { top: 100, left: 100 },
        lineNumber: 1,
        selectedText: "hello",
        startOffset: 0,
        endLine: 1,
        endOffset: 5,
      });
    });
    expect(result.current.selectionToolbar).not.toBeNull();
    act(() => result.current.dismissToolbar());
    expect(result.current.selectionToolbar).toBeNull();
  });

  it("handleAddSelectionComment seeds requestLineCompose with the selection's anchor", async () => {
    const { result } = renderHook(() => useSelectionToolbar());

    act(() => {
      result.current.setSelectionToolbar({
        position: { top: 50, left: 50 },
        lineNumber: 3,
        selectedText: "selected text",
        startOffset: 5,
        endLine: 5,
        endOffset: 10,
      });
    });

    await act(async () => {
      await result.current.handleAddSelectionComment("/foo.md");
    });

    const pending = useStore.getState().pendingLineCompose;
    expect(pending).not.toBeNull();
    expect(pending?.filePath).toBe("/foo.md");
    expect(pending?.anchor).toEqual({
      line: 3,
      end_line: 5,
      start_column: 5,
      end_column: 10,
      selected_text: "selected text",
      selected_text_hash: "abc123hash",
    });
    // Selection composer carries a fingerprint draft key so it doesn't
    // collide with a line-only composer for the same line.
    expect(pending?.draftKey).toMatch(/^\/foo\.md::new::/);
    expect(result.current.selectionToolbar).toBeNull();
    // The store action also forces the panel visible.
    expect(useStore.getState().commentsPaneVisible).toBe(true);
  });

  it("handleAddSelectionComment does nothing when selectionToolbar is null", async () => {
    const { result } = renderHook(() => useSelectionToolbar());
    await act(async () => {
      await result.current.handleAddSelectionComment("/foo.md");
    });
    expect(useStore.getState().pendingLineCompose).toBeNull();
  });
});

// ── A2 (iter 7) — caret-rect fallback + bottom-edge clamp ─────────────────

describe("useSelectionToolbar — handleMouseUp positioning (A2)", () => {
  function makeLineEl(idx: number): HTMLElement {
    const el = document.createElement("span");
    el.setAttribute("data-line-idx", String(idx));
    document.body.appendChild(el);
    const text = document.createTextNode("hello world");
    el.appendChild(text);
    return el;
  }

  function mockSelectionWithRange(range: Range, text = "hello") {
    const sel = {
      isCollapsed: false,
      toString: () => text,
      getRangeAt: () => range,
    } as unknown as Selection;
    vi.spyOn(window, "getSelection").mockReturnValue(sel);
  }

  beforeEach(() => {
    document.body.innerHTML = "";
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to a zero-width caret range rect when getClientRects() is empty", () => {
    const startEl = makeLineEl(0);
    const endEl = startEl;
    const range = document.createRange();
    range.setStart(startEl.firstChild!, 0);
    range.setEnd(endEl.firstChild!, 5);

    const proto = Range.prototype as unknown as Record<string, unknown>;
    const originalGetClientRects = proto.getClientRects;
    const originalGetBCR = proto.getBoundingClientRect;
    const emptyRectList = { length: 0, item: () => null } as unknown as DOMRectList;
    proto.getClientRects = (() => emptyRectList) as unknown;

    const caretRect = {
      top: 580,
      left: 100,
      bottom: 580,
      right: 100,
      width: 0,
      height: 0,
      x: 100,
      y: 580,
      toJSON: () => ({}),
    } as DOMRect;
    proto.getBoundingClientRect = (() => caretRect) as unknown;

    mockSelectionWithRange(range, "hello");

    const { result } = renderHook(() => useSelectionToolbar());
    try {
      act(() => result.current.handleMouseUp());
    } finally {
      proto.getClientRects = originalGetClientRects;
      proto.getBoundingClientRect = originalGetBCR;
    }

    expect(result.current.selectionToolbar).not.toBeNull();
    const { top, left } = result.current.selectionToolbar!.position;
    expect(top).toBeLessThanOrEqual(560);
    expect(top).toBeGreaterThanOrEqual(4);
    expect(left).toBeGreaterThanOrEqual(4);
    expect(left).toBeLessThanOrEqual(800 - 120 - 4);
  });

  it("clamps `top` to viewport bottom edge when selection rect sits near window bottom", () => {
    const startEl = makeLineEl(2);
    const range = document.createRange();
    range.setStart(startEl.firstChild!, 0);
    range.setEnd(startEl.firstChild!, 5);

    const rect = {
      top: 700,
      left: 50,
      bottom: 715,
      right: 90,
      width: 40,
      height: 15,
      x: 50,
      y: 700,
      toJSON: () => ({}),
    } as DOMRect;
    const rectList = {
      length: 1,
      item: (i: number) => (i === 0 ? rect : null),
      0: rect,
    } as unknown as DOMRectList;
    const proto = Range.prototype as unknown as Record<string, unknown>;
    const originalGetClientRects = proto.getClientRects;
    const originalGetBCR = proto.getBoundingClientRect;
    proto.getClientRects = (() => rectList) as unknown;
    proto.getBoundingClientRect = (() => rect) as unknown;

    mockSelectionWithRange(range, "hello");

    const { result } = renderHook(() => useSelectionToolbar());
    try {
      act(() => result.current.handleMouseUp());
    } finally {
      proto.getClientRects = originalGetClientRects;
      proto.getBoundingClientRect = originalGetBCR;
    }

    expect(result.current.selectionToolbar).not.toBeNull();
    const { top } = result.current.selectionToolbar!.position;
    expect(top).toBeLessThanOrEqual(560);
    expect(top).toBeGreaterThanOrEqual(4);
  });
});

// ── Whitespace trimming on captured selection text ────────────────────────

describe("useSelectionToolbar — handleMouseUp trims whitespace from selectedText", () => {
  function makeLineEl(idx: number, text = "hello world"): HTMLElement {
    const el = document.createElement("span");
    el.setAttribute("data-line-idx", String(idx));
    document.body.appendChild(el);
    el.appendChild(document.createTextNode(text));
    return el;
  }

  function mockSelectionWithRange(range: Range, text: string) {
    const sel = {
      isCollapsed: false,
      toString: () => text,
      getRangeAt: () => range,
    } as unknown as Selection;
    vi.spyOn(window, "getSelection").mockReturnValue(sel);
  }

  // jsdom doesn't implement Range.getClientRects/getBoundingClientRect.
  // Stub both with a generic non-zero rect so positioning code can run.
  function stubRangeRects() {
    const rect = {
      top: 100,
      left: 50,
      bottom: 115,
      right: 200,
      width: 150,
      height: 15,
      x: 50,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect;
    const rectList = {
      length: 1,
      item: (i: number) => (i === 0 ? rect : null),
      0: rect,
    } as unknown as DOMRectList;
    const proto = Range.prototype as unknown as Record<string, unknown>;
    const originals = {
      getClientRects: proto.getClientRects,
      getBoundingClientRect: proto.getBoundingClientRect,
    };
    proto.getClientRects = (() => rectList) as unknown;
    proto.getBoundingClientRect = (() => rect) as unknown;
    return () => {
      proto.getClientRects = originals.getClientRects;
      proto.getBoundingClientRect = originals.getBoundingClientRect;
    };
  }

  beforeEach(() => {
    document.body.innerHTML = "";
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("strips leading and trailing whitespace from raw selected text", () => {
    const el = makeLineEl(2, "  hello world  ");
    const range = document.createRange();
    range.setStart(el.firstChild!, 0);
    range.setEnd(el.firstChild!, 15);
    mockSelectionWithRange(range, "  hello world  ");
    const restore = stubRangeRects();

    const { result } = renderHook(() => useSelectionToolbar());
    try {
      act(() => result.current.handleMouseUp());
    } finally {
      restore();
    }

    expect(result.current.selectionToolbar?.selectedText).toBe("hello world");
  });

  it("strips trailing newline that comes from selection past a paragraph boundary", () => {
    const el = makeLineEl(0, "trailing newline");
    const range = document.createRange();
    range.setStart(el.firstChild!, 0);
    range.setEnd(el.firstChild!, 16);
    mockSelectionWithRange(range, "trailing newline\n");
    const restore = stubRangeRects();

    const { result } = renderHook(() => useSelectionToolbar());
    try {
      act(() => result.current.handleMouseUp());
    } finally {
      restore();
    }

    expect(result.current.selectionToolbar?.selectedText).toBe("trailing newline");
  });

  it("clears the toolbar when raw selection contains only whitespace", () => {
    const el = makeLineEl(0, "   ");
    const range = document.createRange();
    range.setStart(el.firstChild!, 0);
    range.setEnd(el.firstChild!, 3);
    mockSelectionWithRange(range, "   ");
    const restore = stubRangeRects();

    const { result } = renderHook(() => useSelectionToolbar());
    try {
      act(() => result.current.handleMouseUp());
    } finally {
      restore();
    }

    expect(result.current.selectionToolbar).toBeNull();
  });
});

describe("useSelectionToolbar with custom lineAttribute and lineOffset", () => {
  it("defaults to data-line-idx with offset 1", () => {
    const { result } = renderHook(() => useSelectionToolbar());
    expect(result.current.selectionToolbar).toBeNull();
  });

  it("accepts data-source-line with offset 0", () => {
    const { result } = renderHook(() => useSelectionToolbar("data-source-line", 0));
    expect(result.current.selectionToolbar).toBeNull();
  });

  it("handleAddSelectionComment works with custom params", async () => {
    const { result } = renderHook(() => useSelectionToolbar("data-source-line", 0));

    act(() => {
      result.current.setSelectionToolbar({
        position: { top: 50, left: 50 },
        lineNumber: 7,
        selectedText: "some text",
        startOffset: 0,
        endLine: 7,
        endOffset: 9,
      });
    });

    await act(async () => {
      await result.current.handleAddSelectionComment("/bar.md");
    });

    const pending = useStore.getState().pendingLineCompose;
    expect(pending?.filePath).toBe("/bar.md");
    expect(pending?.anchor).toEqual({
      line: 7,
      end_line: 7,
      start_column: 0,
      end_column: 9,
      selected_text: "some text",
      selected_text_hash: "abc123hash",
    });
  });
});

// ── data-source-end-line capture for same-block multi-line selections ────

describe("useSelectionToolbar — same-block selection uses data-source-end-line", () => {
  // Helper: stub jsdom range rect API so positioning code path works.
  function stubRangeRects() {
    const rect = {
      top: 100, left: 50, bottom: 115, right: 200,
      width: 150, height: 15, x: 50, y: 100,
      toJSON: () => ({}),
    } as DOMRect;
    const rectList = {
      length: 1,
      item: (i: number) => (i === 0 ? rect : null),
      0: rect,
    } as unknown as DOMRectList;
    const proto = Range.prototype as unknown as Record<string, unknown>;
    const originals = {
      getClientRects: proto.getClientRects,
      getBoundingClientRect: proto.getBoundingClientRect,
    };
    proto.getClientRects = (() => rectList) as unknown;
    proto.getBoundingClientRect = (() => rect) as unknown;
    return () => {
      proto.getClientRects = originals.getClientRects;
      proto.getBoundingClientRect = originals.getBoundingClientRect;
    };
  }

  function makeBlock(startLine: number, endLine: number, text: string): HTMLElement {
    const el = document.createElement("div");
    el.setAttribute("data-source-line", String(startLine));
    el.setAttribute("data-source-end-line", String(endLine));
    el.appendChild(document.createTextNode(text));
    document.body.appendChild(el);
    return el;
  }

  function mockSelectionWithRange(range: Range, text: string) {
    const sel = {
      isCollapsed: false,
      toString: () => text,
      getRangeAt: () => range,
    } as unknown as Selection;
    vi.spyOn(window, "getSelection").mockReturnValue(sel);
  }

  beforeEach(() => {
    document.body.innerHTML = "";
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses data-source-end-line as endLine when start and end resolve to same block", () => {
    // Source line 5 starts a paragraph that ends on line 8 (a soft-
    // wrapped paragraph in the source). The DOM wrapper has
    // data-source-line=5 and data-source-end-line=8.
    const block = makeBlock(5, 8, "wrapped paragraph content");
    const range = document.createRange();
    range.setStart(block.firstChild!, 0);
    range.setEnd(block.firstChild!, 17);
    mockSelectionWithRange(range, "wrapped paragraph");
    const restore = stubRangeRects();

    const { result } = renderHook(() =>
      useSelectionToolbar("data-source-line", 0)
    );
    try {
      act(() => result.current.handleMouseUp());
    } finally {
      restore();
    }

    expect(result.current.selectionToolbar).not.toBeNull();
    expect(result.current.selectionToolbar?.lineNumber).toBe(5);
    // endLine should be 8 (from data-source-end-line), not 5.
    expect(result.current.selectionToolbar?.endLine).toBe(8);
  });

  it("uses end-block start line when selection spans across two different blocks", () => {
    // Selection starts in block at line 5 (ends at 8) and ends in
    // block at line 10 (ends at 12). Cross-block: endLine should be
    // 10 (start of end block), NOT the end block's end-line (12).
    const blockA = makeBlock(5, 8, "first block");
    const blockB = makeBlock(10, 12, "second block");
    const range = document.createRange();
    range.setStart(blockA.firstChild!, 0);
    range.setEnd(blockB.firstChild!, 12);
    mockSelectionWithRange(range, "first block second block");
    const restore = stubRangeRects();

    const { result } = renderHook(() =>
      useSelectionToolbar("data-source-line", 0)
    );
    try {
      act(() => result.current.handleMouseUp());
    } finally {
      restore();
    }

    expect(result.current.selectionToolbar).not.toBeNull();
    expect(result.current.selectionToolbar?.lineNumber).toBe(5);
    expect(result.current.selectionToolbar?.endLine).toBe(10);
  });

  it("falls back to endIdx when data-source-end-line is missing or invalid", () => {
    // Block lacks data-source-end-line (legacy shape, source view, etc.).
    const block = document.createElement("div");
    block.setAttribute("data-source-line", "3");
    block.appendChild(document.createTextNode("just one line"));
    document.body.appendChild(block);

    const range = document.createRange();
    range.setStart(block.firstChild!, 0);
    range.setEnd(block.firstChild!, 4);
    mockSelectionWithRange(range, "just");
    const restore = stubRangeRects();

    const { result } = renderHook(() =>
      useSelectionToolbar("data-source-line", 0)
    );
    try {
      act(() => result.current.handleMouseUp());
    } finally {
      restore();
    }

    expect(result.current.selectionToolbar?.lineNumber).toBe(3);
    expect(result.current.selectionToolbar?.endLine).toBe(3);
  });

  it("ignores data-source-end-line when it is BEFORE the start line (defensive)", () => {
    // Pathological / corrupted markup: end-line < start-line. The
    // hook should ignore the bad attribute and fall back to endIdx.
    const block = document.createElement("div");
    block.setAttribute("data-source-line", "10");
    block.setAttribute("data-source-end-line", "5"); // bogus
    block.appendChild(document.createTextNode("paragraph content"));
    document.body.appendChild(block);

    const range = document.createRange();
    range.setStart(block.firstChild!, 0);
    range.setEnd(block.firstChild!, 9);
    mockSelectionWithRange(range, "paragraph");
    const restore = stubRangeRects();

    const { result } = renderHook(() =>
      useSelectionToolbar("data-source-line", 0)
    );
    try {
      act(() => result.current.handleMouseUp());
    } finally {
      restore();
    }

    expect(result.current.selectionToolbar?.lineNumber).toBe(10);
    expect(result.current.selectionToolbar?.endLine).toBe(10);
  });

  it("resolves the wrapper when range.startContainer is an element node (not a text node)", () => {
    // Triple-click and Shift+click can produce a Range whose
    // startContainer is an Element (e.g. the `<li>` itself with
    // offset 0), not a text node. The previous implementation used
    // `parentElement?.closest(...)` which walked PAST the element
    // and would return the wrong ancestor. The fix should use
    // `closest` on the element directly when nodeType === ELEMENT.
    //
    // Build: a parent block with `data-source-line=2` containing a
    // child `<li>` with `data-source-line=5`. Selection startContainer
    // is the `<li>` itself with offset 0.
    const parent = document.createElement("div");
    parent.setAttribute("data-source-line", "2");
    document.body.appendChild(parent);
    const li = document.createElement("li");
    li.setAttribute("data-source-line", "5");
    li.appendChild(document.createTextNode("list item text"));
    parent.appendChild(li);

    const range = document.createRange();
    range.setStart(li, 0); // <-- startContainer is the LI element
    range.setEnd(li.firstChild!, 9);
    mockSelectionWithRange(range, "list item");
    const restore = stubRangeRects();

    const { result } = renderHook(() =>
      useSelectionToolbar("data-source-line", 0)
    );
    try {
      act(() => result.current.handleMouseUp());
    } finally {
      restore();
    }

    expect(result.current.selectionToolbar).not.toBeNull();
    // Without the element-node fix, lineNumber would be 2 (the parent
    // div). With the fix, it correctly resolves to 5 (the LI itself).
    expect(result.current.selectionToolbar?.lineNumber).toBe(5);
  });
});
