import { describe, it, expect, vi, beforeEach } from "vitest";
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
});

const A: FileBadge = { count: 3, max_severity: "high" };
const B: FileBadge = { count: 1, max_severity: "low" };

describe("useFileBadges", () => {
  it("returns {} for an empty path list and skips the IPC call", async () => {
    const { result } = renderHook(() => useFileBadges([]));
    await act(async () => {});
    expect(result.current).toEqual({});
    expect(getFileBadges).not.toHaveBeenCalled();
  });

  it("issues a single batched IPC call for the provided paths", async () => {
    vi.mocked(getFileBadges).mockResolvedValueOnce({ "/a.md": A, "/b.md": B });
    const { result, rerender } = renderHook(({ p }: { p: string[] }) => useFileBadges(p), {
      initialProps: { p: ["/a.md", "/b.md"] },
    });
    await act(async () => {});

    // Re-render with the same paths — should NOT re-issue IPC (pathsKey unchanged).
    rerender({ p: ["/a.md", "/b.md"] });
    rerender({ p: ["/a.md", "/b.md"] });
    await act(async () => {});

    expect(getFileBadges).toHaveBeenCalledTimes(1);
    expect(getFileBadges).toHaveBeenCalledWith(["/a.md", "/b.md"]);
    expect(result.current).toEqual({ "/a.md": A, "/b.md": B });
  });

  it("refreshes on comments-changed events", async () => {
    vi.mocked(getFileBadges)
      .mockResolvedValueOnce({ "/a.md": A })
      .mockResolvedValueOnce({ "/a.md": { count: 7, max_severity: "medium" } });

    const { result } = renderHook(() => useFileBadges(["/a.md"]));
    await act(async () => {});
    expect(result.current).toEqual({ "/a.md": A });

    const call = vi.mocked(listenEvent).mock.calls.find((c) => c[0] === "comments-changed");
    expect(call).toBeDefined();
    const cb = call![1] as () => void;
    await act(async () => { cb(); });
    await act(async () => {});

    expect(getFileBadges).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({ "/a.md": { count: 7, max_severity: "medium" } });
  });

  it("refreshes on file-changed{kind:review} but ignores other kinds", async () => {
    vi.mocked(getFileBadges)
      .mockResolvedValueOnce({ "/a.md": A })
      .mockResolvedValueOnce({ "/a.md": B });

    const { result } = renderHook(() => useFileBadges(["/a.md"]));
    await act(async () => {});

    const call = vi.mocked(listenEvent).mock.calls.find((c) => c[0] === "file-changed");
    const cb = call![1] as (payload: { kind: string }) => void;

    await act(async () => { cb({ kind: "content" }); });
    await act(async () => {});
    expect(getFileBadges).toHaveBeenCalledTimes(1); // ignored

    await act(async () => { cb({ kind: "review" }); });
    await act(async () => {});
    expect(getFileBadges).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({ "/a.md": B });
  });

  it("dedupes when the result is structurally equal", async () => {
    vi.mocked(getFileBadges)
      .mockResolvedValueOnce({ "/a.md": A })
      .mockResolvedValueOnce({ "/a.md": { count: 3, max_severity: "high" } });

    const { result } = renderHook(() => useFileBadges(["/a.md"]));
    await act(async () => {});
    const firstRef = result.current;

    const call = vi.mocked(listenEvent).mock.calls.find((c) => c[0] === "comments-changed");
    const cb = call![1] as () => void;
    await act(async () => { cb(); });
    await act(async () => {});

    expect(result.current).toBe(firstRef);
  });

  it("does not call setBadges after unmount (cancelled flag)", async () => {
    let resolveIpc!: (v: Record<string, FileBadge>) => void;
    vi.mocked(getFileBadges).mockReturnValueOnce(
      new Promise<Record<string, FileBadge>>((res) => { resolveIpc = res; })
    );

    const { unmount, result } = renderHook(() => useFileBadges(["/a.md"]));
    unmount();

    await act(async () => { resolveIpc({ "/a.md": A }); });
    await act(async () => {});

    expect(result.current).toEqual({});
  });
});
