import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { listenEvent } from "@/lib/tauri-events";
import { getFileBadges, type FileBadge } from "@/lib/tauri-commands";
import { useFileBadges } from "../useFileBadges";

vi.mock("@/lib/tauri-events", () => ({
  listenEvent: vi.fn((_eventName: string, _cb: unknown) => Promise.resolve(() => {})),
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
    const cb = call![1] as () => void;
    await act(async () => { cb(); });
    await flushDebounce();

    expect(getFileBadges).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({ "/a.md": { count: 7, max_severity: "medium", file_level_count: 0 } });
  });

  it("dedupes when the result is structurally equal", async () => {
    vi.mocked(getFileBadges)
      .mockResolvedValueOnce({ "/a.md": A })
      .mockResolvedValueOnce({ "/a.md": { count: 3, max_severity: "high", file_level_count: 0 } });

    const { result } = renderHook(() => useFileBadges(["/a.md"]));
    await flushDebounce();
    const firstRef = result.current;

    const call = vi.mocked(listenEvent).mock.calls.find((c) => c[0] === "comments-changed");
    const cb = call![1] as () => void;
    await act(async () => { cb(); });
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

describe("useFileBadges echo elimination — RC5/P1.4", () => {
  it("does NOT register a file-changed listener (eliminates duplicate IPC on local sidecar writes)", async () => {
    renderHook(() => useFileBadges(["/a.md"]));
    await flushDebounce();

    const fileChangedRegs = vi
      .mocked(listenEvent)
      .mock.calls.filter((c) => c[0] === "file-changed");
    expect(fileChangedRegs).toHaveLength(0);
  });

  it("still refreshes exactly once on a single comments-changed event", async () => {
    vi.mocked(getFileBadges).mockResolvedValue({ "/a.md": A });

    renderHook(() => useFileBadges(["/a.md"]));
    await flushDebounce();
    vi.mocked(getFileBadges).mockClear();

    const call = vi.mocked(listenEvent).mock.calls.find((c) => c[0] === "comments-changed");
    expect(call).toBeDefined();
    const cb = call![1] as (payload: { file_path: string }) => void;

    await act(async () => { cb({ file_path: "/a.md" }); });
    await flushDebounce();

    expect(getFileBadges).toHaveBeenCalledTimes(1);
  });
});
