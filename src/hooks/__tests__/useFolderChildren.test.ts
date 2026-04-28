import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFolderChildren } from "@/hooks/useFolderChildren";
import * as commands from "@/lib/tauri-commands";
import type { ReadDirResult } from "@/lib/tauri-commands";
import { listenEvent } from "@/lib/tauri-events";

vi.mock("@/lib/tauri-commands");
vi.mock("@/lib/tauri-events", () => ({
  listenEvent: vi.fn(() => Promise.resolve(() => {})),
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
});

/** Wrap DirEntry[] in the ReadDirResult shape returned by the Rust command. */
function wrapEntries(entries: commands.DirEntry[]): ReadDirResult {
  return { entries, total: entries.length, has_more: false };
}

function getFolderChangedCallback() {
  const call = vi
    .mocked(listenEvent)
    .mock.calls.find((c) => c[0] === "folder-changed");
  if (!call) throw new Error("listenEvent('folder-changed', ...) was never called");
  return call[1] as (payload: { path: string }) => void;
}

describe("useFolderChildren", () => {
  it("loads children on root change", async () => {
    const entries = [
      { name: "file.md", path: "/root/file.md", is_dir: false },
      { name: "sub", path: "/root/sub", is_dir: true },
    ];
    vi.mocked(commands.readDir).mockResolvedValue(wrapEntries(entries));

    const { result } = renderHook(() => useFolderChildren("/root"));

    await act(async () => {});

    expect(commands.readDir).toHaveBeenCalledWith("/root", undefined, undefined);
    expect(result.current.childrenCache["/root"]?.entries).toEqual(entries);
  });

  it("caches results — second call returns cached without IPC", async () => {
    const entries = [{ name: "a.md", path: "/root/a.md", is_dir: false }];
    vi.mocked(commands.readDir).mockResolvedValue(wrapEntries(entries));

    const { result } = renderHook(() => useFolderChildren("/root"));

    await act(async () => {});
    expect(commands.readDir).toHaveBeenCalledTimes(1);

    // Call loadChildren again for same path — should use cache
    let secondResult: typeof entries = [];
    await act(async () => {
      secondResult = await result.current.loadChildren("/root");
    });

    expect(secondResult).toEqual(entries);
    expect(commands.readDir).toHaveBeenCalledTimes(1);
  });

  it("resets cache when root changes", async () => {
    const entriesA = [{ name: "a.md", path: "/rootA/a.md", is_dir: false }];
    const entriesB = [{ name: "b.md", path: "/rootB/b.md", is_dir: false }];
    vi.mocked(commands.readDir)
      .mockResolvedValueOnce(wrapEntries(entriesA))
      .mockResolvedValueOnce(wrapEntries(entriesB));

    const { result, rerender } = renderHook(
      ({ root }) => useFolderChildren(root),
      { initialProps: { root: "/rootA" as string | null } }
    );

    await act(async () => {});
    expect(result.current.childrenCache["/rootA"]?.entries).toEqual(entriesA);

    // Change root
    rerender({ root: "/rootB" });

    await act(async () => {});
    expect(result.current.childrenCache["/rootA"]).toBeUndefined();
    expect(result.current.childrenCache["/rootB"]?.entries).toEqual(entriesB);
  });

  it("returns empty array on error", async () => {
    vi.mocked(commands.readDir).mockRejectedValue(new Error("no access"));

    const { result } = renderHook(() => useFolderChildren("/root"));

    await act(async () => {});

    // Root should have tried to load but got error
    expect(result.current.childrenCache["/root"]).toBeUndefined();

    // Explicit loadChildren call should return empty array
    let entries: commands.DirEntry[] = [];
    await act(async () => {
      entries = await result.current.loadChildren("/other");
    });
    expect(entries).toEqual([]);
  });

  it("does not load when root is null", async () => {
    vi.mocked(commands.readDir).mockResolvedValue(wrapEntries([]));

    renderHook(() => useFolderChildren(null));

    await act(async () => {});
    expect(commands.readDir).not.toHaveBeenCalled();
  });

  it("stores hasMore and total from ReadDirResult", async () => {
    const entries = [{ name: "a.md", path: "/root/a.md", is_dir: false }];
    vi.mocked(commands.readDir).mockResolvedValue({
      entries,
      total: 500,
      has_more: true,
    });

    const { result } = renderHook(() => useFolderChildren("/root"));
    await act(async () => {});

    expect(result.current.childrenCache["/root"]?.hasMore).toBe(true);
    expect(result.current.childrenCache["/root"]?.total).toBe(500);
  });

  it("bypasses cache when explicit limit is passed", async () => {
    const initial = [{ name: "a.md", path: "/root/a.md", is_dir: false }];
    const full = [
      { name: "a.md", path: "/root/a.md", is_dir: false },
      { name: "b.md", path: "/root/b.md", is_dir: false },
    ];
    vi.mocked(commands.readDir)
      .mockResolvedValueOnce({ entries: initial, total: 500, has_more: true })
      .mockResolvedValueOnce({ entries: full, total: 2, has_more: false });

    const { result } = renderHook(() => useFolderChildren("/root"));
    await act(async () => {});
    expect(result.current.childrenCache["/root"]?.hasMore).toBe(true);

    // Re-fetch with explicit limit — should bypass cache
    await act(async () => {
      await result.current.loadChildren("/root", 10000);
    });
    expect(commands.readDir).toHaveBeenCalledTimes(2);
    expect(commands.readDir).toHaveBeenLastCalledWith("/root", 10000, undefined);
    expect(result.current.childrenCache["/root"]?.hasMore).toBe(false);
    expect(result.current.childrenCache["/root"]?.entries).toEqual(full);
  });
});

describe("useFolderChildren folder-changed listener", () => {
  it("refreshes a cached dir when 'folder-changed' fires for it", async () => {
    const initial = [{ name: "a.md", path: "/root/a.md", is_dir: false }];
    const refreshed = [
      { name: "a.md", path: "/root/a.md", is_dir: false },
      { name: "b.md", path: "/root/b.md", is_dir: false },
    ];
    vi.mocked(commands.readDir)
      .mockResolvedValueOnce(wrapEntries(initial))
      .mockResolvedValueOnce(wrapEntries(refreshed));

    const { result } = renderHook(() => useFolderChildren("/root"));
    await act(async () => {});

    expect(result.current.childrenCache["/root"]?.entries).toEqual(initial);

    const cb = getFolderChangedCallback();
    await act(async () => {
      cb({ path: "/root" });
    });

    expect(commands.readDir).toHaveBeenCalledTimes(2);
    expect(commands.readDir).toHaveBeenLastCalledWith("/root", undefined, undefined);
    expect(result.current.childrenCache["/root"]?.entries).toEqual(refreshed);
  });

  it("ignores 'folder-changed' for an uncached dir", async () => {
    const initial = [{ name: "a.md", path: "/root/a.md", is_dir: false }];
    vi.mocked(commands.readDir).mockResolvedValue(wrapEntries(initial));

    renderHook(() => useFolderChildren("/root"));
    await act(async () => {});

    expect(commands.readDir).toHaveBeenCalledTimes(1);

    const cb = getFolderChangedCallback();
    await act(async () => {
      cb({ path: "/root/uncached-sub" });
    });

    // Still only the initial root load — uncached dir was skipped
    expect(commands.readDir).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes on unmount", async () => {
    const unlisten = vi.fn();
    vi.mocked(listenEvent).mockResolvedValue(unlisten);
    vi.mocked(commands.readDir).mockResolvedValue(wrapEntries([]));

    const { unmount } = renderHook(() => useFolderChildren("/root"));
    await act(async () => {});

    unmount();
    await act(async () => {});

    expect(unlisten).toHaveBeenCalled();
  });

  it("discards stale folder-changed readDir results after root change", async () => {
    // Simulate: rootA is loaded, folder-changed fires for rootA, then root
    // switches to rootB before the readDir resolves. The stale result for
    // rootA must be discarded.
    const entriesA = [{ name: "a.md", path: "/rootA/a.md", is_dir: false }];
    const staleRefresh = [{ name: "stale.md", path: "/rootA/stale.md", is_dir: false }];
    const entriesB = [{ name: "b.md", path: "/rootB/b.md", is_dir: false }];

    let resolveStale!: (v: ReadDirResult) => void;
    const stalePromise = new Promise<ReadDirResult>((r) => { resolveStale = r; });

    vi.mocked(commands.readDir)
      .mockResolvedValueOnce(wrapEntries(entriesA))  // initial rootA load
      .mockReturnValueOnce(stalePromise as never)     // folder-changed readDir (slow)
      .mockResolvedValueOnce(wrapEntries(entriesB));  // rootB load

    // Mount with rootA — loads & caches entriesA
    const { result, rerender } = renderHook(
      ({ root }) => useFolderChildren(root),
      { initialProps: { root: "/rootA" as string | null } },
    );
    await act(async () => {});
    expect(result.current.childrenCache["/rootA"]?.entries).toEqual(entriesA);

    // Fire folder-changed for rootA — starts the slow readDir
    const cb = getFolderChangedCallback();
    await act(async () => { cb({ path: "/rootA" }); });

    // Switch root to rootB — clears cache, sets cancelled flag
    rerender({ root: "/rootB" });
    await act(async () => {});
    expect(result.current.childrenCache["/rootB"]?.entries).toEqual(entriesB);

    // Now the stale readDir resolves — must be discarded
    await act(async () => { resolveStale(wrapEntries(staleRefresh)); });

    // rootA's stale result should NOT appear in the cache
    expect(result.current.childrenCache["/rootA"]).toBeUndefined();
  });
});
