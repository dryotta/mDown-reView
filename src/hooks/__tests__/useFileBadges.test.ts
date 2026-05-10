import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { listenEvent } from "@/lib/tauri-events";
import type { EventPayloads } from "@/lib/tauri-events";
import { getFileBadges, type FileBadge } from "@/lib/tauri-commands";
import { useFileBadges } from "../useFileBadges";
import {
  fileChangedContent,
  fileChangedReview,
  fileChangedDeleted,
  commentsChanged,
  ipcEventFixturePaths,
} from "@/__tests__/fixtures/ipc-event-fixtures";

vi.mock("@/lib/tauri-events", () => ({
  listenEvent: vi.fn((_eventName: string, _cb: unknown) => Promise.resolve(() => {})),
  listenDragDrop: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@/lib/tauri-commands", () => ({
  getFileBadges: vi.fn().mockResolvedValue({}),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const A: FileBadge = { count: 3, max_severity: "high", file_level_count: 0 };
const B: FileBadge = { count: 1, max_severity: "low", file_level_count: 0 };

/**
 * Drains the path-change debounce (50 ms) and any pending microtasks
 * so the IPC `.then` handler runs and `setBadges` commits before the
 * next assertion. Combines fake-timer advance with a microtask flush.
 */
async function flushDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(50);
  });
  await act(async () => {});
}

describe("useFileBadges", () => {
  it("returns {} for an empty path list and skips the IPC call", async () => {
    const { result } = renderHook(() => useFileBadges([]));
    await flushDebounce();
    expect(result.current).toEqual({});
    expect(getFileBadges).not.toHaveBeenCalled();
  });

  it("issues a single batched IPC call for the provided paths", async () => {
    vi.mocked(getFileBadges).mockResolvedValueOnce({ "/a.md": A, "/b.md": B });
    const { result, rerender } = renderHook(({ p }: { p: string[] }) => useFileBadges(p), {
      initialProps: { p: ["/a.md", "/b.md"] },
    });
    await flushDebounce();

    // Re-render with the same paths — should NOT re-issue IPC (pathsKey unchanged).
    rerender({ p: ["/a.md", "/b.md"] });
    rerender({ p: ["/a.md", "/b.md"] });
    await flushDebounce();

    expect(getFileBadges).toHaveBeenCalledTimes(1);
    expect(getFileBadges).toHaveBeenCalledWith(["/a.md", "/b.md"]);
    expect(result.current).toEqual({ "/a.md": A, "/b.md": B });
  });

  it("refreshes on comments-changed events", async () => {
    vi.mocked(getFileBadges)
      .mockResolvedValueOnce({ "/a.md": A })
      .mockResolvedValueOnce({ "/a.md": { count: 7, max_severity: "medium", file_level_count: 0 } });

    const { result } = renderHook(() => useFileBadges(["/a.md"]));
    await flushDebounce();
    expect(result.current).toEqual({ "/a.md": A });

    const call = vi.mocked(listenEvent).mock.calls.find((c) => c[0] === "comments-changed");
    expect(call).toBeDefined();
    const cb = call![1] as (payload: EventPayloads["comments-changed"]) => void;
    await act(async () => { cb(commentsChanged()); });
    await flushDebounce();

    expect(getFileBadges).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({ "/a.md": { count: 7, max_severity: "medium", file_level_count: 0 } });
  });

  it("refreshes on file-changed{kind:review} but ignores other kinds", async () => {
    vi.mocked(getFileBadges)
      .mockResolvedValueOnce({ "/a.md": A })
      .mockResolvedValueOnce({ "/a.md": B });

    const { result } = renderHook(() => useFileBadges(["/a.md"]));
    await flushDebounce();

    const call = vi.mocked(listenEvent).mock.calls.find((c) => c[0] === "file-changed");
    const cb = call![1] as (payload: EventPayloads["file-changed"]) => void;

    await act(async () => { cb(fileChangedContent()); });
    await flushDebounce();
    expect(getFileBadges).toHaveBeenCalledTimes(1); // ignored

    await act(async () => { cb(fileChangedReview()); });
    await flushDebounce();
    expect(getFileBadges).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({ "/a.md": B });
  });

  it("dedupes when the result is structurally equal", async () => {
    vi.mocked(getFileBadges)
      .mockResolvedValueOnce({ "/a.md": A })
      .mockResolvedValueOnce({ "/a.md": { count: 3, max_severity: "high", file_level_count: 0 } });

    const { result } = renderHook(() => useFileBadges(["/a.md"]));
    await flushDebounce();
    const firstRef = result.current;

    const call = vi.mocked(listenEvent).mock.calls.find((c) => c[0] === "comments-changed");
    const cb = call![1] as (payload: EventPayloads["comments-changed"]) => void;
    await act(async () => { cb(commentsChanged()); });
    await flushDebounce();

    expect(result.current).toBe(firstRef);
  });

  it("does not call setBadges after unmount (cancelled flag)", async () => {
    let resolveIpc!: (v: Record<string, FileBadge>) => void;
    vi.mocked(getFileBadges).mockReturnValueOnce(
      new Promise<Record<string, FileBadge>>((res) => { resolveIpc = res; })
    );

    const { unmount, result } = renderHook(() => useFileBadges(["/a.md"]));
    // Drain the debounce so the IPC actually fires.
    await act(async () => { vi.advanceTimersByTime(50); });
    unmount();

    await act(async () => { resolveIpc({ "/a.md": A }); });
    await act(async () => {});

    expect(result.current).toEqual({});
  });

  // Fix #5 regression: a burst of pathsKey changes within the
  // debounce window must coalesce into a single IPC call. Pre-fix,
  // every expand caused a fresh full-tree-sized IPC; this is the
  // "stampede" identified in the [badge-diag] audit.
  it("coalesces a burst of pathsKey changes into a single IPC", async () => {
    vi.mocked(getFileBadges).mockResolvedValue({ "/a.md": A, "/b.md": B, "/c.md": A });

    const { rerender } = renderHook(({ p }: { p: string[] }) => useFileBadges(p), {
      initialProps: { p: ["/a.md"] },
    });

    // Five rapid expansions inside the 50 ms debounce window.
    rerender({ p: ["/a.md", "/b.md"] });
    rerender({ p: ["/a.md", "/b.md", "/c.md"] });
    rerender({ p: ["/a.md", "/b.md"] });
    rerender({ p: ["/a.md", "/b.md", "/c.md"] });
    await act(async () => { vi.advanceTimersByTime(40); });
    expect(getFileBadges).not.toHaveBeenCalled();

    // Drain the debounce and the IPC microtask.
    await flushDebounce();
    expect(getFileBadges).toHaveBeenCalledTimes(1);
    expect(getFileBadges).toHaveBeenLastCalledWith(["/a.md", "/b.md", "/c.md"]);
  });

  // Fix #5 regression: when a fresh pathsKey change arrives while a
  // previous IPC is in flight, the earlier call's result must be
  // discarded so it cannot clobber the fresher state out of order.
  it("discards a stale in-flight IPC when paths change again", async () => {
    let resolveStale!: (v: Record<string, FileBadge>) => void;
    let resolveFresh!: (v: Record<string, FileBadge>) => void;
    vi.mocked(getFileBadges)
      .mockReturnValueOnce(new Promise<Record<string, FileBadge>>((r) => { resolveStale = r; }))
      .mockReturnValueOnce(new Promise<Record<string, FileBadge>>((r) => { resolveFresh = r; }));

    const { result, rerender } = renderHook(({ p }: { p: string[] }) => useFileBadges(p), {
      initialProps: { p: ["/a.md"] },
    });

    // Drain the first debounce so the stale IPC starts.
    await act(async () => { vi.advanceTimersByTime(50); });
    expect(getFileBadges).toHaveBeenCalledTimes(1);

    // Change paths — second IPC starts after the next debounce.
    rerender({ p: ["/a.md", "/b.md"] });
    await act(async () => { vi.advanceTimersByTime(50); });
    expect(getFileBadges).toHaveBeenCalledTimes(2);

    // Stale call resolves AFTER the fresh one was scheduled. Its
    // result must be ignored.
    await act(async () => { resolveStale({ "/a.md": A }); });
    await act(async () => {});
    expect(result.current).toEqual({});

    // Fresh call resolves — its result wins.
    await act(async () => { resolveFresh({ "/a.md": A, "/b.md": B }); });
    await act(async () => {});
    expect(result.current).toEqual({ "/a.md": A, "/b.md": B });
  });
});

describe("useFileBadges echo suppression — RC5/P1.4", () => {
  it("still refreshes exactly once on a single comments-changed event", async () => {
    vi.mocked(getFileBadges).mockResolvedValue({ "/a.md": A });

    renderHook(() => useFileBadges(["/a.md"]));
    await flushDebounce();
    vi.mocked(getFileBadges).mockClear();

    const call = vi.mocked(listenEvent).mock.calls.find((c) => c[0] === "comments-changed");
    expect(call).toBeDefined();
    const cb = call![1] as (payload: EventPayloads["comments-changed"]) => void;

    await act(async () => { cb(commentsChanged("/a.md")); });
    await flushDebounce();

    expect(getFileBadges).toHaveBeenCalledTimes(1);
  });

  it("suppresses a file-changed kind=review echo arriving within SAVE_DEBOUNCE_MS for the same path", async () => {
    vi.mocked(getFileBadges).mockResolvedValue({ "/a.md": A });

    renderHook(() => useFileBadges(["/a.md"]));
    await flushDebounce();
    vi.mocked(getFileBadges).mockClear();

    const cChanged = vi.mocked(listenEvent).mock.calls.find((c) => c[0] === "comments-changed");
    const fChanged = vi.mocked(listenEvent).mock.calls.find((c) => c[0] === "file-changed");
    expect(cChanged).toBeDefined();
    expect(fChanged).toBeDefined();
    const cCb = cChanged![1] as (payload: EventPayloads["comments-changed"]) => void;
    const fCb = fChanged![1] as (payload: EventPayloads["file-changed"]) => void;

    // Local save: comments-changed fires first.
    await act(async () => { cCb(commentsChanged("/a.md")); });
    await flushDebounce();
    expect(getFileBadges).toHaveBeenCalledTimes(1);

    // Watcher echo arrives ~500 ms later, well within SAVE_DEBOUNCE_MS=1500.
    // Watcher emits the SIDECAR path, not the source path.
    await act(async () => { vi.advanceTimersByTime(500); });
    await act(async () => { fCb(fileChangedReview("/a.md.review.yaml")); });
    await flushDebounce();

    // Suppressed — no extra refetch (AC6).
    expect(getFileBadges).toHaveBeenCalledTimes(1);
  });

  it("does NOT suppress a file-changed kind=review event arriving outside SAVE_DEBOUNCE_MS", async () => {
    vi.mocked(getFileBadges).mockResolvedValue({ "/a.md": A });

    renderHook(() => useFileBadges(["/a.md"]));
    await flushDebounce();
    vi.mocked(getFileBadges).mockClear();

    const cCb = vi.mocked(listenEvent).mock.calls.find((c) => c[0] === "comments-changed")![1] as (p: EventPayloads["comments-changed"]) => void;
    const fCb = vi.mocked(listenEvent).mock.calls.find((c) => c[0] === "file-changed")![1] as (p: EventPayloads["file-changed"]) => void;

    await act(async () => { cCb(commentsChanged("/a.md")); });
    await flushDebounce();
    expect(getFileBadges).toHaveBeenCalledTimes(1);

    // Past the suppression window — treat as external edit. Watcher
    // emits the SIDECAR path.
    await act(async () => { vi.advanceTimersByTime(1600); });
    await act(async () => { fCb(fileChangedReview("/a.md.review.yaml")); });
    await flushDebounce();

    expect(getFileBadges).toHaveBeenCalledTimes(2);
  });

  it("does NOT suppress a file-changed kind=review event for a different path", async () => {
    vi.mocked(getFileBadges).mockResolvedValue({ "/a.md": A, "/b.md": B });

    renderHook(() => useFileBadges(["/a.md", "/b.md"]));
    await flushDebounce();
    vi.mocked(getFileBadges).mockClear();

    const cCb = vi.mocked(listenEvent).mock.calls.find((c) => c[0] === "comments-changed")![1] as (p: EventPayloads["comments-changed"]) => void;
    const fCb = vi.mocked(listenEvent).mock.calls.find((c) => c[0] === "file-changed")![1] as (p: EventPayloads["file-changed"]) => void;

    await act(async () => { cCb(commentsChanged("/a.md")); });
    await flushDebounce();
    expect(getFileBadges).toHaveBeenCalledTimes(1);

    // file-changed for a different source — no suppression entry
    // matches (sidecar normalizes to /b.md, not /a.md).
    await act(async () => { fCb(fileChangedReview("/b.md.review.yaml")); });
    await flushDebounce();

    expect(getFileBadges).toHaveBeenCalledTimes(2);
  });
});

describe("useFileBadges file-changed kind=deleted + kind=content + path normalization", () => {
  it("refreshes once on a sidecar deletion event (kind=deleted)", async () => {
    vi.mocked(getFileBadges).mockResolvedValue({ "/a.md": A });

    renderHook(() => useFileBadges(["/a.md"]));
    await flushDebounce();
    vi.mocked(getFileBadges).mockClear();

    const fCb = vi.mocked(listenEvent).mock.calls.find((c) => c[0] === "file-changed")![1] as (p: EventPayloads["file-changed"]) => void;

    await act(async () => { fCb(fileChangedDeleted("/a.md.review.yaml")); });
    await flushDebounce();

    expect(getFileBadges).toHaveBeenCalledTimes(1);
  });

  it("does NOT suppress kind=deleted within SAVE_DEBOUNCE_MS of comments-changed", async () => {
    vi.mocked(getFileBadges).mockResolvedValue({ "/a.md": A });

    renderHook(() => useFileBadges(["/a.md"]));
    await flushDebounce();
    vi.mocked(getFileBadges).mockClear();

    const cCb = vi.mocked(listenEvent).mock.calls.find((c) => c[0] === "comments-changed")![1] as (p: EventPayloads["comments-changed"]) => void;
    const fCb = vi.mocked(listenEvent).mock.calls.find((c) => c[0] === "file-changed")![1] as (p: EventPayloads["file-changed"]) => void;

    await act(async () => { cCb(commentsChanged("/a.md")); });
    await flushDebounce();
    expect(getFileBadges).toHaveBeenCalledTimes(1);

    // Within suppression window — but deletions are real events, not echoes.
    await act(async () => { vi.advanceTimersByTime(500); });
    await act(async () => { fCb(fileChangedDeleted("/a.md.review.yaml")); });
    await flushDebounce();

    expect(getFileBadges).toHaveBeenCalledTimes(2);
  });

  it("ignores file-changed kind=content (source content does not affect badges)", async () => {
    vi.mocked(getFileBadges).mockResolvedValue({ "/a.md": A });

    renderHook(() => useFileBadges(["/a.md"]));
    await flushDebounce();
    vi.mocked(getFileBadges).mockClear();

    const fCb = vi.mocked(listenEvent).mock.calls.find((c) => c[0] === "file-changed")![1] as (p: EventPayloads["file-changed"]) => void;

    await act(async () => { fCb(fileChangedContent("/a.md")); });
    await flushDebounce();

    expect(getFileBadges).not.toHaveBeenCalled();
  });

  // #311 fixture validation moved this test to a contract-correct input:
  // the production watcher only emits sidecar paths for kind=review (per
  // src-tauri/src/watcher.rs:489-496). The hook's `sourcePathFromEvent`
  // strips `.review.yaml` to `/a.md`, the suppression key matches, and
  // the IPC re-fetch is suppressed. This test verifies the round-trip
  // (comments-changed → sidecar kind=review within window → no IPC).
  it("suppresses kind=review (sidecar) within SAVE_DEBOUNCE_MS of a comments-changed for the source", async () => {
    vi.mocked(getFileBadges).mockResolvedValue({ "/a.md": A });

    renderHook(() => useFileBadges(["/a.md"]));
    await flushDebounce();
    vi.mocked(getFileBadges).mockClear();

    const cCb = vi.mocked(listenEvent).mock.calls.find((c) => c[0] === "comments-changed")![1] as (p: EventPayloads["comments-changed"]) => void;
    const fCb = vi.mocked(listenEvent).mock.calls.find((c) => c[0] === "file-changed")![1] as (p: EventPayloads["file-changed"]) => void;

    await act(async () => { cCb(commentsChanged("/a.md")); });
    await flushDebounce();
    expect(getFileBadges).toHaveBeenCalledTimes(1);

    await act(async () => { vi.advanceTimersByTime(500); });
    await act(async () => { fCb(fileChangedReview("/a.md.review.yaml")); });
    await flushDebounce();

    expect(getFileBadges).toHaveBeenCalledTimes(1);
  });
});

describe("useFileBadges  review-event regression (issue #311)", () => {
  it("triggers a source-path badge re-fetch when a kind=review event arrives with a sidecar path", async () => {
    const sourcePath = "/a.md";
    const sidecarPath = "/a.md.review.yaml";
    const A: FileBadge = { count: 3, max_severity: "high", file_level_count: 0 };
    const B: FileBadge = { count: 5, max_severity: "high", file_level_count: 0 };

    vi.mocked(getFileBadges)
      .mockResolvedValueOnce({ [sourcePath]: A })
      .mockResolvedValueOnce({ [sourcePath]: B });

    renderHook(() => useFileBadges([sourcePath]));
    await flushDebounce();

    expect(getFileBadges).toHaveBeenNthCalledWith(1, [sourcePath]);

    const call = vi.mocked(listenEvent).mock.calls.find((c) => c[0] === "file-changed");
    expect(call).toBeDefined();
    const cb = call![1] as (payload: EventPayloads["file-changed"]) => void;

    await act(async () => { cb(fileChangedReview(sidecarPath)); });
    await flushDebounce();

    expect(getFileBadges).toHaveBeenCalledTimes(2);
    expect(getFileBadges).toHaveBeenNthCalledWith(2, [sourcePath]);
    expect(getFileBadges).not.toHaveBeenCalledWith([sidecarPath]);
    expect(getFileBadges).not.toHaveBeenCalledWith(
      expect.arrayContaining([sidecarPath]),
    );
  });

  it("ignores kind=review when the consumer's filePaths is empty (no sidecar path leaks into IPC)", async () => {
    renderHook(() => useFileBadges([]));
    await flushDebounce();

    const call = vi.mocked(listenEvent).mock.calls.find((c) => c[0] === "file-changed");
    const cb = call![1] as (payload: EventPayloads["file-changed"]) => void;

    await act(async () => { cb(fileChangedReview(ipcEventFixturePaths.reviewYaml)); });
    await flushDebounce();

    expect(getFileBadges).not.toHaveBeenCalled();
  });
});
