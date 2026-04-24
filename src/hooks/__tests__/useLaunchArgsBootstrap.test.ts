import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const mockUnlisten = vi.fn();
const argsListeners: Array<(event: { payload: { files: string[]; folders: string[] } }) => void> = [];
const mockOpenFilesFromArgs = vi.fn();
const mockGetState = vi.fn(() => ({ __isStoreState: true }));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, cb: (event: { payload: { files: string[]; folders: string[] } }) => void) => {
    if (event === "args-received") argsListeners.push(cb);
    return Promise.resolve(mockUnlisten);
  }),
}));

const mockGetLaunchArgs = vi.fn();
vi.mock("@/lib/tauri-commands", () => ({
  getLaunchArgs: () => mockGetLaunchArgs(),
}));

vi.mock("@/store", () => ({
  useStore: { getState: () => mockGetState() },
  openFilesFromArgs: (...args: unknown[]) => mockOpenFilesFromArgs(...args),
}));

vi.mock("@/logger", () => ({
  error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  argsListeners.length = 0;
});

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

describe("useLaunchArgsBootstrap", () => {
  it("calls openFilesFromArgs with initial getLaunchArgs result", async () => {
    mockGetLaunchArgs.mockResolvedValueOnce({
      files: ["/a.md"],
      folders: ["/folder"],
    });

    const { useLaunchArgsBootstrap } = await import("../useLaunchArgsBootstrap");
    renderHook(() => useLaunchArgsBootstrap());
    await flush();

    expect(mockOpenFilesFromArgs).toHaveBeenCalledTimes(1);
    expect(mockOpenFilesFromArgs).toHaveBeenCalledWith(
      ["/a.md"],
      ["/folder"],
      { __isStoreState: true },
    );
  });

  it("calls openFilesFromArgs again when args-received event fires", async () => {
    mockGetLaunchArgs.mockResolvedValueOnce({ files: [], folders: [] });

    const { useLaunchArgsBootstrap } = await import("../useLaunchArgsBootstrap");
    renderHook(() => useLaunchArgsBootstrap());
    await flush();

    expect(argsListeners.length).toBe(1);
    expect(mockOpenFilesFromArgs).toHaveBeenCalledTimes(1);

    argsListeners[0]({ payload: { files: ["/x.md"], folders: ["/y"] } });

    expect(mockOpenFilesFromArgs).toHaveBeenCalledTimes(2);
    expect(mockOpenFilesFromArgs).toHaveBeenLastCalledWith(
      ["/x.md"],
      ["/y"],
      { __isStoreState: true },
    );
  });

  it("does not call openFilesFromArgs from initial result if unmounted before resolve", async () => {
    let resolve!: (v: { files: string[]; folders: string[] }) => void;
    mockGetLaunchArgs.mockReturnValueOnce(
      new Promise((r) => { resolve = r; }),
    );

    const { useLaunchArgsBootstrap } = await import("../useLaunchArgsBootstrap");
    const { unmount } = renderHook(() => useLaunchArgsBootstrap());

    unmount();
    resolve({ files: ["/a.md"], folders: [] });
    await flush();

    expect(mockOpenFilesFromArgs).not.toHaveBeenCalled();
  });

  it("unsubscribes from args-received on unmount", async () => {
    mockGetLaunchArgs.mockResolvedValueOnce({ files: [], folders: [] });

    const { useLaunchArgsBootstrap } = await import("../useLaunchArgsBootstrap");
    const { unmount } = renderHook(() => useLaunchArgsBootstrap());
    await flush();

    unmount();
    await flush();

    expect(mockUnlisten).toHaveBeenCalled();
  });

  it("swallows errors from getLaunchArgs", async () => {
    mockGetLaunchArgs.mockRejectedValueOnce(new Error("boom"));

    const { useLaunchArgsBootstrap } = await import("../useLaunchArgsBootstrap");
    expect(() => renderHook(() => useLaunchArgsBootstrap())).not.toThrow();
    await flush();

    expect(mockOpenFilesFromArgs).not.toHaveBeenCalled();
  });
});
