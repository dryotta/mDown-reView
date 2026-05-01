import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRef } from "react";
import { useCtrlWheelZoom } from "../useCtrlWheelZoom";

function makeWheel(init: { ctrlKey?: boolean; metaKey?: boolean; deltaY: number }) {
  // jsdom's WheelEvent constructor honours the standard init dict.
  return new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    deltaY: init.deltaY,
  });
}

describe("useCtrlWheelZoom", () => {
  it("calls zoomIn on Ctrl+wheel up (deltaY < 0) and preventDefault()s", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const ref = { current: el };
    const zoomIn = vi.fn();
    const zoomOut = vi.fn();
    renderHook(() => useCtrlWheelZoom(ref, zoomIn, zoomOut));

    const ev = makeWheel({ ctrlKey: true, deltaY: -100 });
    const dispatched = el.dispatchEvent(ev);

    expect(zoomIn).toHaveBeenCalledTimes(1);
    expect(zoomOut).not.toHaveBeenCalled();
    // preventDefault was called → dispatchEvent returns false.
    expect(dispatched).toBe(false);
    el.remove();
  });

  it("calls zoomOut on Ctrl+wheel down (deltaY > 0)", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const zoomIn = vi.fn();
    const zoomOut = vi.fn();
    renderHook(() => useCtrlWheelZoom({ current: el }, zoomIn, zoomOut));

    el.dispatchEvent(makeWheel({ ctrlKey: true, deltaY: 100 }));

    expect(zoomOut).toHaveBeenCalledTimes(1);
    expect(zoomIn).not.toHaveBeenCalled();
    el.remove();
  });

  it("treats metaKey (Cmd on macOS) the same as ctrlKey", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const zoomIn = vi.fn();
    const zoomOut = vi.fn();
    renderHook(() => useCtrlWheelZoom({ current: el }, zoomIn, zoomOut));

    el.dispatchEvent(makeWheel({ metaKey: true, deltaY: -100 }));
    el.dispatchEvent(makeWheel({ metaKey: true, deltaY: 100 }));

    expect(zoomIn).toHaveBeenCalledTimes(1);
    expect(zoomOut).toHaveBeenCalledTimes(1);
    el.remove();
  });

  it("ignores plain wheel events (no Ctrl/Cmd)", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const zoomIn = vi.fn();
    const zoomOut = vi.fn();
    renderHook(() => useCtrlWheelZoom({ current: el }, zoomIn, zoomOut));

    const ev = makeWheel({ deltaY: -100 });
    const dispatched = el.dispatchEvent(ev);

    expect(zoomIn).not.toHaveBeenCalled();
    expect(zoomOut).not.toHaveBeenCalled();
    expect(dispatched).toBe(true); // No preventDefault.
    el.remove();
  });

  it("ignores Ctrl+wheel with deltaY === 0 (horizontal scroll on a touchpad)", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const zoomIn = vi.fn();
    const zoomOut = vi.fn();
    renderHook(() => useCtrlWheelZoom({ current: el }, zoomIn, zoomOut));

    el.dispatchEvent(makeWheel({ ctrlKey: true, deltaY: 0 }));

    expect(zoomIn).not.toHaveBeenCalled();
    expect(zoomOut).not.toHaveBeenCalled();
    el.remove();
  });

  it("removes the listener on unmount", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const zoomIn = vi.fn();
    const zoomOut = vi.fn();
    const { unmount } = renderHook(() =>
      useCtrlWheelZoom({ current: el }, zoomIn, zoomOut),
    );
    unmount();

    el.dispatchEvent(makeWheel({ ctrlKey: true, deltaY: -100 }));

    expect(zoomIn).not.toHaveBeenCalled();
    el.remove();
  });

  it("no-ops when ref.current is null", () => {
    const zoomIn = vi.fn();
    const zoomOut = vi.fn();
    const ref = { current: null };
    expect(() => {
      renderHook(() => useCtrlWheelZoom(ref, zoomIn, zoomOut));
    }).not.toThrow();
    expect(zoomIn).not.toHaveBeenCalled();
    expect(zoomOut).not.toHaveBeenCalled();
  });

  it("uses targetGetter when supplied (overrides ref.current)", () => {
    const refEl = document.createElement("div");
    const targetEl = document.createElement("section");
    document.body.appendChild(refEl);
    document.body.appendChild(targetEl);
    const zoomIn = vi.fn();
    const zoomOut = vi.fn();

    renderHook(() =>
      useCtrlWheelZoom({ current: refEl }, zoomIn, zoomOut, {
        targetGetter: () => targetEl,
      }),
    );

    // Wheel on the ref element does NOT trigger the listener.
    refEl.dispatchEvent(makeWheel({ ctrlKey: true, deltaY: -100 }));
    expect(zoomIn).not.toHaveBeenCalled();

    // Wheel on the targetGetter element does.
    targetEl.dispatchEvent(makeWheel({ ctrlKey: true, deltaY: -100 }));
    expect(zoomIn).toHaveBeenCalledTimes(1);

    refEl.remove();
    targetEl.remove();
  });

  it("re-attaches when epoch changes (target replaced, e.g. iframe srcdoc reload)", () => {
    const oldTarget = document.createElement("div");
    const newTarget = document.createElement("div");
    document.body.appendChild(oldTarget);
    document.body.appendChild(newTarget);
    const zoomIn = vi.fn();
    const zoomOut = vi.fn();
    let active = oldTarget;
    let epoch = 0;

    const { rerender } = renderHook(() =>
      useCtrlWheelZoom({ current: null }, zoomIn, zoomOut, {
        targetGetter: () => active,
        epoch,
      }),
    );

    oldTarget.dispatchEvent(makeWheel({ ctrlKey: true, deltaY: -100 }));
    expect(zoomIn).toHaveBeenCalledTimes(1);

    // Swap the target and bump the epoch — old target should no longer fire.
    active = newTarget;
    epoch = 1;
    rerender();

    oldTarget.dispatchEvent(makeWheel({ ctrlKey: true, deltaY: -100 }));
    newTarget.dispatchEvent(makeWheel({ ctrlKey: true, deltaY: -100 }));
    expect(zoomIn).toHaveBeenCalledTimes(2); // Only the newTarget fire counts.

    oldTarget.remove();
    newTarget.remove();
  });

  it("integrates with a React-hosted ref", () => {
    const zoomIn = vi.fn();
    const zoomOut = vi.fn();
    const el = document.createElement("article");
    document.body.appendChild(el);
    const { rerender } = renderHook(() => {
      const ref = useRef<HTMLElement | null>(el);
      useCtrlWheelZoom(ref, zoomIn, zoomOut);
      return ref;
    });
    rerender();

    el.dispatchEvent(makeWheel({ ctrlKey: true, deltaY: -100 }));
    expect(zoomIn).toHaveBeenCalledTimes(1);
    el.remove();
  });
});
