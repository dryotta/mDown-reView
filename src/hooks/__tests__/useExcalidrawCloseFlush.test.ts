/**
 * Tests for the close-flush hook. Mounted at App root, listens for
 * `flush-before-close` (emitted by Rust on
 * `WindowEvent::CloseRequested` AFTER the renderer has marked itself
 * ready via `markCloseFlushReady`), drains all pending Excalidraw
 * saves, and acks via the `closeFlushComplete` IPC.
 *
 * Iter-16 added the ready gate (`markCloseFlushReady` IPC) so Rust
 * can skip the prevent_close round-trip for cold-start closes and
 * for windows that haven't yet committed the React effect.
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

const closeFlushCompleteMock = vi.fn(async (_label: string) => {});
const markReadyMock = vi.fn(async () => {});
vi.mock("@/lib/tauri-commands", () => ({
  closeFlushComplete: (label: string) => closeFlushCompleteMock(label),
  markCloseFlushReady: () => markReadyMock(),
}));

// Capture the listener registered via `listenEvent` so tests can
// invoke it manually with the payload Rust would have emitted.
let capturedHandler: ((label: string) => void) | null = null;
const unlistenMock = vi.fn();
vi.mock("@/lib/tauri-events", () => ({
  listenEvent: vi.fn(
    async (name: string, cb: (label: string) => void) => {
      if (name === "flush-before-close") {
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
  closeFlushCompleteMock.mockReset();
  closeFlushCompleteMock.mockResolvedValue(undefined);
  markReadyMock.mockReset();
  markReadyMock.mockResolvedValue(undefined);
  unlistenMock.mockReset();
});

afterEach(() => {
  capturedHandler = null;
});

describe("useExcalidrawCloseFlush", () => {
  it("calls markCloseFlushReady on mount (iter-16 ready gate)", async () => {
    renderHook(() => useExcalidrawCloseFlush());
    // Mount triggers the IPC; await microtasks so the .catch chain settles.
    await Promise.resolve();
    await Promise.resolve();
    expect(markReadyMock).toHaveBeenCalledTimes(1);
  });

  it("registers a listener for flush-before-close on mount", () => {
    renderHook(() => useExcalidrawCloseFlush());
    expect(capturedHandler).toBeTypeOf("function");
  });

  it("drains pending saves AND acks via IPC when the event fires", async () => {
    renderHook(() => useExcalidrawCloseFlush());
    expect(capturedHandler).toBeTypeOf("function");

    capturedHandler!("main");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(flushAllMock).toHaveBeenCalledTimes(1);
    expect(closeFlushCompleteMock).toHaveBeenCalledTimes(1);
    expect(closeFlushCompleteMock.mock.calls[0][0]).toBe("main");
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
    expect(closeFlushCompleteMock).toHaveBeenCalledTimes(1);
    expect(closeFlushCompleteMock.mock.calls[0][0]).toBe("worker-1");
  });

  it("ack-IPC failure is swallowed (no throw, no unhandled rejection)", async () => {
    closeFlushCompleteMock.mockRejectedValueOnce(new Error("IPC closed"));
    renderHook(() => useExcalidrawCloseFlush());

    expect(() => capturedHandler!("main")).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(flushAllMock).toHaveBeenCalledTimes(1);
    expect(closeFlushCompleteMock).toHaveBeenCalledTimes(1);
  });

  it("markCloseFlushReady IPC failure is swallowed (logs only)", async () => {
    markReadyMock.mockRejectedValueOnce(new Error("registry missing"));
    expect(() => renderHook(() => useExcalidrawCloseFlush())).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(markReadyMock).toHaveBeenCalledTimes(1);
  });

  it("invokes unlisten on unmount", async () => {
    const { unmount } = renderHook(() => useExcalidrawCloseFlush());
    await Promise.resolve();
    await Promise.resolve();
    unmount();
    await Promise.resolve();
    expect(unlistenMock).toHaveBeenCalled();
  });
});
