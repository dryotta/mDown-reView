import { describe, it, expect, vi } from "vitest";
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
