import { describe, it, expect, vi } from "vitest";
import {
  generateCommentId,
  SELECTED_TEXT_MAX_LENGTH,
  TEXT_MAX_LENGTH,
  truncateSelectedText,
  validateTargetingFields,
} from "@/lib/comment-utils";

describe("generateCommentId", () => {
  it("returns a valid UUIDv4 string", () => {
    const id = generateCommentId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("returns unique IDs on successive calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateCommentId()));
    expect(ids.size).toBe(100);
  });
});

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
});

describe("validateTargetingFields", () => {
  it("clamps end_line to be >= line", () => {
    const result = validateTargetingFields({ line: 10, end_line: 5 });
    expect(result.end_line).toBe(10);
  });

  it("clamps end_column to be >= start_column on same line", () => {
    const result = validateTargetingFields({
      line: 10,
      end_line: 10,
      start_column: 20,
      end_column: 5,
    });
    expect(result.end_column).toBe(20);
  });

  it("allows end_column < start_column on different lines", () => {
    const result = validateTargetingFields({
      line: 10,
      end_line: 12,
      start_column: 20,
      end_column: 5,
    });
    expect(result.end_column).toBe(5);
  });

  it("passes through valid fields unchanged", () => {
    const fields = { line: 5, end_line: 10, start_column: 0, end_column: 30 };
    expect(validateTargetingFields(fields)).toEqual(fields);
  });

  it("handles partial fields (line only)", () => {
    const result = validateTargetingFields({ line: 5 });
    expect(result).toEqual({ line: 5 });
  });

  it("logs warning when clamping", () => {
    const logger = { warn: vi.fn() };
    validateTargetingFields({ line: 10, end_line: 5 }, logger);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("clamped end_line"));
  });
});
