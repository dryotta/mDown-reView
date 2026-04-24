import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useThreadsByLine } from "../useThreadsByLine";
import type { CommentThread, MatchedComment } from "@/lib/tauri-commands";

function makeReply(overrides: {
  id?: string;
  line?: number;
  matchedLineNumber?: number;
  resolved?: boolean;
}): MatchedComment {
  return {
    id: overrides.id ?? "r1",
    author: "test",
    text: "reply",
    line: overrides.line,
    matchedLineNumber: overrides.matchedLineNumber,
    createdAt: "2024-01-01",
    resolved: overrides.resolved ?? false,
  } as unknown as MatchedComment;
}

function makeThread(overrides: {
  id?: string;
  line?: number;
  matchedLineNumber?: number;
  resolved?: boolean;
  replies?: MatchedComment[];
}): CommentThread {
  return {
    root: {
      id: overrides.id ?? "c1",
      author: "test",
      text: "comment",
      line: overrides.line,
      matchedLineNumber: overrides.matchedLineNumber,
      createdAt: "2024-01-01",
      resolved: overrides.resolved ?? false,
    },
    replies: overrides.replies ?? [],
  } as unknown as CommentThread;
}

describe("useThreadsByLine — threadsByLine", () => {
  it("returns empty map for empty threads", () => {
    const { result } = renderHook(() => useThreadsByLine([]));
    expect(result.current.threadsByLine.size).toBe(0);
  });

  it("groups threads by matchedLineNumber", () => {
    const threads = [
      makeThread({ id: "c1", matchedLineNumber: 5 }),
      makeThread({ id: "c2", matchedLineNumber: 5 }),
      makeThread({ id: "c3", matchedLineNumber: 10 }),
    ];
    const { result } = renderHook(() => useThreadsByLine(threads));
    expect(result.current.threadsByLine.get(5)?.length).toBe(2);
    expect(result.current.threadsByLine.get(10)?.length).toBe(1);
  });

  it("falls back to root.line when matchedLineNumber is undefined", () => {
    const threads = [makeThread({ id: "c1", line: 7 })];
    const { result } = renderHook(() => useThreadsByLine(threads));
    expect(result.current.threadsByLine.get(7)?.length).toBe(1);
  });

  it("falls back to line 1 when both are undefined", () => {
    const threads = [makeThread({ id: "c1" })];
    const { result } = renderHook(() => useThreadsByLine(threads));
    expect(result.current.threadsByLine.get(1)?.length).toBe(1);
  });

  it("prefers matchedLineNumber over root.line", () => {
    const threads = [makeThread({ id: "c1", line: 3, matchedLineNumber: 8 })];
    const { result } = renderHook(() => useThreadsByLine(threads));
    expect(result.current.threadsByLine.has(3)).toBe(false);
    expect(result.current.threadsByLine.get(8)?.length).toBe(1);
  });

  it("updates when threads change", () => {
    const threads1 = [makeThread({ id: "c1", line: 2 })];
    const threads2 = [makeThread({ id: "c2", line: 5 })];
    const { result, rerender } = renderHook(
      ({ threads }) => useThreadsByLine(threads),
      { initialProps: { threads: threads1 } },
    );
    expect(result.current.threadsByLine.get(2)?.length).toBe(1);
    rerender({ threads: threads2 });
    expect(result.current.threadsByLine.has(2)).toBe(false);
    expect(result.current.threadsByLine.get(5)?.length).toBe(1);
  });
});

describe("useThreadsByLine — commentCountByLine", () => {
  it("counts unresolved root + unresolved replies on a thread", () => {
    const threads = [
      makeThread({
        id: "t1",
        matchedLineNumber: 4,
        replies: [
          makeReply({ id: "r1", matchedLineNumber: 4 }),
          makeReply({ id: "r2", matchedLineNumber: 4 }),
        ],
      }),
    ];
    const { result } = renderHook(() => useThreadsByLine(threads));
    expect(result.current.commentCountByLine.get(4)).toBe(3);
  });

  it("excludes resolved roots and resolved replies", () => {
    const threads = [
      makeThread({
        id: "t1",
        matchedLineNumber: 7,
        resolved: true,
        replies: [
          makeReply({ id: "r1", matchedLineNumber: 7, resolved: true }),
          makeReply({ id: "r2", matchedLineNumber: 7, resolved: false }),
        ],
      }),
    ];
    const { result } = renderHook(() => useThreadsByLine(threads));
    // Root resolved, one reply resolved; only one unresolved reply remains.
    expect(result.current.commentCountByLine.get(7)).toBe(1);
  });

  it("falls back to thread line when reply matchedLineNumber is missing", () => {
    const threads = [
      makeThread({
        id: "t1",
        matchedLineNumber: 9,
        replies: [makeReply({ id: "r1" })],
      }),
    ];
    const { result } = renderHook(() => useThreadsByLine(threads));
    expect(result.current.commentCountByLine.get(9)).toBe(2);
  });

  it("returns an empty map when every thread is resolved", () => {
    const threads = [
      makeThread({ id: "t1", matchedLineNumber: 1, resolved: true }),
    ];
    const { result } = renderHook(() => useThreadsByLine(threads));
    expect(result.current.commentCountByLine.size).toBe(0);
  });

  it("keeps map identity stable when threads ref is stable", () => {
    const threads = [makeThread({ id: "t1", matchedLineNumber: 2 })];
    const { result, rerender } = renderHook(
      ({ t }) => useThreadsByLine(t),
      { initialProps: { t: threads } },
    );
    const first = result.current.commentCountByLine;
    rerender({ t: threads });
    expect(result.current.commentCountByLine).toBe(first);
  });
});
