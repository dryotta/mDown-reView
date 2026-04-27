import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { listenEvent } from "@/lib/tauri-events";
import { useComments } from "../use-comments";
import {
  getFileComments,
  type CommentThread,
  type GetFileCommentsResult,
} from "@/lib/tauri-commands";
import { error as logError } from "@/logger";

vi.mock("@/lib/tauri-events", () => ({
  listenEvent: vi.fn((_eventName: string, _callback: unknown) =>
    Promise.resolve(() => {})
  ),
}));

const wrap = (threads: CommentThread[]): GetFileCommentsResult => ({
  threads,
  sidecar_mtime_ms: null,
});

vi.mock("@/lib/tauri-commands", () => ({
  getFileComments: vi.fn().mockResolvedValue({ threads: [], sidecar_mtime_ms: null }),
}));

vi.mock("@/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}));

function flushPromises() {
  return act(async () => {});
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useComments listener cleanup", () => {
  it("cleans up comments-changed listener even on rapid unmount", async () => {
    const mockUnlisten = vi.fn();
    let resolveCommentsChanged!: (fn: () => void) => void;

    // First listen call = comments-changed, second = file-changed
    vi.mocked(listenEvent)
      .mockReturnValueOnce(
        new Promise((r) => {
          resolveCommentsChanged = r;
        })
      )
      .mockReturnValueOnce(new Promise(() => {}));

    const { unmount } = renderHook(() => useComments("/test.md"));

    // Unmount immediately before listen promises resolve
    unmount();

    // Now resolve the listen promise — cleanup should still call unlisten
    resolveCommentsChanged(mockUnlisten);
    await flushPromises();

    expect(mockUnlisten).toHaveBeenCalled();
  });

  it("cleans up file-changed listener even on rapid unmount", async () => {
    const mockUnlisten = vi.fn();
    let resolveFileChanged!: (fn: () => void) => void;

    vi.mocked(listenEvent)
      .mockReturnValueOnce(new Promise(() => {}))
      .mockReturnValueOnce(
        new Promise((r) => {
          resolveFileChanged = r;
        })
      );

    const { unmount } = renderHook(() => useComments("/test.md"));

    unmount();

    // Resolve the file-changed listener
    resolveFileChanged(mockUnlisten);
    await flushPromises();

    expect(mockUnlisten).toHaveBeenCalled();
  });

  it("cleans up listener normally when promise resolves before unmount", async () => {
    const mockUnlisten = vi.fn();

    vi.mocked(listenEvent).mockResolvedValue(mockUnlisten);

    const { unmount } = renderHook(() => useComments("/test.md"));

    // Let the listen promises resolve
    await flushPromises();

    unmount();

    // Cleanup is via .then(), so we need to flush the microtask
    await flushPromises();

    expect(mockUnlisten).toHaveBeenCalled();
  });

  it("does not set up listeners when filePath is null", async () => {
    renderHook(() => useComments(null));

    await flushPromises();

    // listen should not be called for null filePath (only initial load effect runs)
    expect(listenEvent).not.toHaveBeenCalled();
  });
});

// ── Test data helpers ────────────────────────────────────────────────────────

const makeMockThreads = (): CommentThread[] => [
  {
    root: {
      id: "c1",
      author: "A",
      text: "hello",
      timestamp: "2026-01-01T00:00:00Z",
      resolved: false,
      line: 1,
      matchedLineNumber: 1,
      isOrphaned: false,
      anchor: { kind: "line", line: 1 },
    },
    replies: [
      {
        id: "c2",
        author: "B",
        text: "reply",
        timestamp: "2026-01-01T00:01:00Z",
        resolved: false,
        reply_to: "c1",
        matchedLineNumber: 1,
        isOrphaned: false,
        anchor: { kind: "line", line: 1 },
      },
    ],
  },
];

// ── Loading tests ────────────────────────────────────────────────────────────

describe("useComments loading", () => {
  it("returns empty threads/comments and loading=false when filePath is null", async () => {
    const { result } = renderHook(() => useComments(null));
    await flushPromises();

    expect(result.current.threads).toEqual([]);
    expect(result.current.comments).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(getFileComments).not.toHaveBeenCalled();
  });

  it("sets loading=true during fetch, then false after", async () => {
    let resolveGetComments!: (val: GetFileCommentsResult) => void;
    vi.mocked(getFileComments).mockImplementationOnce(
      () => new Promise((resolve) => { resolveGetComments = resolve; }),
    );

    const { result } = renderHook(() => useComments("/test.md"));

    // The async IIFE runs synchronously up to the first await (setLoading(true)),
    // but we need to flush React's state update queue to observe it.
    await flushPromises();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveGetComments(wrap([]));
    });

    expect(result.current.loading).toBe(false);
  });

  it("returns threads from getFileComments result", async () => {
    const mockThreads = makeMockThreads();
    vi.mocked(getFileComments).mockResolvedValueOnce(wrap(mockThreads));

    const { result } = renderHook(() => useComments("/test.md"));
    await flushPromises();

    expect(result.current.threads).toEqual(mockThreads);
  });

  it("flattens comments from thread root + replies", async () => {
    const mockThreads = makeMockThreads();
    vi.mocked(getFileComments).mockResolvedValueOnce(wrap(mockThreads));

    const { result } = renderHook(() => useComments("/test.md"));
    await flushPromises();

    // comments should be [root, ...replies] for each thread
    expect(result.current.comments).toHaveLength(2);
    expect(result.current.comments[0].id).toBe("c1");
    expect(result.current.comments[1].id).toBe("c2");
  });

  it("rapid filePath change cancels stale response", async () => {
    let resolveA!: (val: GetFileCommentsResult) => void;
    let resolveB!: (val: GetFileCommentsResult) => void;

    vi.mocked(getFileComments)
      .mockImplementationOnce(
        () => new Promise((r) => { resolveA = r; }),
      )
      .mockImplementationOnce(
        () => new Promise((r) => { resolveB = r; }),
      );

    const threadsA = makeMockThreads();
    const threadsB: CommentThread[] = [
      {
        root: {
          id: "B-root",
          author: "B-author",
          text: "B-text",
          timestamp: "2026-02-02T00:00:00Z",
          resolved: false,
          line: 5,
          matchedLineNumber: 5,
          isOrphaned: false,
          anchor: { kind: "line", line: 5 },
        },
        replies: [],
      },
    ];

    const { result, rerender } = renderHook(
      ({ path }: { path: string }) => useComments(path),
      { initialProps: { path: "/a.md" } },
    );
    await flushPromises();

    // Switch to /b.md before /a.md's response arrives
    rerender({ path: "/b.md" });
    await flushPromises();

    // /b.md resolves first, then the stale /a.md response arrives
    await act(async () => { resolveB(wrap(threadsB)); });
    await act(async () => { resolveA(wrap(threadsA)); });

    // Final state must reflect the latest filePath only
    expect(result.current.threads).toEqual(threadsB);
    expect(result.current.threads[0].root.id).toBe("B-root");
  });

  it("reloads when filePath changes (verifies getFileComments called with new path)", async () => {
    vi.mocked(getFileComments).mockResolvedValue(wrap([]));

    const { rerender } = renderHook(
      ({ path }: { path: string | null }) => useComments(path),
      { initialProps: { path: "/a.md" } },
    );
    await flushPromises();

    expect(getFileComments).toHaveBeenCalledWith("/a.md");

    rerender({ path: "/b.md" });
    await flushPromises();

    expect(getFileComments).toHaveBeenCalledWith("/b.md");
  });

  it("handles getFileComments error gracefully (sets empty threads, logs error)", async () => {
    vi.mocked(getFileComments).mockRejectedValueOnce(new Error("load fail"));

    const { result } = renderHook(() => useComments("/test.md"));
    await flushPromises();

    expect(result.current.threads).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(logError).toHaveBeenCalled();
  });
});

// ── Reload tests ─────────────────────────────────────────────────────────────

describe("useComments reload", () => {
  it("reload() re-fetches comments for current file", async () => {
    vi.mocked(getFileComments).mockResolvedValue(wrap([]));

    const { result } = renderHook(() => useComments("/test.md"));
    await flushPromises();
    expect(getFileComments).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.reload();
    });

    expect(getFileComments).toHaveBeenCalledTimes(2);
    expect(getFileComments).toHaveBeenLastCalledWith("/test.md");
  });

  it("reload() does nothing when filePath is null", async () => {
    const { result } = renderHook(() => useComments(null));
    await flushPromises();
    expect(getFileComments).not.toHaveBeenCalled();

    await act(async () => {
      result.current.reload();
    });

    expect(getFileComments).not.toHaveBeenCalled();
  });
});

// ── Event subscription tests ─────────────────────────────────────────────────

describe("useComments event subscriptions", () => {
  let commentsChangedCb: ((payload: { file_path: string }) => void) | null;
  let fileChangedCb: ((payload: { path: string; kind: string }) => void) | null;

  beforeEach(() => {
    commentsChangedCb = null;
    fileChangedCb = null;

    vi.mocked(listenEvent).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (eventName: string, callback: any) => {
        if (eventName === "comments-changed") commentsChangedCb = callback;
        if (eventName === "file-changed") fileChangedCb = callback;
        return Promise.resolve(() => {});
      },
    );

    vi.mocked(getFileComments).mockResolvedValue(wrap([]));
  });

  it("reloads when comments-changed event fires for matching file_path", async () => {
    renderHook(() => useComments("/test.md"));
    await flushPromises();
    expect(getFileComments).toHaveBeenCalledTimes(1);

    await act(async () => {
      commentsChangedCb!({ file_path: "/test.md" });
    });

    expect(getFileComments).toHaveBeenCalledTimes(2);
  });

  it("ignores comments-changed event for different file_path", async () => {
    renderHook(() => useComments("/test.md"));
    await flushPromises();
    expect(getFileComments).toHaveBeenCalledTimes(1);

    await act(async () => {
      commentsChangedCb!({ file_path: "/other.md" });
    });

    expect(getFileComments).toHaveBeenCalledTimes(1);
  });

  it("reloads when file-changed event fires with kind=review and matching sidecar path (.yaml)", async () => {
    renderHook(() => useComments("/test.md"));
    await flushPromises();
    expect(getFileComments).toHaveBeenCalledTimes(1);

    await act(async () => {
      fileChangedCb!({ path: "/test.md.review.yaml", kind: "review" });
    });

    expect(getFileComments).toHaveBeenCalledTimes(2);
  });

  it("reloads when file-changed event fires with kind=review and matching sidecar path (.json)", async () => {
    renderHook(() => useComments("/test.md"));
    await flushPromises();
    expect(getFileComments).toHaveBeenCalledTimes(1);

    await act(async () => {
      fileChangedCb!({ path: "/test.md.review.json", kind: "review" });
    });

    expect(getFileComments).toHaveBeenCalledTimes(2);
  });

  it("ignores file-changed event with kind=content", async () => {
    renderHook(() => useComments("/test.md"));
    await flushPromises();
    expect(getFileComments).toHaveBeenCalledTimes(1);

    await act(async () => {
      fileChangedCb!({ path: "/test.md.review.yaml", kind: "content" });
    });

    expect(getFileComments).toHaveBeenCalledTimes(1);
  });

  it("ignores file-changed event with kind=review for non-matching sidecar", async () => {
    renderHook(() => useComments("/test.md"));
    await flushPromises();
    expect(getFileComments).toHaveBeenCalledTimes(1);

    await act(async () => {
      fileChangedCb!({ path: "/other.md.review.yaml", kind: "review" });
    });

    expect(getFileComments).toHaveBeenCalledTimes(1);
  });
});

// ── Stale response handling ──────────────────────────────────────────────────

describe("useComments stale response handling", () => {
  it("discards result when filePath changes before load completes (the cancelled flag)", async () => {
    const staleThreads: CommentThread[] = [
      {
        root: {
          id: "stale",
          author: "X",
          text: "stale",
          timestamp: "2026-01-01T00:00:00Z",
          resolved: false,
          matchedLineNumber: 1,
          isOrphaned: false,
          anchor: { kind: "line", line: 1 },
        },
        replies: [],
      },
    ];
    const freshThreads: CommentThread[] = [
      {
        root: {
          id: "fresh",
          author: "Y",
          text: "fresh",
          timestamp: "2026-01-01T00:00:00Z",
          resolved: false,
          matchedLineNumber: 2,
          isOrphaned: false,
          anchor: { kind: "line", line: 2 },
        },
        replies: [],
      },
    ];

    let resolveFirst!: (val: GetFileCommentsResult) => void;
    vi.mocked(getFileComments)
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveFirst = resolve; }),
      )
      .mockResolvedValueOnce(wrap(freshThreads));

    const { result, rerender } = renderHook(
      ({ path }: { path: string | null }) => useComments(path),
      { initialProps: { path: "/first.md" } },
    );

    // Change filePath before first load completes — sets cancelled=true for first effect
    rerender({ path: "/second.md" });
    await flushPromises();

    // Second file's threads should already be loaded
    expect(result.current.threads).toEqual(freshThreads);

    // Now resolve the stale first promise
    await act(async () => {
      resolveFirst(wrap(staleThreads));
    });

    // Should still have fresh threads — stale result was discarded
    expect(result.current.threads).toEqual(freshThreads);
  });
});
