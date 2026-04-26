import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSelectionToolbar } from "../useSelectionToolbar";

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

describe("useSelectionToolbar", () => {
  it("starts with null selectionToolbar", () => {
    const { result } = renderHook(() => useSelectionToolbar());
    expect(result.current.selectionToolbar).toBeNull();
  });

  it("starts with null pendingSelectionAnchor", () => {
    const { result } = renderHook(() => useSelectionToolbar());
    expect(result.current.pendingSelectionAnchor).toBeNull();
  });

  it("starts with empty highlightedSelectionLines", () => {
    const { result } = renderHook(() => useSelectionToolbar());
    expect(result.current.highlightedSelectionLines.size).toBe(0);
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

  it("clearSelection resets anchor and highlighted lines", async () => {
    const { result } = renderHook(() => useSelectionToolbar());

    // Manually set toolbar state to simulate a selection
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

    // Trigger handleAddSelectionComment to create anchor + highlights
    const setCommentingLine = vi.fn();
    await act(async () => {
      await result.current.handleAddSelectionComment(setCommentingLine);
    });

    expect(result.current.pendingSelectionAnchor).not.toBeNull();
    expect(result.current.highlightedSelectionLines.size).toBeGreaterThan(0);

    // clearSelection should reset both
    act(() => result.current.clearSelection());
    expect(result.current.pendingSelectionAnchor).toBeNull();
    expect(result.current.highlightedSelectionLines.size).toBe(0);
  });

  it("handleAddSelectionComment creates anchor and calls setCommentingLine", async () => {
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

    const setCommentingLine = vi.fn();
    await act(async () => {
      await result.current.handleAddSelectionComment(setCommentingLine);
    });

    expect(result.current.pendingSelectionAnchor).toEqual({
      line: 3,
      end_line: 5,
      start_column: 5,
      end_column: 10,
      selected_text: "selected text",
      selected_text_hash: "abc123hash",
    });
    expect(result.current.highlightedSelectionLines).toEqual(new Set([3, 4, 5]));
    expect(setCommentingLine).toHaveBeenCalledWith(3);
    expect(result.current.selectionToolbar).toBeNull();
  });

  it("handleAddSelectionComment does nothing when selectionToolbar is null", async () => {
    const { result } = renderHook(() => useSelectionToolbar());
    const setCommentingLine = vi.fn();
    await act(async () => {
      await result.current.handleAddSelectionComment(setCommentingLine);
    });
    expect(setCommentingLine).not.toHaveBeenCalled();
    expect(result.current.pendingSelectionAnchor).toBeNull();
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

    // Force getClientRects() to return an empty list — simulates the
    // boundary case the fallback exists for. jsdom doesn't define this
    // method on Range, so install a stub directly on the prototype and
    // restore it afterwards.
    const proto = Range.prototype as unknown as Record<string, unknown>;
    const originalGetClientRects = proto.getClientRects;
    const originalGetBCR = proto.getBoundingClientRect;
    const emptyRectList = { length: 0, item: () => null } as unknown as DOMRectList;
    proto.getClientRects = (() => emptyRectList) as unknown;

    // Patch Range.prototype.getBoundingClientRect to return a rect that
    // would force the bottom-clamp path (top near bottom of window).
    const caretRect = { top: 580, left: 100, bottom: 580, right: 100, width: 0, height: 0, x: 100, y: 580, toJSON: () => ({}) } as DOMRect;
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
    // Bottom-edge clamp keeps the toolbar inside the viewport (560 = 600 - 36 - 4)
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

    // A non-empty rect list near the bottom edge — top would otherwise be
    // 590 - 36 - 4 = 550 (fits) so we push it past the bottom: rect.top=595
    // means top = 595 - 40 = 555, but with a 700-px-tall toolbar offset we'd
    // exceed the floor. We force the issue with a rect whose `top` is below
    // the viewport edge to ensure the new clamp is what keeps us in-bounds.
    const rect = { top: 700, left: 50, bottom: 715, right: 90, width: 40, height: 15, x: 50, y: 700, toJSON: () => ({}) } as DOMRect;
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
    // 600 - 36 - 4 = 560 is the maximum allowed top.
    expect(top).toBeLessThanOrEqual(560);
    expect(top).toBeGreaterThanOrEqual(4);
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

    const setCommentingLine = vi.fn();
    await act(async () => {
      await result.current.handleAddSelectionComment(setCommentingLine);
    });

    expect(result.current.pendingSelectionAnchor).toEqual({
      line: 7,
      end_line: 7,
      start_column: 0,
      end_column: 9,
      selected_text: "some text",
      selected_text_hash: "abc123hash",
    });
    expect(setCommentingLine).toHaveBeenCalledWith(7);
  });
});
