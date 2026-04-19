import { describe, it, expect } from "vitest";
import { normalizeLine, computeLineHash, captureContext } from "@/lib/comment-anchors";

describe("normalizeLine", () => {
  it("trims whitespace", () => {
    expect(normalizeLine("  hello  ")).toBe("hello");
  });
  it("collapses internal whitespace", () => {
    expect(normalizeLine("hello   world  foo")).toBe("hello world foo");
  });
  it("preserves case", () => {
    expect(normalizeLine("Hello World")).toBe("Hello World");
  });
  it("handles empty string", () => {
    expect(normalizeLine("")).toBe("");
  });
  it("handles whitespace-only", () => {
    expect(normalizeLine("   ")).toBe("");
  });
});

describe("computeLineHash", () => {
  it("returns 8-char hex", () => {
    const hash = computeLineHash("hello world");
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });
  it("normalizes before hashing", () => {
    expect(computeLineHash("  hello   world  ")).toBe(computeLineHash("hello world"));
  });
  it("different text produces different hash", () => {
    expect(computeLineHash("hello")).not.toBe(computeLineHash("world"));
  });
});

describe("captureContext", () => {
  const lines = ["line0", "line1", "line2", "line3", "line4"];

  it("captures 2 lines before and after", () => {
    const ctx = captureContext(lines, 2);
    expect(ctx.contextBefore).toBe("line0\nline1");
    expect(ctx.contextAfter).toBe("line3\nline4");
  });
  it("handles first line (no before)", () => {
    const ctx = captureContext(lines, 0);
    expect(ctx.contextBefore).toBe("");
    expect(ctx.contextAfter).toBe("line1\nline2");
  });
  it("handles second line (1 before)", () => {
    const ctx = captureContext(lines, 1);
    expect(ctx.contextBefore).toBe("line0");
    expect(ctx.contextAfter).toBe("line2\nline3");
  });
  it("handles last line (no after)", () => {
    const ctx = captureContext(lines, 4);
    expect(ctx.contextBefore).toBe("line2\nline3");
    expect(ctx.contextAfter).toBe("");
  });
  it("handles 2-line file", () => {
    const ctx = captureContext(["a", "b"], 0);
    expect(ctx.contextBefore).toBe("");
    expect(ctx.contextAfter).toBe("b");
  });
  it("normalizes context lines", () => {
    const ctx = captureContext(["  a  ", "  b  ", "  c  "], 1);
    expect(ctx.contextBefore).toBe("a");
    expect(ctx.contextAfter).toBe("c");
  });
});
