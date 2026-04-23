import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useThreadsByLine } from "../useThreadsByLine";
import type { CommentThread } from "@/lib/tauri-commands";

function makeThread(overrides: {
  id?: string;
  line?: number;
  matchedLineNumber?: number;
}): CommentThread {
  return {
    root: {
      id: overrides.id ?? "c1",
      author: "test",
      text: "comment",
      line: overrides.line,
      matchedLineNumber: overrides.matchedLineNumber,
      createdAt: "2024-01-01",
      resolved: false,
    },
    replies: [],
  } as unknown as CommentThread;
}

describe("useThreadsByLine", () => {
  it("returns empty map for empty threads", () => {
    const { result } = renderHook(() => useThreadsByLine([]));
    expect(result.current.size).toBe(0);
  });

  it("groups threads by matchedLineNumber", () => {
    const threads = [
      makeThread({ id: "c1", matchedLineNumber: 5 }),
      makeThread({ id: "c2", matchedLineNumber: 5 }),
      makeThread({ id: "c3", matchedLineNumber: 10 }),
    ];
    const { result } = renderHook(() => useThreadsByLine(threads));
    expect(result.current.get(5)?.length).toBe(2);
    expect(result.current.get(10)?.length).toBe(1);
  });

  it("falls back to root.line when matchedLineNumber is undefined", () => {
    const threads = [makeThread({ id: "c1", line: 7 })];
    const { result } = renderHook(() => useThreadsByLine(threads));
    expect(result.current.get(7)?.length).toBe(1);
  });

  it("falls back to line 1 when both are undefined", () => {
    const threads = [makeThread({ id: "c1" })];
    const { result } = renderHook(() => useThreadsByLine(threads));
    expect(result.current.get(1)?.length).toBe(1);
  });

  it("prefers matchedLineNumber over root.line", () => {
    const threads = [makeThread({ id: "c1", line: 3, matchedLineNumber: 8 })];
    const { result } = renderHook(() => useThreadsByLine(threads));
    expect(result.current.has(3)).toBe(false);
    expect(result.current.get(8)?.length).toBe(1);
  });

  it("updates when threads change", () => {
    const threads1 = [makeThread({ id: "c1", line: 2 })];
    const threads2 = [makeThread({ id: "c2", line: 5 })];
    const { result, rerender } = renderHook(
      ({ threads }) => useThreadsByLine(threads),
      { initialProps: { threads: threads1 } },
    );
    expect(result.current.get(2)?.length).toBe(1);
    rerender({ threads: threads2 });
    expect(result.current.has(2)).toBe(false);
    expect(result.current.get(5)?.length).toBe(1);
  });
});
