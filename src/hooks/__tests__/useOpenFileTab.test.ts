import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const mockUnlisten = vi.fn();
const openFileTabListeners: Array<(paths: string[]) => void> = [];
const mockOpenFile = vi.fn();

vi.mock("@/lib/tauri-events", () => ({
  listenEvent: vi.fn((event: string, cb: (payload: unknown) => void) => {
    if (event === "open-file-tab") openFileTabListeners.push(cb as (paths: string[]) => void);
    return Promise.resolve(mockUnlisten);
  }),
}));

vi.mock("@/store", () => ({
  useStore: { getState: () => ({ openFile: mockOpenFile }) },
}));

vi.mock("@/logger", () => ({
  error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  openFileTabListeners.length = 0;
});

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

describe("useOpenFileTab", () => {
  it("calls openFile for each path when open-file-tab is emitted", async () => {
    const { useOpenFileTab } = await import("../useOpenFileTab");
    renderHook(() => useOpenFileTab());
    await flush();

    expect(openFileTabListeners).toHaveLength(1);

    openFileTabListeners[0](["/path/to/file.md", "/another/file.txt"]);

    expect(mockOpenFile).toHaveBeenCalledTimes(2);
    expect(mockOpenFile).toHaveBeenCalledWith("/path/to/file.md");
    expect(mockOpenFile).toHaveBeenCalledWith("/another/file.txt");
  });

  it("handles a single file path", async () => {
    const { useOpenFileTab } = await import("../useOpenFileTab");
    renderHook(() => useOpenFileTab());
    await flush();

    openFileTabListeners[0](["/single/file.md"]);

    expect(mockOpenFile).toHaveBeenCalledTimes(1);
    expect(mockOpenFile).toHaveBeenCalledWith("/single/file.md");
  });

  it("handles an empty array without error", async () => {
    const { useOpenFileTab } = await import("../useOpenFileTab");
    renderHook(() => useOpenFileTab());
    await flush();

    openFileTabListeners[0]([]);

    expect(mockOpenFile).not.toHaveBeenCalled();
  });

  it("unsubscribes from open-file-tab on unmount", async () => {
    const { useOpenFileTab } = await import("../useOpenFileTab");
    const { unmount } = renderHook(() => useOpenFileTab());
    await flush();

    unmount();
    await flush();

    expect(mockUnlisten).toHaveBeenCalled();
  });
});
