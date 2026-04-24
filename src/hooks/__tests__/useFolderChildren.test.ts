import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFolderChildren } from "@/hooks/useFolderChildren";
import * as commands from "@/lib/tauri-commands";

vi.mock("@/lib/tauri-commands");
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

describe("useFolderChildren", () => {
  it("loads children on root change", async () => {
    const entries = [
      { name: "file.md", path: "/root/file.md", is_dir: false },
      { name: "sub", path: "/root/sub", is_dir: true },
    ];
    vi.mocked(commands.readDir).mockResolvedValue(entries);

    const { result } = renderHook(() => useFolderChildren("/root"));

    await act(async () => {});

    expect(commands.readDir).toHaveBeenCalledWith("/root");
    expect(result.current.childrenCache["/root"]).toEqual(entries);
  });

  it("caches results — second call returns cached without IPC", async () => {
    const entries = [{ name: "a.md", path: "/root/a.md", is_dir: false }];
    vi.mocked(commands.readDir).mockResolvedValue(entries);

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
      .mockResolvedValueOnce(entriesA)
      .mockResolvedValueOnce(entriesB);

    const { result, rerender } = renderHook(
      ({ root }) => useFolderChildren(root),
      { initialProps: { root: "/rootA" as string | null } }
    );

    await act(async () => {});
    expect(result.current.childrenCache["/rootA"]).toEqual(entriesA);

    // Change root
    rerender({ root: "/rootB" });

    await act(async () => {});
    expect(result.current.childrenCache["/rootA"]).toBeUndefined();
    expect(result.current.childrenCache["/rootB"]).toEqual(entriesB);
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
    vi.mocked(commands.readDir).mockResolvedValue([]);

    renderHook(() => useFolderChildren(null));

    await act(async () => {});
    expect(commands.readDir).not.toHaveBeenCalled();
  });
});
