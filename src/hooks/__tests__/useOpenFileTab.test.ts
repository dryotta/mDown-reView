import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const mockUnlisten = vi.fn();
const openFileTabListeners: Array<(paths: string[]) => void | Promise<void>> = [];
const mockOpenFile = vi.fn();
const mockCanonicalize = vi.fn(async (p: string) => p);

vi.mock("@/lib/tauri-events", () => ({
  listenEvent: vi.fn((event: string, cb: (payload: unknown) => void | Promise<void>) => {
    if (event === "open-file-tab")
      openFileTabListeners.push(cb as (paths: string[]) => void | Promise<void>);
    return Promise.resolve(mockUnlisten);
  }),
}));

vi.mock("@/store", () => ({
  useStore: { getState: () => ({ openFile: mockOpenFile }) },
}));

vi.mock("@/store/canonicalize", () => ({
  canonicalizeOrFallback: mockCanonicalize,
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
  openFileTabListeners.length = 0;
  // `vi.clearAllMocks` resets `mockCanonicalize`'s implementation, so
  // restore the identity fallback used by all tests except the explicit
  // canonicalisation regression test below.
  mockCanonicalize.mockImplementation(async (p: string) => p);
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

    await openFileTabListeners[0](["/path/to/file.md", "/another/file.txt"]);

    expect(mockOpenFile).toHaveBeenCalledTimes(2);
    expect(mockOpenFile).toHaveBeenCalledWith("/path/to/file.md");
    expect(mockOpenFile).toHaveBeenCalledWith("/another/file.txt");
  });

  it("handles a single file path", async () => {
    const { useOpenFileTab } = await import("../useOpenFileTab");
    renderHook(() => useOpenFileTab());
    await flush();

    await openFileTabListeners[0](["/single/file.md"]);

    expect(mockOpenFile).toHaveBeenCalledTimes(1);
    expect(mockOpenFile).toHaveBeenCalledWith("/single/file.md");
  });

  it("handles an empty array without error", async () => {
    const { useOpenFileTab } = await import("../useOpenFileTab");
    renderHook(() => useOpenFileTab());
    await flush();

    await openFileTabListeners[0]([]);

    expect(mockOpenFile).not.toHaveBeenCalled();
  });

  it("canonicalises each path before opening (rule multiwin-canonicalize-at-ingest)", async () => {
    // Map short-name → long-form so we can verify the stored tab path is
    // the canonical one, not the raw payload.
    mockCanonicalize.mockImplementation(async (p: string) =>
      p === "C:/RUNNER~1/file.md" ? "C:/runneradmin/file.md" : p
    );

    const { useOpenFileTab } = await import("../useOpenFileTab");
    renderHook(() => useOpenFileTab());
    await flush();

    await openFileTabListeners[0](["C:/RUNNER~1/file.md", "/already/canonical.md"]);

    expect(mockCanonicalize).toHaveBeenCalledWith("C:/RUNNER~1/file.md");
    expect(mockCanonicalize).toHaveBeenCalledWith("/already/canonical.md");
    // openFile must receive the canonical form so the tab key matches
    // what `scan_review_files` and `openFilesFromArgs` produce.
    expect(mockOpenFile).toHaveBeenCalledWith("C:/runneradmin/file.md");
    expect(mockOpenFile).toHaveBeenCalledWith("/already/canonical.md");
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
