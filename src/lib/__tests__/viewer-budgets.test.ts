import { describe, it, expect } from "vitest";
import {
  SIZE_WARN_THRESHOLD,
  MARKDOWN_VISUAL_CAP_BYTES,
  SOURCE_HIGHLIGHT_CHUNK_LINES,
  SOURCE_HIGHLIGHT_IDLE_BUDGET_MS,
  SOURCE_OVERSCAN,
  SOURCE_BASE_LINE_PX,
} from "@/lib/viewer-budgets";

describe("viewer-budgets", () => {
  it("SIZE_WARN_THRESHOLD is 500 KiB", () => {
    expect(SIZE_WARN_THRESHOLD).toBe(500 * 1024);
  });

  it("MARKDOWN_VISUAL_CAP_BYTES is 1 MiB and dominates the warn threshold", () => {
    expect(MARKDOWN_VISUAL_CAP_BYTES).toBe(1 * 1024 * 1024);
    expect(MARKDOWN_VISUAL_CAP_BYTES).toBeGreaterThan(SIZE_WARN_THRESHOLD);
  });

  it("SOURCE_HIGHLIGHT_CHUNK_LINES is positive and a sensible chunk size", () => {
    expect(SOURCE_HIGHLIGHT_CHUNK_LINES).toBeGreaterThan(0);
    // Spec calls for ~500 lines per chunk — the value MAY change but must stay
    // bounded so a single chunk fits inside one idle slot on slow hardware.
    expect(SOURCE_HIGHLIGHT_CHUNK_LINES).toBeLessThanOrEqual(2000);
  });

  it("SOURCE_HIGHLIGHT_IDLE_BUDGET_MS is in the [1, 16] window", () => {
    // Polyfill returns timeRemaining() = 16; budget must leave headroom.
    expect(SOURCE_HIGHLIGHT_IDLE_BUDGET_MS).toBeGreaterThanOrEqual(1);
    expect(SOURCE_HIGHLIGHT_IDLE_BUDGET_MS).toBeLessThan(16);
  });

  it("SOURCE_OVERSCAN is positive and bounded", () => {
    expect(SOURCE_OVERSCAN).toBeGreaterThan(0);
    // Too high defeats the point of virtualisation; cap at 100.
    expect(SOURCE_OVERSCAN).toBeLessThanOrEqual(100);
  });

  it("SOURCE_BASE_LINE_PX is a plausible monospace line height", () => {
    expect(SOURCE_BASE_LINE_PX).toBeGreaterThanOrEqual(14);
    expect(SOURCE_BASE_LINE_PX).toBeLessThanOrEqual(40);
  });
});
