import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useScrollToLine } from "../useScrollToLine";

describe("useScrollToLine", () => {
  let addSpy: ReturnType<typeof vi.spyOn>;
  let removeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    addSpy = vi.spyOn(window, "addEventListener");
    removeSpy = vi.spyOn(window, "removeEventListener");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers scroll-to-line event listener on mount", () => {
    const ref = { current: document.createElement("div") };
    renderHook(() => useScrollToLine(ref, "data-source-line"));
    expect(addSpy).toHaveBeenCalledWith("scroll-to-line", expect.any(Function));
  });

  it("removes event listener on unmount", () => {
    const ref = { current: document.createElement("div") };
    const { unmount } = renderHook(() => useScrollToLine(ref, "data-source-line"));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("scroll-to-line", expect.any(Function));
  });

  it("calls onScrollTo with line number when event fires", () => {
    const ref = { current: document.createElement("div") };
    const onScrollTo = vi.fn();
    renderHook(() => useScrollToLine(ref, "data-source-line", undefined, onScrollTo));

    window.dispatchEvent(new CustomEvent("scroll-to-line", { detail: { line: 42 } }));
    expect(onScrollTo).toHaveBeenCalledWith(42);
  });

  it("scrolls matching element into view", () => {
    const container = document.createElement("div");
    const el = document.createElement("div");
    el.setAttribute("data-source-line", "10");
    el.scrollIntoView = vi.fn();
    container.appendChild(el);
    const ref = { current: container };

    renderHook(() => useScrollToLine(ref, "data-source-line"));

    window.dispatchEvent(new CustomEvent("scroll-to-line", { detail: { line: 10 } }));
    expect(el.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
  });

  it("adds and removes comment-flash class", () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    const el = document.createElement("div");
    el.setAttribute("data-source-line", "5");
    el.scrollIntoView = vi.fn();
    container.appendChild(el);
    const ref = { current: container };

    renderHook(() => useScrollToLine(ref, "data-source-line"));

    window.dispatchEvent(new CustomEvent("scroll-to-line", { detail: { line: 5 } }));
    expect(el.classList.contains("comment-flash")).toBe(true);

    vi.advanceTimersByTime(1500);
    expect(el.classList.contains("comment-flash")).toBe(false);
    vi.useRealTimers();
  });

  it("applies lineTransform before querying", () => {
    const container = document.createElement("div");
    const el = document.createElement("div");
    el.setAttribute("data-line-idx", "9");
    el.scrollIntoView = vi.fn();
    container.appendChild(el);
    const ref = { current: container };

    const transform = (line: number) => line - 1;
    renderHook(() => useScrollToLine(ref, "data-line-idx", transform));

    window.dispatchEvent(new CustomEvent("scroll-to-line", { detail: { line: 10 } }));
    expect(el.scrollIntoView).toHaveBeenCalled();
  });

  it("still calls onScrollTo even when no element matches", () => {
    const ref = { current: document.createElement("div") };
    const onScrollTo = vi.fn();
    renderHook(() => useScrollToLine(ref, "data-source-line", undefined, onScrollTo));

    window.dispatchEvent(new CustomEvent("scroll-to-line", { detail: { line: 999 } }));
    expect(onScrollTo).toHaveBeenCalledWith(999);
  });
});
