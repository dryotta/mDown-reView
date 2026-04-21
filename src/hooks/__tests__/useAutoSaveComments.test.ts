import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAutoSaveComments } from "@/hooks/useAutoSaveComments";
import * as commands from "@/lib/tauri-commands";
import * as enricher from "@/hooks/useCommitEnricher";
import { useStore } from "@/store";

vi.mock("@/lib/tauri-commands");
vi.mock("@/hooks/useCommitEnricher");
vi.mock("@/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.mocked(commands.saveReviewComments).mockResolvedValue(undefined);
  vi.mocked(enricher.enrichCommentsWithCommit).mockImplementation(async (c) => c);
  useStore.setState({ root: null, lastSaveTimestamp: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

const comment1 = { id: "c1", author: "A", timestamp: "2026-01-01T00:00:00Z", text: "test", resolved: false };

describe("useAutoSaveComments", () => {
  it("does not save on initial load (not dirty)", async () => {
    renderHook(() => useAutoSaveComments("/path/file.md", [comment1], true));

    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(commands.saveReviewComments).not.toHaveBeenCalled();
  });

  it("saves after comments change post-load", async () => {
    const { rerender } = renderHook(
      ({ comments, loaded }) => useAutoSaveComments("/path/file.md", comments, loaded),
      { initialProps: { comments: [comment1], loaded: true } }
    );

    const comment2 = { ...comment1, id: "c2", text: "new" };
    rerender({ comments: [comment1, comment2], loaded: true });

    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(commands.saveReviewComments).toHaveBeenCalledTimes(1);
  });

  it("uses relative path when workspace root is set", async () => {
    useStore.setState({ root: "/path" });
    const { rerender } = renderHook(
      ({ comments, loaded }) => useAutoSaveComments("/path/sub/file.md", comments, loaded),
      { initialProps: { comments: [comment1], loaded: true } }
    );

    const comment2 = { ...comment1, id: "c2" };
    rerender({ comments: [comment1, comment2], loaded: true });

    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(commands.saveReviewComments).toHaveBeenCalledWith(
      "/path/sub/file.md",
      "sub/file.md",
      expect.any(Array),
    );
  });

  it("flushes save on unmount instead of canceling", async () => {
    const { rerender, unmount } = renderHook(
      ({ comments, loaded }) => useAutoSaveComments("/path/file.md", comments, loaded),
      { initialProps: { comments: [comment1], loaded: true } }
    );

    const comment2 = { ...comment1, id: "c2" };
    rerender({ comments: [comment1, comment2], loaded: true });

    // Unmount before debounce fires
    unmount();

    await act(async () => { await vi.runAllTimersAsync(); });

    expect(commands.saveReviewComments).toHaveBeenCalledTimes(1);
  });

  it("does not save when loaded is false", async () => {
    renderHook(() => useAutoSaveComments("/path/file.md", [comment1], false));

    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(commands.saveReviewComments).not.toHaveBeenCalled();
  });

  it("does not create empty sidecar when opening file with no sidecar", async () => {
    renderHook(() => useAutoSaveComments("/path/file.md", undefined, true));

    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(commands.saveReviewComments).not.toHaveBeenCalled();
  });
});
