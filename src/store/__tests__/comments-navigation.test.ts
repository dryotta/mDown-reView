/**
 * F1 — comments-navigation slice tests.
 *
 * Locks down the keyboard-driven thread navigation contract:
 *   - `nextUnresolvedInActiveFile` walks unresolved threads only and wraps.
 *   - `prevUnresolvedInActiveFile` walks backwards.
 *   - Resolved threads are skipped.
 *   - Orphan threads (no matchedLineNumber) are still navigable.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useStore } from "@/store";
import type { CommentThread } from "@/lib/tauri-commands";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core");

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

function thread(
  id: string,
  line: number,
  resolved = false,
  isOrphaned = false,
): CommentThread {
  return {
    root: {
      id,
      author: "test",
      timestamp: "2026-01-01T00:00:00Z",
      text: id,
      resolved,
      line,
      matchedLineNumber: isOrphaned ? 0 : line,
      isOrphaned,
    },
    replies: [],
  };
}

beforeEach(() => {
  useStore.setState({
    activeTabPath: "/file.md",
    focusedThreadId: null,
    tabs: [{ path: "/file.md", scrollTop: 0 }],
  });
  vi.mocked(invoke).mockReset?.();
  invokeMock.mockReset?.();
});

function mockThreads(threads: CommentThread[]) {
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "get_file_comments") return threads;
    if (cmd === "get_file_badges") return {};
    return undefined;
  });
}

describe("commentsSlice — nextUnresolvedInActiveFile", () => {
  it("walks unresolved threads in line order", async () => {
    mockThreads([thread("a", 5), thread("b", 10), thread("c", 15)]);
    await useStore.getState().nextUnresolvedInActiveFile();
    expect(useStore.getState().focusedThreadId).toBe("a");
    await useStore.getState().nextUnresolvedInActiveFile();
    expect(useStore.getState().focusedThreadId).toBe("b");
    await useStore.getState().nextUnresolvedInActiveFile();
    expect(useStore.getState().focusedThreadId).toBe("c");
  });

  it("wraps at end", async () => {
    mockThreads([thread("a", 5), thread("b", 10)]);
    useStore.setState({ focusedThreadId: "b" });
    await useStore.getState().nextUnresolvedInActiveFile();
    expect(useStore.getState().focusedThreadId).toBe("a");
  });

  it("skips resolved threads", async () => {
    mockThreads([
      thread("a", 5),
      thread("resolved", 8, true),
      thread("b", 10),
    ]);
    await useStore.getState().nextUnresolvedInActiveFile();
    expect(useStore.getState().focusedThreadId).toBe("a");
    await useStore.getState().nextUnresolvedInActiveFile();
    expect(useStore.getState().focusedThreadId).toBe("b");
  });

  it("dispatches scroll-to-line CustomEvent with matched line", async () => {
    mockThreads([thread("a", 7)]);
    const events: number[] = [];
    const handler = (e: Event) => {
      events.push((e as CustomEvent<{ line: number }>).detail.line);
    };
    window.addEventListener("scroll-to-line", handler);
    await useStore.getState().nextUnresolvedInActiveFile();
    window.removeEventListener("scroll-to-line", handler);
    expect(events).toEqual([7]);
  });

  it("handles orphan threads (matchedLineNumber=0) without crashing", async () => {
    mockThreads([thread("orphan", 1, false, true), thread("b", 10)]);
    await useStore.getState().nextUnresolvedInActiveFile();
    // Orphans sort first (matchedLineNumber=0).
    expect(useStore.getState().focusedThreadId).toBe("orphan");
    await useStore.getState().nextUnresolvedInActiveFile();
    expect(useStore.getState().focusedThreadId).toBe("b");
  });

  it("no-ops when no active tab", async () => {
    useStore.setState({ activeTabPath: null });
    mockThreads([thread("a", 5)]);
    await useStore.getState().nextUnresolvedInActiveFile();
    expect(useStore.getState().focusedThreadId).toBeNull();
  });

  it("no-ops when no unresolved threads", async () => {
    mockThreads([thread("a", 5, true), thread("b", 10, true)]);
    await useStore.getState().nextUnresolvedInActiveFile();
    expect(useStore.getState().focusedThreadId).toBeNull();
  });
});

describe("commentsSlice — prevUnresolvedInActiveFile", () => {
  it("walks unresolved threads backwards in line order", async () => {
    mockThreads([thread("a", 5), thread("b", 10), thread("c", 15)]);
    useStore.setState({ focusedThreadId: "c" });
    await useStore.getState().prevUnresolvedInActiveFile();
    expect(useStore.getState().focusedThreadId).toBe("b");
    await useStore.getState().prevUnresolvedInActiveFile();
    expect(useStore.getState().focusedThreadId).toBe("a");
  });

  it("wraps at beginning", async () => {
    mockThreads([thread("a", 5), thread("b", 10)]);
    useStore.setState({ focusedThreadId: "a" });
    await useStore.getState().prevUnresolvedInActiveFile();
    expect(useStore.getState().focusedThreadId).toBe("b");
  });

  it("skips resolved threads going backwards", async () => {
    mockThreads([
      thread("a", 5),
      thread("resolved", 8, true),
      thread("b", 10),
    ]);
    useStore.setState({ focusedThreadId: "b" });
    await useStore.getState().prevUnresolvedInActiveFile();
    expect(useStore.getState().focusedThreadId).toBe("a");
  });
});

describe("commentsSlice — focused/input setters", () => {
  it("setFocusedThread updates state", () => {
    useStore.getState().setFocusedThread("xyz");
    expect(useStore.getState().focusedThreadId).toBe("xyz");
  });
});

describe("commentsSlice — resolveFocusedThread", () => {
  it("delegates to the registered VM handler", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    useStore.getState().setResolveFocusedThreadHandler(handler);
    await useStore.getState().resolveFocusedThread();
    expect(handler).toHaveBeenCalledOnce();
    useStore.getState().setResolveFocusedThreadHandler(null);
  });

  it("is a no-op when no handler is registered", async () => {
    useStore.getState().setResolveFocusedThreadHandler(null);
    await expect(
      useStore.getState().resolveFocusedThread(),
    ).resolves.toBeUndefined();
  });
});
