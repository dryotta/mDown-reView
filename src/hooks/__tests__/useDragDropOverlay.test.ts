import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockUnlisten = vi.fn();
const dropCallbacks: Array<(payload: unknown) => void> = [];
const eventCallbacks: Record<string, (payload: unknown) => void> = {};

vi.mock("@/lib/tauri-events", () => ({
  listenDragDrop: vi.fn((cb: (payload: unknown) => void) => {
    dropCallbacks.push(cb);
    return Promise.resolve(mockUnlisten);
  }),
  listenEvent: vi.fn((eventName: string, cb: (payload: unknown) => void) => {
    eventCallbacks[eventName] = cb;
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
  vi.useFakeTimers();
  dropCallbacks.length = 0;
  for (const k of Object.keys(eventCallbacks)) delete eventCallbacks[k];
});

async function flush() {
  // Resolve the listener promises (Promise.resolve is microtask-only;
  // useFakeTimers doesn't affect microtasks).
  await Promise.resolve();
  await Promise.resolve();
}

describe("useDragDropOverlay — isDragging", () => {
  it("starts with isDragging=false and no rejection", async () => {
    const { useDragDropOverlay } = await import("../useDragDropOverlay");
    const { result } = renderHook(() => useDragDropOverlay());
    await flush();
    expect(result.current.isDragging).toBe(false);
    expect(result.current.lastRejection).toBeNull();
  });

  it("transitions enter→over→drop=true,true,false", async () => {
    const { useDragDropOverlay } = await import("../useDragDropOverlay");
    const { result } = renderHook(() => useDragDropOverlay());
    await flush();

    act(() => {
      dropCallbacks[0]({ type: "enter", paths: ["/a.md"], position: { x: 1, y: 2 } });
    });
    expect(result.current.isDragging).toBe(true);

    act(() => {
      dropCallbacks[0]({ type: "over", position: { x: 3, y: 4 } });
    });
    expect(result.current.isDragging).toBe(true);

    act(() => {
      dropCallbacks[0]({ type: "drop", paths: ["/a.md"], position: { x: 1, y: 2 } });
    });
    expect(result.current.isDragging).toBe(false);
  });

  it("leave (cancelled drag) clears isDragging", async () => {
    const { useDragDropOverlay } = await import("../useDragDropOverlay");
    const { result } = renderHook(() => useDragDropOverlay());
    await flush();

    act(() => {
      dropCallbacks[0]({ type: "enter", paths: ["/a.md"], position: { x: 1, y: 2 } });
    });
    act(() => {
      dropCallbacks[0]({ type: "leave" });
    });
    expect(result.current.isDragging).toBe(false);
  });

  it("unsubscribes on unmount", async () => {
    const { useDragDropOverlay } = await import("../useDragDropOverlay");
    const { unmount } = renderHook(() => useDragDropOverlay());
    await flush();

    unmount();
    await flush();
    // Two subscriptions: drag-drop + drag-drop-rejected.
    expect(mockUnlisten).toHaveBeenCalledTimes(2);
  });
});

describe("useDragDropOverlay — rejection toast", () => {
  it("populates lastRejection when drag-drop-rejected fires", async () => {
    const { useDragDropOverlay } = await import("../useDragDropOverlay");
    const { result } = renderHook(() => useDragDropOverlay());
    await flush();

    act(() => {
      eventCallbacks["drag-drop-rejected"]({
        count: 3,
        reason: "no usable file or folder",
      });
    });
    expect(result.current.lastRejection).toEqual({
      count: 3,
      reason: "no usable file or folder",
    });
  });

  it("auto-clears the rejection toast after 3 s", async () => {
    const { useDragDropOverlay } = await import("../useDragDropOverlay");
    const { result } = renderHook(() => useDragDropOverlay());
    await flush();

    act(() => {
      eventCallbacks["drag-drop-rejected"]({ count: 1, reason: "x" });
    });
    expect(result.current.lastRejection).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.lastRejection).toBeNull();
  });

  it("a new rejection during the timer replaces the prior one", async () => {
    const { useDragDropOverlay } = await import("../useDragDropOverlay");
    const { result } = renderHook(() => useDragDropOverlay());
    await flush();

    act(() => {
      eventCallbacks["drag-drop-rejected"]({ count: 1, reason: "first" });
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    act(() => {
      eventCallbacks["drag-drop-rejected"]({ count: 2, reason: "second" });
    });
    expect(result.current.lastRejection).toEqual({ count: 2, reason: "second" });

    // Original 3 s timer should not fire (cleared on rerender).
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current.lastRejection).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current.lastRejection).toBeNull();
  });
});
