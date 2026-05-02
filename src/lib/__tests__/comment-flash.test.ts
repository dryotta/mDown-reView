import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  assertNeverFlashKind,
  buildFlashDetail,
  commentFlashKindFor,
  emitCommentFlash,
  onCommentFlash,
  type CommentFlashDetail,
} from "@/lib/comment-flash";
import * as logger from "@/logger";
import type { MatchedComment } from "@/lib/tauri-commands";

vi.mock("@/logger");

/** Minimal MatchedComment stub. The wire shape mixes flat anchor fields
 *  with the renderer overlay (`matchedLineNumber`, `isOrphaned`); tests
 *  only set the fields the kind-derivation switch reads. */
function stubMatched(overrides: Partial<MatchedComment> = {}): MatchedComment {
  return {
    id: "c1",
    author: "tester",
    timestamp: "2025-01-01T00:00:00Z",
    text: "x",
    resolved: false,
    matchedLineNumber: 1,
    isOrphaned: false,
    ...overrides,
  } as MatchedComment;
}

describe("comment-flash discriminated union round-trip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("round-trips kind:'file' (no line field)", () => {
    const handler = vi.fn();
    const off = onCommentFlash(handler);
    const detail: CommentFlashDetail = {
      kind: "file",
      filePath: "/a.md",
      commentId: "c-file",
    };
    emitCommentFlash(detail);
    expect(handler).toHaveBeenCalledWith(detail);
    const received = handler.mock.calls[0][0] as CommentFlashDetail;
    // file kind MUST NOT carry `line`.
    expect(received).not.toHaveProperty("line");
    off();
  });

  it("round-trips kind:'line'", () => {
    const handler = vi.fn();
    const off = onCommentFlash(handler);
    const detail: CommentFlashDetail = {
      kind: "line",
      filePath: "/a.md",
      line: 7,
      commentId: "c-line",
    };
    emitCommentFlash(detail);
    expect(handler).toHaveBeenCalledWith(detail);
    off();
  });

  it("round-trips kind:'range' (carries endLine)", () => {
    const handler = vi.fn();
    const off = onCommentFlash(handler);
    const detail: CommentFlashDetail = {
      kind: "range",
      filePath: "/a.md",
      line: 3,
      endLine: 8,
      commentId: "c-range",
    };
    emitCommentFlash(detail);
    expect(handler).toHaveBeenCalledWith(detail);
    const received = handler.mock.calls[0][0] as CommentFlashDetail;
    if (received.kind !== "range") throw new Error("expected range");
    expect(received.endLine).toBe(8);
    off();
  });

  it("round-trips kind:'unmatched' (no line field)", () => {
    const handler = vi.fn();
    const off = onCommentFlash(handler);
    const detail: CommentFlashDetail = {
      kind: "unmatched",
      filePath: "/a.md",
      commentId: "c-orphan",
    };
    emitCommentFlash(detail);
    expect(handler).toHaveBeenCalledWith(detail);
    expect(handler.mock.calls[0][0]).not.toHaveProperty("line");
    off();
  });
});

describe("emitCommentFlash defensive clamp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clamps kind:'range' with endLine < line down to kind:'line' and warns", () => {
    const handler = vi.fn();
    const off = onCommentFlash(handler);
    emitCommentFlash({
      kind: "range",
      filePath: "/bad.md",
      line: 10,
      endLine: 5,
      commentId: "c-bad",
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      kind: "line",
      filePath: "/bad.md",
      line: 10,
      commentId: "c-bad",
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(logger.warn).mock.calls[0][0];
    // Source-of-truth literal (the logger module prepends `[web] `, so the
    // final emitted line reads `[web] flash kind=range with end_line<line, ...`).
    expect(arg).toContain("flash kind=range with end_line<line");
    expect(arg).toContain("file=/bad.md");
    expect(arg).toContain("comment_id=c-bad");
    off();
  });

  it("uses '?' for missing commentId in the clamp warning", () => {
    const handler = vi.fn();
    const off = onCommentFlash(handler);
    emitCommentFlash({ kind: "range", filePath: "/x.md", line: 4, endLine: 2 });
    const arg = vi.mocked(logger.warn).mock.calls[0][0];
    expect(arg).toContain("comment_id=?");
    expect(handler).toHaveBeenCalledWith({
      kind: "line",
      filePath: "/x.md",
      line: 4,
      commentId: undefined,
    });
    off();
  });
});

describe("assertNeverFlashKind exhaustiveness", () => {
  it("a switch over the 4 kinds compiles and is exhaustive", () => {
    function describe(d: CommentFlashDetail): string {
      switch (d.kind) {
        case "file":
          return "f";
        case "line":
          return "l";
        case "range":
          return "r";
        case "unmatched":
          return "u";
        default:
          return assertNeverFlashKind(d);
      }
    }
    expect(describe({ kind: "file", filePath: "/x", commentId: "1" })).toBe("f");
    expect(describe({ kind: "line", filePath: "/x", line: 1 })).toBe("l");
    expect(describe({ kind: "range", filePath: "/x", line: 1, endLine: 2 })).toBe("r");
    expect(describe({ kind: "unmatched", filePath: "/x", commentId: "1" })).toBe("u");
  });

  it("throws when handed an unreachable value", () => {
    expect(() => assertNeverFlashKind({ kind: "phantom" } as never)).toThrow(
      /unhandled CommentFlashDetail kind/
    );
  });
});

describe("commentFlashKindFor / buildFlashDetail", () => {
  it("anchor_kind='file' → kind:'file'", () => {
    const c = stubMatched({ anchor_kind: "file", id: "f1" });
    expect(commentFlashKindFor(c)).toBe("file");
    expect(buildFlashDetail(c, "/p.md")).toEqual({
      kind: "file",
      filePath: "/p.md",
      commentId: "f1",
    });
  });

  it("isOrphaned=true → kind:'unmatched'", () => {
    const c = stubMatched({ isOrphaned: true, id: "o1", matchedLineNumber: 4 });
    expect(commentFlashKindFor(c)).toBe("unmatched");
    expect(buildFlashDetail(c, "/p.md")).toEqual({
      kind: "unmatched",
      filePath: "/p.md",
      commentId: "o1",
    });
  });

  it("matchedLineNumber<=0 → kind:'unmatched'", () => {
    const c = stubMatched({ matchedLineNumber: 0, id: "u1" });
    expect(commentFlashKindFor(c)).toBe("unmatched");
  });

  it("end_line > matchedLineNumber → kind:'range'", () => {
    const c = stubMatched({ matchedLineNumber: 5, end_line: 8, id: "r1" });
    expect(commentFlashKindFor(c)).toBe("range");
    expect(buildFlashDetail(c, "/p.md")).toEqual({
      kind: "range",
      filePath: "/p.md",
      line: 5,
      endLine: 8,
      commentId: "r1",
    });
  });

  it("end_line == matchedLineNumber → kind:'line' (not range)", () => {
    const c = stubMatched({ matchedLineNumber: 5, end_line: 5, id: "l1" });
    expect(commentFlashKindFor(c)).toBe("line");
  });

  it("default single-line → kind:'line'", () => {
    const c = stubMatched({ matchedLineNumber: 9, id: "l2" });
    expect(commentFlashKindFor(c)).toBe("line");
    expect(buildFlashDetail(c, "/p.md")).toEqual({
      kind: "line",
      filePath: "/p.md",
      line: 9,
      commentId: "l2",
    });
  });
});
