import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockUnlisten = vi.fn();
const dropCallbacks: Array<(payload: unknown) => void> = [];

vi.mock("@/lib/tauri-events", () => ({
  listenDragDrop: vi.fn((cb: (payload: unknown) => void) => {
    dropCallbacks.push(cb);
    return Promise.resolve(mockUnlisten);
  }),
}));

vi.mock("@/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  dropCallbacks.length = 0;
});

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

describe("useDragDropOverlay", () => {
  it("starts with isDragging=false", async () => {
    const { useDragDropOverlay } = await import("../useDragDropOverlay");
    const { result } = renderHook(() => useDragDropOverlay());
    await flush();
    expect(result.current).toBe(false);
  });

  it("sets isDragging=true on enter", async () => {
    const { useDragDropOverlay } = await import("../useDragDropOverlay");
    const { result } = renderHook(() => useDragDropOverlay());
    await flush();

    act(() => {
      dropCallbacks[0]({ type: "enter", paths: ["/a.md"], position: { x: 10, y: 20 } });
    });
    expect(result.current).toBe(true);
  });

  it("keeps isDragging=true on over", async () => {
    const { useDragDropOverlay } = await import("../useDragDropOverlay");
    const { result } = renderHook(() => useDragDropOverlay());
    await flush();

    act(() => {
      dropCallbacks[0]({ type: "enter", paths: ["/a.md"], position: { x: 10, y: 20 } });
    });
    act(() => {
      dropCallbacks[0]({ type: "over", position: { x: 12, y: 22 } });
    });
    expect(result.current).toBe(true);
  });

  it("sets isDragging=false on drop", async () => {
    const { useDragDropOverlay } = await import("../useDragDropOverlay");
    const { result } = renderHook(() => useDragDropOverlay());
    await flush();

    act(() => {
      dropCallbacks[0]({ type: "enter", paths: ["/a.md"], position: { x: 10, y: 20 } });
    });
    act(() => {
      dropCallbacks[0]({ type: "drop", paths: ["/a.md"], position: { x: 10, y: 20 } });
    });
    expect(result.current).toBe(false);
  });

  it("sets isDragging=false on leave (cancelled drag)", async () => {
    const { useDragDropOverlay } = await import("../useDragDropOverlay");
    const { result } = renderHook(() => useDragDropOverlay());
    await flush();

    act(() => {
      dropCallbacks[0]({ type: "enter", paths: ["/a.md"], position: { x: 10, y: 20 } });
    });
    act(() => {
      dropCallbacks[0]({ type: "leave" });
    });
    expect(result.current).toBe(false);
  });

  it("unsubscribes on unmount", async () => {
    const { useDragDropOverlay } = await import("../useDragDropOverlay");
    const { unmount } = renderHook(() => useDragDropOverlay());
    await flush();

    unmount();
    await flush();
    expect(mockUnlisten).toHaveBeenCalledTimes(1);
  });

  it("ignores stale events fired after unmount (no warning, no state update)", async () => {
    const { useDragDropOverlay } = await import("../useDragDropOverlay");
    const { result, unmount } = renderHook(() => useDragDropOverlay());
    await flush();

    unmount();

    // Simulate a drop event arriving after unmount but before the
    // unlisten promise resolved (race: the cancelled flag prevents the
    // setIsDragging from running which would throw a "set state on
    // unmounted component" warning in older React versions).
    expect(() => {
      dropCallbacks[0]({ type: "enter", paths: ["/a.md"], position: { x: 0, y: 0 } });
    }).not.toThrow();
    expect(result.current).toBe(false);
  });
});
