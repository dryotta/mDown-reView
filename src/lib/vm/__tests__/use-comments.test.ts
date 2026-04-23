import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import { useComments } from "../use-comments";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_eventName: string, _callback: unknown) =>
    Promise.resolve(() => {})
  ),
}));

vi.mock("@/lib/tauri-commands", () => ({
  getFileComments: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}));

function flushPromises() {
  return act(async () => {});
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useComments listener cleanup", () => {
  it("cleans up comments-changed listener even on rapid unmount", async () => {
    const mockUnlisten = vi.fn();
    let resolveCommentsChanged!: (fn: () => void) => void;
    let _resolveFileChanged!: (fn: () => void) => void;

    // First listen call = comments-changed, second = file-changed
    vi.mocked(listen)
      .mockReturnValueOnce(
        new Promise((r) => {
          resolveCommentsChanged = r;
        })
      )
      .mockReturnValueOnce(
        new Promise((r) => {
          _resolveFileChanged = r;
        })
      );

    const { unmount } = renderHook(() => useComments("/test.md"));

    // Unmount immediately before listen promises resolve
    unmount();

    // Now resolve the listen promise — cleanup should still call unlisten
    resolveCommentsChanged(mockUnlisten);
    await flushPromises();

    expect(mockUnlisten).toHaveBeenCalled();
  });

  it("cleans up file-changed listener even on rapid unmount", async () => {
    const mockUnlisten = vi.fn();
    let _resolveCommentsChanged!: (fn: () => void) => void;
    let resolveFileChanged!: (fn: () => void) => void;

    vi.mocked(listen)
      .mockReturnValueOnce(
        new Promise((r) => {
          _resolveCommentsChanged = r;
        })
      )
      .mockReturnValueOnce(
        new Promise((r) => {
          resolveFileChanged = r;
        })
      );

    const { unmount } = renderHook(() => useComments("/test.md"));

    unmount();

    // Resolve the file-changed listener
    resolveFileChanged(mockUnlisten);
    await flushPromises();

    expect(mockUnlisten).toHaveBeenCalled();
  });

  it("cleans up listener normally when promise resolves before unmount", async () => {
    const mockUnlisten = vi.fn();

    vi.mocked(listen).mockResolvedValue(mockUnlisten);

    const { unmount } = renderHook(() => useComments("/test.md"));

    // Let the listen promises resolve
    await flushPromises();

    unmount();

    // Cleanup is via .then(), so we need to flush the microtask
    await flushPromises();

    expect(mockUnlisten).toHaveBeenCalled();
  });

  it("does not set up listeners when filePath is null", async () => {
    renderHook(() => useComments(null));

    await flushPromises();

    // listen should not be called for null filePath (only initial load effect runs)
    expect(listen).not.toHaveBeenCalled();
  });
});
