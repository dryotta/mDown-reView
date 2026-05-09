import { renderHook, act } from "@testing-library/react";
import { useStore } from "@/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listenEvent } from "@/lib/tauri-events";
import type { EventPayloads } from "@/lib/tauri-events";
import { useFileWatcher } from "../useFileWatcher";
import { scanReviewFiles, updateWatchedFiles } from "@/lib/tauri-commands";
import {
  fileChangedContent,
  fileChangedDeleted,
  fileChangedReview,
  fileChangedReviewJson,
} from "@/__tests__/fixtures/ipc-event-fixtures";

vi.mock("@/lib/tauri-events", () => ({
  listenEvent: vi.fn((_eventName: string, _callback: unknown) =>
    Promise.resolve(() => {})
  ),
}));

vi.mock("@/lib/tauri-commands", () => ({
  updateWatchedFiles: vi.fn().mockResolvedValue(undefined),
  scanReviewFiles: vi.fn().mockResolvedValue([]),
  // Issue #352 / iter-15 — multi-window file singleton. tabs.ts
  // openFile/closeTab/closeAllTabs fire these on every mutation.
  // Default to "Claimed" so existing tests don't trigger the
  // revert path.
  claimOpenFile: vi.fn().mockResolvedValue({ kind: "claimed" }),
  releaseOpenFile: vi.fn().mockResolvedValue(undefined),
  releaseOpenFiles: vi.fn().mockResolvedValue(undefined),
  // Issue #359 — tabs.ts openFile awaits this before inserting.
  registerWindowFile: vi
    .fn()
    .mockImplementation(async (path: string) => ({
      canonical: path,
      classification: { tier: "inside", canonical: path },
    })),
}));

describe("WatcherSlice", () => {
  beforeEach(() => {
    useStore.setState({
      ghostEntries: [],
      lastSaveByPath: {},
    });
  });

  it("ghostEntries defaults to empty", async () => {
    expect(useStore.getState().ghostEntries).toEqual([]);
  });

  it("setGhostEntries updates entries", async () => {
    const entries = [
      { sidecarPath: "/a.review.json", sourcePath: "/a" },
      { sidecarPath: "/b.review.json", sourcePath: "/b" },
    ];
    useStore.getState().setGhostEntries(entries);
    expect(useStore.getState().ghostEntries).toEqual(entries);
  });

  it("lastSaveByPath defaults to empty object", async () => {
    expect(useStore.getState().lastSaveByPath).toEqual({});
  });

  it("recordSave records timestamp for the given path", async () => {
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
  const call = vi.mocked(listenEvent).mock.calls.find((c) => c[0] === "file-changed");
  if (!call) throw new Error("listenEvent('file-changed', ...) was never called");
  return call[1] as (payload: EventPayloads["file-changed"]) => void;
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
      callback(fileChangedDeleted("/some/file.ts"));
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
      callback(fileChangedDeleted("/some/file.md.review.yaml"));
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
      callback(fileChangedDeleted("/some/file.md.review.json"));
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
      callback(fileChangedReviewJson("/some/file.md.review.json"));
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
      callback(fileChangedDeleted("/some/a.ts"));
      callback(fileChangedDeleted("/some/b.md"));
      callback(fileChangedDeleted("/some/c.review.yaml"));
      callback(fileChangedDeleted("/some/d.ts"));
      callback(fileChangedDeleted("/some/e.review.json"));
    });

    act(() => { vi.advanceTimersByTime(500); });

    // Only one scan despite 5 deletions
    expect(scanReviewFiles).toHaveBeenCalledTimes(1);
  });
});

describe("useFileWatcher sidecar-config-changed listener", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useStore.setState({
      root: "/workspace",
      tabs: [],
      lastSaveByPath: {},
      ghostEntries: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-scans ghosts when sidecar-config-changed fires (debounced)", async () => {
    renderHook(() => useFileWatcher());
    await act(async () => {});

    // Clear initial root-change scan so the assertion is unambiguous
    vi.mocked(scanReviewFiles).mockClear();

    const call = vi
      .mocked(listenEvent)
      .mock.calls.find((c) => c[0] === "sidecar-config-changed");
    if (!call) throw new Error("listenEvent('sidecar-config-changed', ...) was never called");
    const callback = call[1] as (payload: { path: string }) => void;

    act(() => {
      callback({ path: "/workspace/.mrsf.yaml" });
    });

    // Debounced — not invoked synchronously
    expect(scanReviewFiles).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(500); });

    expect(scanReviewFiles).toHaveBeenCalledWith("/workspace");
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
      callback(fileChangedContent("/workspace/file.md"));
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
      callback(fileChangedContent("/workspace/file.md"));
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
      callback(fileChangedContent("/workspace/file.md"));
    });

    const fileChangedEvents = dispatchSpy.mock.calls.filter(
      (call) => call[0] instanceof CustomEvent && call[0].type === "mdownreview:file-changed"
    );
    expect(fileChangedEvents).toHaveLength(1);

    dispatchSpy.mockRestore();
  });

  // #298 iter 3 — sidecar→source path normalization. The watcher emits
  // the SIDECAR path for kind=review events, but `lastSaveByPath` is
  // keyed by the SOURCE path (matching `recordSave` callers). Without
  // `sourcePathFromEvent` the suppression silently no-ops on every
  // external sidecar edit. Same fix shape as `useFileBadges.ts:40-44`.
  it("suppresses kind=review event with sidecar path when source path was recently saved", async () => {
    renderHook(() => useFileWatcher());
    await act(async () => {});

    const callback = getFileChangedCallback();
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    // Save was recorded for the SOURCE path…
    act(() => {
      useStore.getState().recordSave("/workspace/file.md");
    });

    // …but the watcher fires with the SIDECAR path (the real shape
    // for kind=review events).
    act(() => {
      callback(fileChangedReview("/workspace/file.md.review.yaml"));
    });

    const fileChangedEvents = dispatchSpy.mock.calls.filter(
      (call) => call[0] instanceof CustomEvent && call[0].type === "mdownreview:file-changed"
    );
    expect(fileChangedEvents).toHaveLength(0);

    dispatchSpy.mockRestore();
  });

  it("suppresses kind=review event with .review.json sidecar path", async () => {
    renderHook(() => useFileWatcher());
    await act(async () => {});

    const callback = getFileChangedCallback();
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    act(() => {
      useStore.getState().recordSave("/workspace/file.md");
    });
    act(() => {
      callback(fileChangedReviewJson("/workspace/file.md.review.json"));
    });

    const fileChangedEvents = dispatchSpy.mock.calls.filter(
      (call) => call[0] instanceof CustomEvent && call[0].type === "mdownreview:file-changed"
    );
    expect(fileChangedEvents).toHaveLength(0);

    dispatchSpy.mockRestore();
  });
});

describe("useFileWatcher tabPaths stability — RC2/P1.1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      root: "/workspace",
      tabs: [{ path: "/a.md", scrollTop: 0 }],
      lastSaveByPath: {},
      ghostEntries: [],
    });
  });

  it("scroll bursts do NOT fire updateWatchedFiles", async () => {
    renderHook(() => useFileWatcher());
    await act(async () => {});

    vi.mocked(updateWatchedFiles).mockClear();

    for (let i = 1; i <= 50; i++) {
      act(() => {
        useStore.getState().setScrollTop("/a.md", i);
      });
    }
    await act(async () => {});

    expect(updateWatchedFiles).toHaveBeenCalledTimes(0);
  });

  it("opening a new tab fires updateWatchedFiles once with the new path list", async () => {
    renderHook(() => useFileWatcher());
    await act(async () => {});

    vi.mocked(updateWatchedFiles).mockClear();

    await act(async () => {
      await useStore.getState().openFile("/b.md");
    });
    await act(async () => {});

    expect(updateWatchedFiles).toHaveBeenCalledTimes(1);
    const args = vi.mocked(updateWatchedFiles).mock.calls[0][0];
    expect(args).toEqual(expect.arrayContaining(["/a.md", "/b.md"]));
  });

  it("closing a tab fires updateWatchedFiles once with the shrunken list", async () => {
    useStore.setState({
      root: "/workspace",
      tabs: [
        { path: "/a.md", scrollTop: 0 },
        { path: "/b.md", scrollTop: 0 },
      ],
      lastSaveByPath: {},
      ghostEntries: [],
    });

    renderHook(() => useFileWatcher());
    await act(async () => {});

    vi.mocked(updateWatchedFiles).mockClear();

    act(() => {
      useStore.getState().closeTab("/b.md");
    });
    await act(async () => {});

    expect(updateWatchedFiles).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateWatchedFiles).mock.calls[0][0]).toEqual(["/a.md"]);
  });
});

// The #311 review-event regression tests were rebased away — PR #299
// (issue #298 iter-3) added the sidecar→source path normalization that
// R7 was meant to drive, AND added two superior tests covering both
// `.review.yaml` and `.review.json` sidecars at lines 276-322 above
// ("suppresses kind=review event with sidecar path when source path was
// recently saved" / ".review.json sidecar path"). Those tests assert
// the contract-correct behavior (suppression engages because the hook
// normalizes the sidecar path to the source key) — which is exactly
// the R7 oracle. The hook now FAILS to suppress only if it regresses
// to using the raw watcher path as the lookup key (i.e. drops
// `sourcePathFromEvent`). Keeping a duplicate Group E describe here
// would be dead weight per AGENTS.md "Never Increase Engineering Debt".
