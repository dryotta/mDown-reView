import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFilteredComments, type CommentFilters, type SeverityFilter } from "../useFilteredComments";
import { useComments } from "../use-comments";
import { useWorkspaceComments } from "../useWorkspaceComments";
import type { CommentThread, MatchedComment } from "@/lib/tauri-commands";

vi.mock("../use-comments", () => ({
  useComments: vi.fn(() => ({ threads: [], comments: [], loading: false, reload: vi.fn() })),
}));

vi.mock("../useWorkspaceComments", () => ({
  useWorkspaceComments: vi.fn(() => ({})),
}));

const mockUseComments = vi.mocked(useComments);
const mockUseWorkspace = vi.mocked(useWorkspaceComments);

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
    search: "",
    severities: new Set<SeverityFilter>(),
    showResolved: true,
    workspaceWide: false,
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
  mockUseWorkspace.mockReturnValue({});
});

describe("useFilteredComments", () => {
  it("returns empty when activeFilePath is null and workspaceWide is false", () => {
    const { result } = renderHook(() =>
      useFilteredComments(null, makeFilters()),
    );
    expect(result.current).toEqual([]);
  });

  it("uses per-file threads when workspaceWide=false and activeFilePath is set", () => {
    setActiveThreads([makeThread(makeComment("a", "hi"))]);
    const { result } = renderHook(() =>
      useFilteredComments("/x.md", makeFilters()),
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({ filePath: "/x.md" });
  });

  it("flattens threads from useWorkspaceComments map when workspaceWide=true", () => {
    mockUseWorkspace.mockReturnValue({
      "/a.md": [makeThread(makeComment("a", "from-a"))],
      "/b.md": [makeThread(makeComment("b", "from-b"))],
    });
    const { result } = renderHook(() =>
      useFilteredComments(null, makeFilters({ workspaceWide: true })),
    );
    expect(result.current.map((r) => r.filePath)).toEqual(["/a.md", "/b.md"]);
  });

  it("search is case-insensitive on root body", () => {
    setActiveThreads([
      makeThread(makeComment("a", "ALPHA first")),
      makeThread(makeComment("b", "beta")),
    ]);
    const { result } = renderHook(() =>
      useFilteredComments("/x.md", makeFilters({ search: "alpha" })),
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0].thread.root.id).toBe("a");
  });

  it("search is case-insensitive on a reply body", () => {
    setActiveThreads([
      makeThread(makeComment("a", "root"), [makeComment("r1", "DEEP reply", { reply_to: "a" })]),
    ]);
    const { result } = renderHook(() =>
      useFilteredComments("/x.md", makeFilters({ search: "deep" })),
    );
    expect(result.current).toHaveLength(1);
  });

  it("search query with leading/trailing whitespace is trimmed (B5)", () => {
    setActiveThreads([
      makeThread(makeComment("a", "alpha first")),
      makeThread(makeComment("b", "beta")),
    ]);
    const { result } = renderHook(() =>
      useFilteredComments("/x.md", makeFilters({ search: "  alpha  " })),
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0].thread.root.id).toBe("a");
  });

  it("severity filter matches when root.severity is in the set", () => {
    setActiveThreads([
      makeThread(makeComment("a", "x", { severity: "high" })),
      makeThread(makeComment("b", "y", { severity: "low" })),
    ]);
    const { result } = renderHook(() =>
      useFilteredComments("/x.md", makeFilters({ severities: new Set<SeverityFilter>(["high"]) })),
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0].thread.root.id).toBe("a");
  });

  it("severity filter misses when no comment in thread matches", () => {
    setActiveThreads([
      makeThread(makeComment("a", "x", { severity: "high" })),
    ]);
    const { result } = renderHook(() =>
      useFilteredComments("/x.md", makeFilters({ severities: new Set<SeverityFilter>(["low"]) })),
    );
    expect(result.current).toEqual([]);
  });

  it("severity filter includes thread when only a REPLY has the severity", () => {
    setActiveThreads([
      makeThread(
        makeComment("a", "root", { severity: "low" }),
        [makeComment("r1", "reply", { severity: "high", reply_to: "a" })],
      ),
    ]);
    const { result } = renderHook(() =>
      useFilteredComments("/x.md", makeFilters({ severities: new Set<SeverityFilter>(["high"]) })),
    );
    expect(result.current).toHaveLength(1);
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
});
