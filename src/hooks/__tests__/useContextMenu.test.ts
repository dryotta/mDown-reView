import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useContextMenu } from "../useContextMenu";

describe("useContextMenu", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("starts closed at origin", () => {
    const { result } = renderHook(() => useContextMenu());
    expect(result.current.state).toEqual({ open: false, x: 0, y: 0 });
  });

  it("openAt sets open + coords + payload", () => {
    const { result } = renderHook(() => useContextMenu<{ line: number }>());
    act(() => result.current.openAt({ clientX: 50, clientY: 75 }, { line: 3 }));
    expect(result.current.state.open).toBe(true);
    expect(result.current.state.x).toBe(50);
    expect(result.current.state.y).toBe(75);
    expect(result.current.state.payload).toEqual({ line: 3 });
  });

  it("close() returns state to closed", () => {
    const { result } = renderHook(() => useContextMenu());
    act(() => result.current.openAt({ clientX: 1, clientY: 2 }));
    act(() => result.current.close());
    expect(result.current.state.open).toBe(false);
  });

  it("Escape key closes the menu", () => {
    const { result } = renderHook(() => useContextMenu());
    act(() => result.current.openAt({ clientX: 1, clientY: 2 }));
    expect(result.current.state.open).toBe(true);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.state.open).toBe(false);
  });

  it("mousedown outside .comment-context-menu closes (next tick)", async () => {
    const { result } = renderHook(() => useContextMenu());
    act(() => result.current.openAt({ clientX: 1, clientY: 2 }));
    // Wait for deferred listener attach
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(result.current.state.open).toBe(false);
  });

  it("mousedown inside .comment-context-menu does NOT close", async () => {
    const { result } = renderHook(() => useContextMenu());
    const menu = document.createElement("div");
    menu.className = "comment-context-menu";
    document.body.appendChild(menu);
    act(() => result.current.openAt({ clientX: 1, clientY: 2 }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    act(() => {
      menu.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(result.current.state.open).toBe(true);
  });

  it("scroll event closes the menu", () => {
    const { result } = renderHook(() => useContextMenu());
    act(() => result.current.openAt({ clientX: 1, clientY: 2 }));
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.state.open).toBe(false);
  });
});
