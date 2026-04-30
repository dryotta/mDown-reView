import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRenderCount, getRenderCount, resetRenderCounts } from "../useRenderCount";

describe("useRenderCount", () => {
  beforeEach(() => {
    resetRenderCounts();
  });

  it("increments per render and is keyed by id", () => {
    const { rerender } = renderHook(() => useRenderCount("UnitA"));
    expect(getRenderCount("UnitA")).toBe(1);
    rerender();
    rerender();
    expect(getRenderCount("UnitA")).toBe(3);
  });

  it("tracks distinct ids independently", () => {
    renderHook(() => useRenderCount("UnitA"));
    renderHook(() => useRenderCount("UnitB"));
    expect(getRenderCount("UnitA")).toBe(1);
    expect(getRenderCount("UnitB")).toBe(1);
    expect(getRenderCount("UnitC")).toBe(0);
  });

  it("exposes counts via window.__RENDER_COUNTS__", () => {
    renderHook(() => useRenderCount("Window"));
    const w = window as unknown as { __RENDER_COUNTS__?: Record<string, number> };
    expect(w.__RENDER_COUNTS__?.Window).toBe(1);
  });

  it("resetRenderCounts clears all counters", () => {
    renderHook(() => useRenderCount("Reset"));
    expect(getRenderCount("Reset")).toBe(1);
    resetRenderCounts();
    expect(getRenderCount("Reset")).toBe(0);
  });
});
