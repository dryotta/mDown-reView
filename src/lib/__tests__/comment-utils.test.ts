import { describe, it, expect } from "vitest";
import {
  SELECTED_TEXT_MAX_LENGTH,
  TEXT_MAX_LENGTH,
  truncateSelectedText,
} from "@/lib/comment-utils";

describe("MRSF constants", () => {
  it("SELECTED_TEXT_MAX_LENGTH is 4096", () => {
    expect(SELECTED_TEXT_MAX_LENGTH).toBe(4096);
  });

  it("TEXT_MAX_LENGTH is 16384", () => {
    expect(TEXT_MAX_LENGTH).toBe(16384);
  });
});

describe("truncateSelectedText", () => {
  it("returns text unchanged when under limit", () => {
    expect(truncateSelectedText("short")).toBe("short");
  });

  it("truncates text exceeding 4096 characters", () => {
    const long = "x".repeat(5000);
    const result = truncateSelectedText(long);
    expect(result.length).toBe(4096);
  });

  it("returns empty string for empty input", () => {
    expect(truncateSelectedText("")).toBe("");
  });

  it("truncates emoji text consistently with Rust (Unicode scalar values)", () => {
    const emoji = "😀".repeat(5000);
    const result = truncateSelectedText(emoji);
    expect(Array.from(result).length).toBeLessThanOrEqual(4096);
    expect(result).not.toMatch(/[\uD800-\uDBFF]$/);
  });

  it("counts combining characters as separate code points like Rust", () => {
    const combining = "e\u0301".repeat(3000);
    const result = truncateSelectedText(combining);
    expect(Array.from(result).length).toBeLessThanOrEqual(4096);
  });

  it("handles mixed ASCII and emoji correctly", () => {
    const mixed = "a".repeat(4000) + "😀".repeat(200);
    const result = truncateSelectedText(mixed);
    const codePoints = Array.from(result);
    expect(codePoints.length).toBe(4096);
    expect(result.startsWith("a".repeat(4000))).toBe(true);
  });
});
