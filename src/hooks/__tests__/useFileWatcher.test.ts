import { renderHook, act } from "@testing-library/react";
import { useStore } from "@/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import { useFileWatcher } from "../useFileWatcher";
import { scanReviewFiles } from "@/lib/tauri-commands";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_eventName: string, _callback: unknown) =>
    Promise.resolve(() => {})
  ),
}));

vi.mock("@/lib/tauri-commands", () => ({
  updateWatchedFiles: vi.fn().mockResolvedValue(undefined),
  scanReviewFiles: vi.fn().mockResolvedValue([]),
}));

describe("WatcherSlice", () => {
  beforeEach(() => {
    useStore.setState({
      ghostEntries: [],
      autoReveal: true,
      lastSaveByPath: {},
    });
  });

  it("ghostEntries defaults to empty", () => {
    expect(useStore.getState().ghostEntries).toEqual([]);
  });

  it("setGhostEntries updates entries", () => {
    const entries = [
      { sidecarPath: "/a.review.json", sourcePath: "/a" },
      { sidecarPath: "/b.review.json", sourcePath: "/b" },
    ];
    useStore.getState().setGhostEntries(entries);
    expect(useStore.getState().ghostEntries).toEqual(entries);
  });

  it("autoReveal defaults to true", () => {
    expect(useStore.getState().autoReveal).toBe(true);
  });

  it("toggleAutoReveal toggles", () => {
    useStore.getState().toggleAutoReveal();
    expect(useStore.getState().autoReveal).toBe(false);
    useStore.getState().toggleAutoReveal();
    expect(useStore.getState().autoReveal).toBe(true);
  });

  it("lastSaveByPath defaults to empty object", () => {
    expect(useStore.getState().lastSaveByPath).toEqual({});
  });

  it("recordSave records timestamp for the given path", () => {
    const before = Date.now();
    useStore.getState().recordSave("/some/file.md");
    const after = Date.now();
    const ts = useStore.getState().lastSaveByPath["/some/file.md"];
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

// Helper to extract the file-changed listener callback registered by the hook
function getFileChangedCallback() {
  const call = vi.mocked(listen).mock.calls.find((c) => c[0] === "file-changed");
  if (!call) throw new Error("listen('file-changed', ...) was never called");
  return call[1] as (event: { payload: { path: string; kind: string } }) => void;
}

describe("useFileWatcher debounced deletion scan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useStore.setState({
      root: "/workspace",
      tabs: [],
      lastSaveByPath: {},
      ghostEntries: [],
      autoReveal: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should scan on source file deletion (detects new ghost entries)", async () => {
    renderHook(() => useFileWatcher());
    await act(async () => {});

    vi.mocked(scanReviewFiles).mockClear();
    const callback = getFileChangedCallback();

    act(() => {
      callback({ payload: { path: "/some/file.ts", kind: "deleted" } });
    });

    // Scan is debounced — not called immediately
    expect(scanReviewFiles).not.toHaveBeenCalled();

    // After debounce timer fires
    act(() => { vi.advanceTimersByTime(500); });

    expect(scanReviewFiles).toHaveBeenCalledWith("/workspace");
  });

  it("should scan on .review.yaml sidecar file deletion", async () => {
    renderHook(() => useFileWatcher());
    await act(async () => {});

    vi.mocked(scanReviewFiles).mockClear();
    const callback = getFileChangedCallback();

    act(() => {
      callback({ payload: { path: "/some/file.md.review.yaml", kind: "deleted" } });
    });

    act(() => { vi.advanceTimersByTime(500); });

    expect(scanReviewFiles).toHaveBeenCalledWith("/workspace");
  });

  it("should scan on .review.json sidecar file deletion", async () => {
    renderHook(() => useFileWatcher());
    await act(async () => {});

    vi.mocked(scanReviewFiles).mockClear();
    const callback = getFileChangedCallback();

    act(() => {
      callback({ payload: { path: "/some/file.md.review.json", kind: "deleted" } });
    });

    act(() => { vi.advanceTimersByTime(500); });

    expect(scanReviewFiles).toHaveBeenCalledWith("/workspace");
  });

  it("should not scan on non-delete event for sidecar file", async () => {
    renderHook(() => useFileWatcher());
    await act(async () => {});

    vi.mocked(scanReviewFiles).mockClear();
    const callback = getFileChangedCallback();

    act(() => {
      callback({ payload: { path: "/some/file.md.review.json", kind: "content" } });
    });

    act(() => { vi.advanceTimersByTime(500); });

    expect(scanReviewFiles).not.toHaveBeenCalled();
  });

  it("should coalesce rapid deletions into a single scan", async () => {
    renderHook(() => useFileWatcher());
    await act(async () => {});

    vi.mocked(scanReviewFiles).mockClear();
    const callback = getFileChangedCallback();

    // Fire 5 deletions in quick succession
    act(() => {
      callback({ payload: { path: "/some/a.ts", kind: "deleted" } });
      callback({ payload: { path: "/some/b.md", kind: "deleted" } });
      callback({ payload: { path: "/some/c.review.yaml", kind: "deleted" } });
      callback({ payload: { path: "/some/d.ts", kind: "deleted" } });
      callback({ payload: { path: "/some/e.review.json", kind: "deleted" } });
    });

    act(() => { vi.advanceTimersByTime(500); });

    // Only one scan despite 5 deletions
    expect(scanReviewFiles).toHaveBeenCalledTimes(1);
  });
});

describe("useFileWatcher save-loop suppression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useStore.setState({
      root: "/workspace",
      tabs: [{ path: "/workspace/file.md", scrollTop: 0 }],
      lastSaveByPath: {},
      ghostEntries: [],
      autoReveal: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("suppresses file-changed event within save debounce window", async () => {
    renderHook(() => useFileWatcher());
    await act(async () => {});

    const callback = getFileChangedCallback();
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    // Record a save for the file (sets lastSaveByPath timestamp to "now")
    act(() => {
      useStore.getState().recordSave("/workspace/file.md");
    });

    // File-changed event arrives for the same path within the debounce window
    act(() => {
      callback({ payload: { path: "/workspace/file.md", kind: "content" } });
    });

    // CustomEvent should NOT have been dispatched (save-loop suppression)
    const fileChangedEvents = dispatchSpy.mock.calls.filter(
      (call) => call[0] instanceof CustomEvent && call[0].type === "mdownreview:file-changed"
    );
    expect(fileChangedEvents).toHaveLength(0);

    dispatchSpy.mockRestore();
  });

  it("allows file-changed event outside save debounce window", async () => {
    renderHook(() => useFileWatcher());
    await act(async () => {});

    const callback = getFileChangedCallback();
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    // Record a save, then advance time past the 1500ms debounce window
    act(() => {
      useStore.getState().recordSave("/workspace/file.md");
    });
    act(() => {
      vi.advanceTimersByTime(1600);
    });

    // File-changed event arrives after the debounce window
    act(() => {
      callback({ payload: { path: "/workspace/file.md", kind: "content" } });
    });

    const fileChangedEvents = dispatchSpy.mock.calls.filter(
      (call) => call[0] instanceof CustomEvent && call[0].type === "mdownreview:file-changed"
    );
    expect(fileChangedEvents).toHaveLength(1);

    dispatchSpy.mockRestore();
  });

  it("does not suppress events for paths without a recent save", async () => {
    renderHook(() => useFileWatcher());
    await act(async () => {});

    const callback = getFileChangedCallback();
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    // Record save for a different file
    act(() => {
      useStore.getState().recordSave("/workspace/other.md");
    });

    // File-changed event for a file with no save record
    act(() => {
      callback({ payload: { path: "/workspace/file.md", kind: "content" } });
    });

    const fileChangedEvents = dispatchSpy.mock.calls.filter(
      (call) => call[0] instanceof CustomEvent && call[0].type === "mdownreview:file-changed"
    );
    expect(fileChangedEvents).toHaveLength(1);

    dispatchSpy.mockRestore();
  });
});
