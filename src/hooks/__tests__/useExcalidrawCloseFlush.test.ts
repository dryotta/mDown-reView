/**
 * Tests for the Excalidraw close-flush hook. Mounted at App root,
 * listens for `excalidraw-flush-before-close` (emitted by Rust on
 * `WindowEvent::CloseRequested`), drains all pending Excalidraw saves,
 * and acks via the `excalidrawCloseFlushComplete` IPC.
 *
 * Pre-iter-14 this entire hook had zero direct tests
 * (test-expert HIGH finding) — a payload-shape regression in the
 * Tauri listener would silently no-op every Alt-F4/Cmd-Q and lose up
 * to one debounce window of edits with no observable failure.
 */

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flushAllMock = vi.fn(async () => {});
vi.mock("@/lib/excalidraw/flush-registry", () => ({
  flushAllPendingExcalidrawSaves: () => flushAllMock(),
}));

const flushCompleteMock = vi.fn(async (_label: string) => {});
vi.mock("@/lib/tauri-commands", () => ({
  excalidrawCloseFlushComplete: (label: string) => flushCompleteMock(label),
}));

// Capture the listener registered via `listenEvent` so tests can
// invoke it manually with the payload Rust would have emitted.
let capturedHandler: ((label: string) => void) | null = null;
const unlistenMock = vi.fn();
vi.mock("@/lib/tauri-events", () => ({
  listenEvent: vi.fn(
    async (name: string, cb: (label: string) => void) => {
      if (name === "excalidraw-flush-before-close") {
        capturedHandler = cb;
      }
      return unlistenMock;
    },
  ),
}));

import { useExcalidrawCloseFlush } from "../useExcalidrawCloseFlush";

beforeEach(() => {
  capturedHandler = null;
  flushAllMock.mockReset();
  flushAllMock.mockResolvedValue(undefined);
  flushCompleteMock.mockReset();
  flushCompleteMock.mockResolvedValue(undefined);
  unlistenMock.mockReset();
});

afterEach(() => {
  capturedHandler = null;
});

describe("useExcalidrawCloseFlush", () => {
  it("registers a listener for excalidraw-flush-before-close on mount", () => {
    renderHook(() => useExcalidrawCloseFlush());
    expect(capturedHandler).toBeTypeOf("function");
  });

  it("drains pending saves AND acks via IPC when the event fires", async () => {
    renderHook(() => useExcalidrawCloseFlush());
    expect(capturedHandler).toBeTypeOf("function");

    capturedHandler!("main");
    // The handler is async-fire-and-forget. Drain microtasks to let
    // both awaited steps land.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(flushAllMock).toHaveBeenCalledTimes(1);
    expect(flushCompleteMock).toHaveBeenCalledTimes(1);
    expect(flushCompleteMock.mock.calls[0][0]).toBe("main");
  });

  it("drain failure does NOT block ack — best-effort close contract", async () => {
    flushAllMock.mockRejectedValueOnce(new Error("registry blew up"));
    renderHook(() => useExcalidrawCloseFlush());

    capturedHandler!("worker-1");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(flushAllMock).toHaveBeenCalledTimes(1);
    // Critical: the ack still fires even though the drain rejected.
    // Without this, Rust's prevent_close timeout would always fire
    // (2.5s lag on every close) when any registered editor's flush
    // throws.
    expect(flushCompleteMock).toHaveBeenCalledTimes(1);
    expect(flushCompleteMock.mock.calls[0][0]).toBe("worker-1");
  });

  it("ack-IPC failure is swallowed (no throw, no unhandled rejection)", async () => {
    flushCompleteMock.mockRejectedValueOnce(new Error("IPC closed"));
    renderHook(() => useExcalidrawCloseFlush());

    // Must not throw or reject from the handler invocation.
    expect(() => capturedHandler!("main")).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(flushAllMock).toHaveBeenCalledTimes(1);
    expect(flushCompleteMock).toHaveBeenCalledTimes(1);
  });

  it("invokes unlisten on unmount", async () => {
    const { unmount } = renderHook(() => useExcalidrawCloseFlush());
    // Allow the listenEvent promise to resolve so the cleanup has the
    // unlisten function to call.
    await Promise.resolve();
    await Promise.resolve();
    unmount();
    await Promise.resolve();
    expect(unlistenMock).toHaveBeenCalled();
  });
});
