import { describe, it, expect } from "vitest";
import {
  MARKDOWN_SOURCE_CLAMP_BYTES,
  MARKDOWN_DEFER_BYTES,
  SOURCE_CHUNK_LINES,
  SOURCE_CHUNK_BYTES,
  SOURCE_LONG_LINE_BYTES,
  SOURCE_BASE_LINE_PX,
  SOURCE_OVERSCAN,
  IDLE_BUDGET_MS,
  SIZE_WARN_THRESHOLD,
} from "@/lib/viewer-budgets";

describe("viewer-budgets", () => {
  it("MARKDOWN_SOURCE_CLAMP_BYTES is 1 MB", () => {
    expect(MARKDOWN_SOURCE_CLAMP_BYTES).toBe(1_000_000);
  });

  it("MARKDOWN_DEFER_BYTES is below MARKDOWN_SOURCE_CLAMP_BYTES (defer band sits beneath the hard clamp)", () => {
    expect(MARKDOWN_DEFER_BYTES).toBeLessThan(MARKDOWN_SOURCE_CLAMP_BYTES);
  });

  it("SIZE_WARN_THRESHOLD equals MARKDOWN_DEFER_BYTES (paired thresholds — warn band == defer band)", () => {
    expect(SIZE_WARN_THRESHOLD).toBe(MARKDOWN_DEFER_BYTES);
  });

  it("SOURCE_CHUNK_LINES is a positive integer", () => {
    expect(Number.isInteger(SOURCE_CHUNK_LINES)).toBe(true);
    expect(SOURCE_CHUNK_LINES).toBeGreaterThan(0);
  });

  it("SOURCE_CHUNK_BYTES is a positive integer", () => {
    expect(Number.isInteger(SOURCE_CHUNK_BYTES)).toBe(true);
    expect(SOURCE_CHUNK_BYTES).toBeGreaterThan(0);
  });

  it("SOURCE_LONG_LINE_BYTES dwarfs SOURCE_CHUNK_BYTES (long-line guard kicks in well above per-chunk cap)", () => {
    expect(SOURCE_LONG_LINE_BYTES).toBeGreaterThan(SOURCE_CHUNK_BYTES);
  });

  it("SOURCE_BASE_LINE_PX is a sane CSS px value (10..100)", () => {
    expect(SOURCE_BASE_LINE_PX).toBeGreaterThanOrEqual(10);
    expect(SOURCE_BASE_LINE_PX).toBeLessThanOrEqual(100);
  });

  it("SOURCE_OVERSCAN is at least 5 (PgDn/PgUp without flicker)", () => {
    expect(SOURCE_OVERSCAN).toBeGreaterThanOrEqual(5);
  });

  it("IDLE_BUDGET_MS is positive", () => {
    expect(IDLE_BUDGET_MS).toBeGreaterThan(0);
  });
});
