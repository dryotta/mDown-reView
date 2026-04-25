import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const mockUnlisten = vi.fn();
const argsListeners: Array<() => void> = [];
const callOrder: string[] = [];
const mockOpenFilesFromArgs = vi.fn();
const mockGetState = vi.fn(() => ({ __isStoreState: true }));

vi.mock("@/lib/tauri-events", () => ({
  listenEvent: vi.fn((event: string, cb: () => void) => {
    callOrder.push("listenEvent:" + event);
    if (event === "args-received") argsListeners.push(cb);
    return Promise.resolve(mockUnlisten);
  }),
}));

const mockGetLaunchArgs = vi.fn();
vi.mock("@/lib/tauri-commands", () => ({
  getLaunchArgs: () => {
    callOrder.push("getLaunchArgs");
    return mockGetLaunchArgs();
  },
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
  callOrder.length = 0;
});

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

describe("useLaunchArgsBootstrap", () => {
  it("attaches the args-received listener BEFORE issuing the initial getLaunchArgs", async () => {
    mockGetLaunchArgs.mockResolvedValue({ files: [], folders: [] });

    const { useLaunchArgsBootstrap } = await import("../useLaunchArgsBootstrap");
    renderHook(() => useLaunchArgsBootstrap());
    await flush();

    // Order matters: a second-instance signal that races the initial fetch
    // would be lost if the listener were registered after the await.
    expect(callOrder[0]).toBe("listenEvent:args-received");
    expect(callOrder[1]).toBe("getLaunchArgs");
  });

  it("calls openFilesFromArgs with the initial getLaunchArgs result", async () => {
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

  it("skips openFilesFromArgs when the drain returns no files and no folders", async () => {
    mockGetLaunchArgs.mockResolvedValueOnce({ files: [], folders: [] });

    const { useLaunchArgsBootstrap } = await import("../useLaunchArgsBootstrap");
    renderHook(() => useLaunchArgsBootstrap());
    await flush();

    expect(mockOpenFilesFromArgs).not.toHaveBeenCalled();
  });

  it("re-drains via getLaunchArgs when an args-received signal arrives", async () => {
    // Initial drain returns empty; second-instance signal triggers a second drain.
    mockGetLaunchArgs.mockResolvedValueOnce({ files: [], folders: [] });
    mockGetLaunchArgs.mockResolvedValueOnce({ files: ["/x.md"], folders: ["/y"] });

    const { useLaunchArgsBootstrap } = await import("../useLaunchArgsBootstrap");
    renderHook(() => useLaunchArgsBootstrap());
    await flush();

    expect(argsListeners.length).toBe(1);
    expect(mockOpenFilesFromArgs).not.toHaveBeenCalled();

    // args-received is signal-only — no payload.
    argsListeners[0]();
    await flush();

    expect(mockGetLaunchArgs).toHaveBeenCalledTimes(2);
    expect(mockOpenFilesFromArgs).toHaveBeenCalledTimes(1);
    expect(mockOpenFilesFromArgs).toHaveBeenCalledWith(
      ["/x.md"],
      ["/y"],
      { __isStoreState: true },
    );
  });

  it("applies the initial drain's result even if the component unmounted before it resolved (queue was already shifted, so dropping the result would lose user data)", async () => {
    let resolve!: (v: { files: string[]; folders: string[] }) => void;
    mockGetLaunchArgs.mockReturnValueOnce(
      new Promise((r) => { resolve = r; }),
    );

    const { useLaunchArgsBootstrap } = await import("../useLaunchArgsBootstrap");
    const { unmount } = renderHook(() => useLaunchArgsBootstrap());

    unmount();
    resolve({ files: ["/a.md"], folders: [] });
    await flush();

    expect(mockOpenFilesFromArgs).toHaveBeenCalledTimes(1);
    expect(mockOpenFilesFromArgs).toHaveBeenCalledWith(
      ["/a.md"],
      [],
      { __isStoreState: true },
    );
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
