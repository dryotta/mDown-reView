import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTreeWatcher } from "@/hooks/useTreeWatcher";
import * as commands from "@/lib/tauri-commands";

vi.mock("@/lib/tauri-commands");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.mocked(commands.updateTreeWatchedDirs).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useTreeWatcher", () => {
  it("calls updateTreeWatchedDirs with [root, ...expandedDirs] after debounce", () => {
    const expanded = { "/root/a": true, "/root/b": true };
    renderHook(() => useTreeWatcher("/root", expanded));

    // Not called immediately — debounced
    expect(commands.updateTreeWatchedDirs).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(100); });

    expect(commands.updateTreeWatchedDirs).toHaveBeenCalledTimes(1);
    expect(commands.updateTreeWatchedDirs).toHaveBeenCalledWith("/root", [
      "/root",
      "/root/a",
      "/root/b",
    ]);
  });

  it("excludes a folder once it's collapsed", () => {
    const { rerender } = renderHook(
      ({ expanded }: { expanded: Record<string, boolean> }) =>
        useTreeWatcher("/root", expanded),
      { initialProps: { expanded: { "/root/a": true, "/root/b": true } } }
    );

    act(() => { vi.advanceTimersByTime(100); });
    expect(commands.updateTreeWatchedDirs).toHaveBeenLastCalledWith("/root", [
      "/root",
      "/root/a",
      "/root/b",
    ]);

    // Collapse /root/b
    rerender({ expanded: { "/root/a": true, "/root/b": false } });
    act(() => { vi.advanceTimersByTime(100); });

    expect(commands.updateTreeWatchedDirs).toHaveBeenLastCalledWith("/root", [
      "/root",
      "/root/a",
    ]);
    expect(commands.updateTreeWatchedDirs).toHaveBeenCalledTimes(2);
  });

  it("does not re-invoke IPC when the same set re-renders", () => {
    const expanded = { "/root/a": true };
    const { rerender } = renderHook(
      ({ exp }: { exp: Record<string, boolean> }) => useTreeWatcher("/root", exp),
      { initialProps: { exp: expanded } }
    );

    act(() => { vi.advanceTimersByTime(100); });
    expect(commands.updateTreeWatchedDirs).toHaveBeenCalledTimes(1);

    // New object, same content
    rerender({ exp: { "/root/a": true } });
    act(() => { vi.advanceTimersByTime(200); });

    expect(commands.updateTreeWatchedDirs).toHaveBeenCalledTimes(1);
  });

  it("cancels pending timer on unmount", () => {
    const { unmount } = renderHook(() =>
      useTreeWatcher("/root", { "/root/a": true })
    );

    unmount();
    act(() => { vi.advanceTimersByTime(500); });

    expect(commands.updateTreeWatchedDirs).not.toHaveBeenCalled();
  });

  it("does nothing when root is null", () => {
    renderHook(() => useTreeWatcher(null, { "/root/a": true }));
    act(() => { vi.advanceTimersByTime(500); });
    expect(commands.updateTreeWatchedDirs).not.toHaveBeenCalled();
  });

  it("ignores collapsed folders (value === false)", () => {
    renderHook(() =>
      useTreeWatcher("/root", { "/root/a": true, "/root/b": false })
    );
    act(() => { vi.advanceTimersByTime(100); });

    expect(commands.updateTreeWatchedDirs).toHaveBeenCalledWith("/root", [
      "/root",
      "/root/a",
    ]);
  });
});
