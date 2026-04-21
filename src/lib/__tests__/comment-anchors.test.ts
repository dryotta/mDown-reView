import { describe, it, expect } from "vitest";
import { computeSelectedTextHash, createLineAnchor, createSelectionAnchor } from "@/lib/comment-anchors";

describe("computeSelectedTextHash", () => {
  it("returns a hex string", async () => {
    const hash = await computeSelectedTextHash("hello world");
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });
  it("produces consistent results", async () => {
    const h1 = await computeSelectedTextHash("test");
    const h2 = await computeSelectedTextHash("test");
    expect(h1).toBe(h2);
  });
  it("different text produces different hash", async () => {
    const h1 = await computeSelectedTextHash("hello");
    const h2 = await computeSelectedTextHash("world");
    expect(h1).not.toBe(h2);
  });
});

describe("createLineAnchor", () => {
  it("creates anchor with line number", () => {
    expect(createLineAnchor(42)).toEqual({ line: 42 });
  });
});

describe("createSelectionAnchor", () => {
  it("creates anchor with all fields", () => {
    const anchor = createSelectionAnchor(10, 12, 5, 20, "selected code", "abc123");
    expect(anchor).toEqual({
      line: 10,
      end_line: 12,
      start_column: 5,
      end_column: 20,
      selected_text: "selected code",
      selected_text_hash: "abc123",
    });
  });
});

describe("createSelectionAnchor — truncation and validation", () => {
  it("truncates selected_text exceeding 4096 characters", () => {
    const longText = "x".repeat(5000);
    const anchor = createSelectionAnchor(1, 1, 0, 5000, longText, "hash");
    expect(anchor.selected_text.length).toBe(4096);
  });

  it("clamps end_line to be >= line", () => {
    const anchor = createSelectionAnchor(10, 5, 0, 10, "text", "hash");
    expect(anchor.end_line).toBe(10);
  });

  it("clamps end_column to >= start_column on same line", () => {
    const anchor = createSelectionAnchor(10, 10, 20, 5, "text", "hash");
    expect(anchor.end_column).toBe(20);
  });
});
