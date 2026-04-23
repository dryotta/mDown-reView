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
  vi.mocked(commands.computeDocumentPath).mockResolvedValue("file.md");
  vi.mocked(enricher.enrichCommentsWithCommit).mockImplementation(async (c) => c);
  useStore.setState({ root: null, lastSaveByPath: {} });
});

afterEach(() => {
  vi.useRealTimers();
});

const comment1 = {
  id: "c1",
  author: "A",
  timestamp: "2026-01-01T00:00:00Z",
  text: "test",
  resolved: false,
};

describe("useAutoSaveComments", () => {
  it("does not save on initial load (not dirty)", async () => {
    renderHook(() => useAutoSaveComments("/path/file.md", [comment1], 1));

    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(commands.saveReviewComments).not.toHaveBeenCalled();
  });

  it("saves after comments change post-load", async () => {
    const { rerender } = renderHook(
      ({ comments, loadKey }) => useAutoSaveComments("/path/file.md", comments, loadKey),
      { initialProps: { comments: [comment1], loadKey: 1 } }
    );

    const comment2 = { ...comment1, id: "c2", text: "new" };
    rerender({ comments: [comment1, comment2], loadKey: 1 });

    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(commands.saveReviewComments).toHaveBeenCalledTimes(1);
  });

  it("uses relative path when workspace root is set", async () => {
    useStore.setState({ root: "/path" });
    vi.mocked(commands.computeDocumentPath).mockResolvedValue("sub/file.md");
    const { rerender } = renderHook(
      ({ comments, loadKey }) => useAutoSaveComments("/path/sub/file.md", comments, loadKey),
      { initialProps: { comments: [comment1], loadKey: 1 } }
    );

    const comment2 = { ...comment1, id: "c2" };
    rerender({ comments: [comment1, comment2], loadKey: 1 });

    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(commands.saveReviewComments).toHaveBeenCalledWith(
      "/path/sub/file.md",
      "sub/file.md",
      expect.any(Array)
    );
  });

  it("flushes save on unmount instead of canceling", async () => {
    const { rerender, unmount } = renderHook(
      ({ comments, loadKey }) => useAutoSaveComments("/path/file.md", comments, loadKey),
      { initialProps: { comments: [comment1], loadKey: 1 } }
    );

    const comment2 = { ...comment1, id: "c2" };
    rerender({ comments: [comment1, comment2], loadKey: 1 });

    // Unmount before debounce fires
    unmount();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(commands.saveReviewComments).toHaveBeenCalledTimes(1);
  });

  it("does not save when loadKey is 0 (not loaded)", async () => {
    renderHook(() => useAutoSaveComments("/path/file.md", [comment1], 0));

    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(commands.saveReviewComments).not.toHaveBeenCalled();
  });

  it("does not create empty sidecar when opening file with no sidecar", async () => {
    renderHook(() => useAutoSaveComments("/path/file.md", undefined, 1));

    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(commands.saveReviewComments).not.toHaveBeenCalled();
  });

  it("does not save back externally-reloaded comments (loadKey bump resets dirty)", async () => {
    const { rerender } = renderHook(
      ({ comments, loadKey }) => useAutoSaveComments("/path/file.md", comments, loadKey),
      { initialProps: { comments: [comment1], loadKey: 1 } }
    );

    // Simulate sidecar reload: new comments array + loadKey bump
    const externalComments = [{ ...comment1, text: "externally edited" }];
    rerender({ comments: externalComments, loadKey: 2 });

    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(commands.saveReviewComments).not.toHaveBeenCalled();
  });

  it("records save timestamp per-path after successful save", async () => {
    const { rerender } = renderHook(
      ({ comments, loadKey }) => useAutoSaveComments("/path/file.md", comments, loadKey),
      { initialProps: { comments: [comment1], loadKey: 1 } }
    );

    const comment2 = { ...comment1, id: "c2" };
    rerender({ comments: [comment1, comment2], loadKey: 1 });

    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(useStore.getState().lastSaveByPath["/path/file.md"]).toBeGreaterThan(0);
  });

  it("records sidecar path in save timestamp to suppress watcher reload", async () => {
    const { rerender } = renderHook(
      ({ comments, loadKey }) => useAutoSaveComments("/path/file.md", comments, loadKey),
      { initialProps: { comments: [comment1], loadKey: 1 } }
    );

    const comment2 = { ...comment1, id: "c2" };
    rerender({ comments: [comment1, comment2], loadKey: 1 });

    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(useStore.getState().lastSaveByPath["/path/file.md.review.yaml"]).toBeGreaterThan(0);
  });

  it("does not record save timestamp on save failure", async () => {
    vi.mocked(commands.saveReviewComments).mockRejectedValueOnce(new Error("disk full"));
    const { rerender } = renderHook(
      ({ comments, loadKey }) => useAutoSaveComments("/path/file.md", comments, loadKey),
      { initialProps: { comments: [comment1], loadKey: 1 } }
    );

    const comment2 = { ...comment1, id: "c2" };
    rerender({ comments: [comment1, comment2], loadKey: 1 });

    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(useStore.getState().lastSaveByPath["/path/file.md"]).toBeUndefined();
  });
});
