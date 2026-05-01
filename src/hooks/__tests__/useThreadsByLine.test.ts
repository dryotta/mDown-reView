import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useThreadsByLine } from "../useThreadsByLine";
import type { CommentThread, MatchedComment } from "@/lib/tauri-commands";

interface ThreadOverrides {
  id?: string;
  line?: number;
  matchedLineNumber?: number;
  resolved?: boolean;
  isOrphaned?: boolean;
  anchor_kind?: string | null;
  replies?: MatchedComment[];
}

function makeReply(overrides: {
  id?: string;
  line?: number;
  matchedLineNumber?: number;
  resolved?: boolean;
  isOrphaned?: boolean;
}): MatchedComment {
  return {
    id: overrides.id ?? "r1",
    author: "test",
    text: "reply",
    line: overrides.line,
    matchedLineNumber: overrides.matchedLineNumber ?? 0,
    isOrphaned: overrides.isOrphaned ?? false,
    createdAt: "2024-01-01",
    resolved: overrides.resolved ?? false,
  } as unknown as MatchedComment;
}

function makeThread(overrides: ThreadOverrides): CommentThread {
  return {
    root: {
      id: overrides.id ?? "c1",
      author: "test",
      text: "comment",
      line: overrides.line,
      matchedLineNumber: overrides.matchedLineNumber ?? 0,
      isOrphaned: overrides.isOrphaned ?? false,
      anchor_kind: overrides.anchor_kind ?? "line",
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

  it("updates when threads change", () => {
    const threads1 = [makeThread({ id: "c1", matchedLineNumber: 2 })];
    const threads2 = [makeThread({ id: "c2", matchedLineNumber: 5 })];
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

  it("counts a re-anchored reply on its own matched line, not the root's line", () => {
    // Reply re-anchored to line 12 while its thread root sits on line 4.
    // Gutter badge for line 12 must reflect the reply; line 4 must not double-count it.
    const threads = [
      makeThread({
        id: "t1",
        matchedLineNumber: 4,
        replies: [makeReply({ id: "r1", matchedLineNumber: 12 })],
      }),
    ];
    const { result } = renderHook(() => useThreadsByLine(threads));
    expect(result.current.commentCountByLine.get(4)).toBe(1);
    expect(result.current.commentCountByLine.get(12)).toBe(1);
  });

  it("falls back to thread line when reply matchedLineNumber is missing", () => {
    const threads = [
      makeThread({
        id: "t1",
        matchedLineNumber: 9,
        replies: [makeReply({ id: "r1" })], // matchedLineNumber=0 → reply falls back to root
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

describe("useThreadsByLine — Rule 31 gutter exclusion (issue #280 AC2/AC7)", () => {
  // AC2 regression: with one file-anchored + one orphan + one line-N comment,
  // the gutter shows ONE badge at line N; nothing accumulates at line 1.
  it("excludes file-anchored, orphan, and matchedLineNumber<=0 threads from per-line buckets", () => {
    const fileAnchored = makeThread({
      id: "file1",
      anchor_kind: "file",
      matchedLineNumber: 1, // synthetic file-anchor sentinel
    });
    const orphan = makeThread({
      id: "orphan1",
      matchedLineNumber: 0, // unresolved sentinel
      isOrphaned: true,
    });
    const unknown = makeThread({
      id: "unknown1",
      matchedLineNumber: 0, // Anchor::Unknown sentinel
    });
    const realLine = makeThread({ id: "line9", matchedLineNumber: 9 });

    const { result } = renderHook(() =>
      useThreadsByLine([fileAnchored, orphan, unknown, realLine]),
    );
    const counts = result.current.commentCountByLine;
    // Only the line-9 thread should bucket; line 1 must NOT collect the
    // file-anchored sentinel even though its matchedLineNumber == 1.
    expect(counts.size).toBe(1);
    expect(counts.has(9)).toBe(true);
    expect(counts.has(1)).toBe(false);
    expect(counts.has(0)).toBe(false);

    // threadsByLine likewise excludes the three sentinel threads.
    expect(result.current.threadsByLine.size).toBe(1);
    expect(result.current.threadsByLine.get(9)?.length).toBe(1);
  });

  // Issue #131 legacy: v1.0 sidecars where `line: 0` deserialize as
  // `Anchor::Line { line: 0 }`. The Rust matcher synthesizes
  // matchedLineNumber=1 with anchor_kind="line" (NOT "file") and
  // isOrphaned=false, so they SHOULD bucket at line 1.
  it("legacy v1.0 line=0 (matchedLineNumber=1 sentinel) buckets at line 1", () => {
    const legacyV10 = makeThread({
      id: "legacy",
      anchor_kind: "line",
      matchedLineNumber: 1,
      line: 0,
      isOrphaned: false,
    });
    const { result } = renderHook(() => useThreadsByLine([legacyV10]));
    expect(result.current.commentCountByLine.get(1)).toBe(1);
  });
});
