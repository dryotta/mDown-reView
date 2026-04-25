import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStore } from "@/store";
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "@/store/viewerPrefs";
import { useZoom } from "../useZoom";

beforeEach(() => {
  useStore.setState({ zoomByFiletype: {} });
});

describe("useZoom", () => {
  it("defaults to 1.0 when no zoom recorded", () => {
    const { result } = renderHook(() => useZoom(".md"));
    expect(result.current.zoom).toBe(1.0);
  });

  it("zoomIn multiplies by ZOOM_STEP", () => {
    const { result } = renderHook(() => useZoom(".md"));
    act(() => result.current.zoomIn());
    expect(result.current.zoom).toBeCloseTo(ZOOM_STEP, 5);
  });

  it("zoomOut divides by ZOOM_STEP", () => {
    const { result } = renderHook(() => useZoom(".md"));
    act(() => result.current.zoomOut());
    expect(result.current.zoom).toBeCloseTo(1 / ZOOM_STEP, 5);
  });

  it("reset returns zoom to 1.0", () => {
    const { result } = renderHook(() => useZoom(".md"));
    act(() => useStore.getState().setZoom(".md", 2.5));
    expect(result.current.zoom).toBe(2.5);
    act(() => result.current.reset());
    expect(result.current.zoom).toBe(1.0);
  });

  it("repeated zoomIn caps at ZOOM_MAX", () => {
    const { result } = renderHook(() => useZoom(".md"));
    for (let i = 0; i < 100; i++) act(() => result.current.zoomIn());
    expect(result.current.zoom).toBe(ZOOM_MAX);
  });

  it("repeated zoomOut floors at ZOOM_MIN", () => {
    const { result } = renderHook(() => useZoom(".md"));
    for (let i = 0; i < 100; i++) act(() => result.current.zoomOut());
    expect(result.current.zoom).toBe(ZOOM_MIN);
  });

  it("zoom is independent per filetype key", () => {
    const md = renderHook(() => useZoom(".md"));
    const img = renderHook(() => useZoom(".image"));
    act(() => useStore.getState().setZoom(".md", 1.5));
    act(() => useStore.getState().setZoom(".image", 2.0));
    expect(md.result.current.zoom).toBe(1.5);
    expect(img.result.current.zoom).toBe(2.0);
  });

  // R4 — callbacks are stable across re-renders even when `zoom` changes,
  // so memoized children do not re-render on every zoom step.
  it("R4: zoomIn/zoomOut/reset references are stable across zoom changes", () => {
    const { result, rerender } = renderHook(() => useZoom(".md"));
    const first = { zoomIn: result.current.zoomIn, zoomOut: result.current.zoomOut, reset: result.current.reset };
    act(() => result.current.zoomIn());
    rerender();
    expect(result.current.zoomIn).toBe(first.zoomIn);
    expect(result.current.zoomOut).toBe(first.zoomOut);
    expect(result.current.reset).toBe(first.reset);
  });
});
