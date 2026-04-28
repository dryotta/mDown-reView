import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFilteredComments, type CommentFilters } from "../useFilteredComments";
import { useComments } from "../use-comments";
import type { CommentThread, MatchedComment } from "@/lib/tauri-commands";

vi.mock("../use-comments", () => ({
  useComments: vi.fn(() => ({ threads: [], comments: [], loading: false, reload: vi.fn() })),
}));

const mockUseComments = vi.mocked(useComments);

function makeComment(
  id: string,
  text: string,
  overrides: Partial<MatchedComment> = {},
): MatchedComment {
  return {
    id,
    author: "T",
    timestamp: new Date().toISOString(),
    text,
    resolved: false,
    line: 1,
    matchedLineNumber: 1,
    isOrphaned: false,
    anchor: { kind: "line", line: 1 },
    ...overrides,
  };
}

function makeThread(root: MatchedComment, replies: MatchedComment[] = []): CommentThread {
  return { root, replies };
}

function makeFilters(p: Partial<CommentFilters> = {}): CommentFilters {
  return {
    showResolved: true,
    ...p,
  };
}

function setActiveThreads(threads: CommentThread[]) {
  mockUseComments.mockReturnValue({
    threads,
    comments: threads.flatMap((t) => [t.root, ...t.replies]),
    loading: false,
    reload: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setActiveThreads([]);
});

describe("useFilteredComments", () => {
  it("returns empty when activeFilePath is null", () => {
    const { result } = renderHook(() =>
      useFilteredComments(null, makeFilters()),
    );
    expect(result.current).toEqual([]);
  });

  it("uses per-file threads when activeFilePath is set", () => {
    setActiveThreads([makeThread(makeComment("a", "hi"))]);
    const { result } = renderHook(() =>
      useFilteredComments("/x.md", makeFilters()),
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({ filePath: "/x.md" });
  });

  it("showResolved=false hides thread where every comment is resolved", () => {
    setActiveThreads([
      makeThread(
        makeComment("a", "x", { resolved: true }),
        [makeComment("r1", "y", { resolved: true, reply_to: "a" })],
      ),
    ]);
    const { result } = renderHook(() =>
      useFilteredComments("/x.md", makeFilters({ showResolved: false })),
    );
    expect(result.current).toEqual([]);
  });

  it("showResolved=false KEEPS thread where root is resolved but a reply is unresolved", () => {
    setActiveThreads([
      makeThread(
        makeComment("a", "x", { resolved: true }),
        [makeComment("r1", "y", { resolved: false, reply_to: "a" })],
      ),
    ]);
    const { result } = renderHook(() =>
      useFilteredComments("/x.md", makeFilters({ showResolved: false })),
    );
    expect(result.current).toHaveLength(1);
  });

  it("sorts threads by matchedLineNumber", () => {
    setActiveThreads([
      makeThread(makeComment("b", "second", { matchedLineNumber: 20 })),
      makeThread(makeComment("a", "first", { matchedLineNumber: 10 })),
    ]);
    const { result } = renderHook(() =>
      useFilteredComments("/x.md", makeFilters()),
    );
    expect(result.current[0].thread.root.id).toBe("a");
    expect(result.current[1].thread.root.id).toBe("b");
  });

  it("excludes threads whose root anchor kind is 'unknown'", () => {
    setActiveThreads([
      makeThread(makeComment("ok", "visible", { anchor: { kind: "line", line: 1 } })),
      makeThread(makeComment("hidden", "ghost", { anchor: { kind: "unknown" } })),
    ]);
    const { result } = renderHook(() =>
      useFilteredComments("/x.md", makeFilters()),
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0].thread.root.id).toBe("ok");
  });

  it("keeps threads with anchor kind 'file'", () => {
    setActiveThreads([
      makeThread(makeComment("f", "file-level", { anchor: { kind: "file" }, line: 0 })),
    ]);
    const { result } = renderHook(() =>
      useFilteredComments("/x.md", makeFilters()),
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0].thread.root.id).toBe("f");
  });
});
