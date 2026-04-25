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
    act(() => result.current.setZoom(2.5));
    expect(result.current.zoom).toBe(2.5);
    act(() => result.current.reset());
    expect(result.current.zoom).toBe(1.0);
  });

  it("clamps below ZOOM_MIN", () => {
    const { result } = renderHook(() => useZoom(".md"));
    act(() => result.current.setZoom(0.001));
    expect(result.current.zoom).toBe(ZOOM_MIN);
  });

  it("clamps above ZOOM_MAX", () => {
    const { result } = renderHook(() => useZoom(".md"));
    act(() => result.current.setZoom(9999));
    expect(result.current.zoom).toBe(ZOOM_MAX);
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
    act(() => md.result.current.setZoom(1.5));
    act(() => img.result.current.setZoom(2.0));
    expect(md.result.current.zoom).toBe(1.5);
    expect(img.result.current.zoom).toBe(2.0);
  });

  it("ignores non-finite values (defaults back to 1.0)", () => {
    const { result } = renderHook(() => useZoom(".md"));
    act(() => result.current.setZoom(Number.NaN));
    expect(result.current.zoom).toBe(1.0);
    act(() => result.current.setZoom(Number.POSITIVE_INFINITY));
    expect(result.current.zoom).toBe(1.0);
  });
});
