import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useWorkspaceComments } from "../useWorkspaceComments";
import { listenEvent } from "@/lib/tauri-events";
import { getFileComments, type CommentThread } from "@/lib/tauri-commands";
import { useStore } from "@/store/index";

vi.mock("@/lib/tauri-events", () => ({
  listenEvent: vi.fn(),
}));

vi.mock("@/lib/tauri-commands", () => ({
  getFileComments: vi.fn(),
}));

vi.mock("@/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}));

const mockListen = vi.mocked(listenEvent);
const mockGet = vi.mocked(getFileComments);

type StoreShape = {
  tabs: { path: string; lastActivatedAt?: number; scrollTop: number }[];
  ghostEntries: { sidecarPath: string; sourcePath: string }[];
};

function setStoreState(s: StoreShape) {
  // Direct partial override; cast through unknown for the test fixture.
  useStore.setState(s as unknown as Partial<ReturnType<typeof useStore.getState>>);
}

const fakeThread = (id: string): CommentThread => ({
  root: {
    id,
    author: "T",
    timestamp: new Date().toISOString(),
    text: "hi",
    resolved: false,
    line: 1,
    matchedLineNumber: 1,
    isOrphaned: false,
    anchor: { kind: "line", line: 1 },
  },
  replies: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  mockListen.mockImplementation(() => Promise.resolve(() => {}));
  mockGet.mockImplementation(async (p: string) => ({
    threads: [fakeThread(`t-${p}`)],
    sidecar_mtime_ms: null,
  }));
  setStoreState({ tabs: [], ghostEntries: [] });
});

describe("useWorkspaceComments", () => {
  it("returns {} immediately when enabled=false and never calls getFileComments", async () => {
    setStoreState({
      tabs: [{ path: "/a.md", scrollTop: 0 }],
      ghostEntries: [],
    });
    const { result } = renderHook(() => useWorkspaceComments(false));
    expect(result.current).toEqual({});
    // Flush any microtasks
    await act(async () => {});
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("fans out one getFileComments per unique path and keys results by path", async () => {
    setStoreState({
      tabs: [{ path: "/a.md", scrollTop: 0 }, { path: "/b.md", scrollTop: 0 }],
      ghostEntries: [{ sidecarPath: "/c.md.review.yaml", sourcePath: "/c.md" }],
    });
    const { result } = renderHook(() => useWorkspaceComments(true));

    await waitFor(() => {
      expect(Object.keys(result.current).sort()).toEqual(["/a.md", "/b.md", "/c.md"]);
    });
    expect(mockGet).toHaveBeenCalledTimes(3);
    const calls = mockGet.mock.calls.map((c) => c[0]).sort();
    expect(calls).toEqual(["/a.md", "/b.md", "/c.md"]);
  });

  it("dedupes paths that appear in both tabs and ghostEntries", async () => {
    setStoreState({
      tabs: [{ path: "/a.md", scrollTop: 0 }],
      ghostEntries: [{ sidecarPath: "/a.md.review.yaml", sourcePath: "/a.md" }],
    });
    renderHook(() => useWorkspaceComments(true));
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledTimes(1);
    });
    expect(mockGet).toHaveBeenCalledWith("/a.md");
  });

  it("comments-changed event triggers a reload", async () => {
    setStoreState({
      tabs: [{ path: "/a.md", scrollTop: 0 }],
      ghostEntries: [],
    });
    const handlers: Record<string, (p: unknown) => void> = {};
    mockListen.mockImplementation((name, cb) => {
      handlers[name] = cb as (p: unknown) => void;
      return Promise.resolve(() => {});
    });

    renderHook(() => useWorkspaceComments(true));
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));

    await act(async () => {
      handlers["comments-changed"]?.({ file_path: "/a.md" });
    });
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  });

  it("file-changed kind=review triggers reload; kind=content does NOT", async () => {
    setStoreState({
      tabs: [{ path: "/a.md", scrollTop: 0 }],
      ghostEntries: [],
    });
    const handlers: Record<string, (p: unknown) => void> = {};
    mockListen.mockImplementation((name, cb) => {
      handlers[name] = cb as (p: unknown) => void;
      return Promise.resolve(() => {});
    });

    renderHook(() => useWorkspaceComments(true));
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));

    await act(async () => {
      handlers["file-changed"]?.({ path: "/a.md", kind: "content" });
    });
    // No new call — kind=content is ignored.
    await new Promise((r) => setTimeout(r, 10));
    expect(mockGet).toHaveBeenCalledTimes(1);

    await act(async () => {
      handlers["file-changed"]?.({ path: "/a.md.review.yaml", kind: "review" });
    });
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  });

  it("unmount calls each unlisten function", async () => {
    setStoreState({
      tabs: [{ path: "/a.md", scrollTop: 0 }],
      ghostEntries: [],
    });
    const unlistenA = vi.fn();
    const unlistenB = vi.fn();
    mockListen
      .mockImplementationOnce(() => Promise.resolve(unlistenA))
      .mockImplementationOnce(() => Promise.resolve(unlistenB));

    const { unmount } = renderHook(() => useWorkspaceComments(true));
    await waitFor(() => expect(mockListen).toHaveBeenCalledTimes(2));

    unmount();
    // Unlisten resolution is async (then-chained) — flush microtasks.
    await act(async () => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(unlistenA).toHaveBeenCalled();
    expect(unlistenB).toHaveBeenCalled();
  });
});
