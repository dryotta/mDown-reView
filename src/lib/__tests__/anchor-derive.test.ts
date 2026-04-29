import { describe, it, expect } from "vitest";
import { deriveAnchor, assertNeverAnchorKind } from "@/lib/anchor-derive";
import type { MrsfComment, Anchor } from "@/lib/anchor-derive";

/** Minimal MrsfComment stub for testing deriveAnchor. */
function stub(overrides: Partial<MrsfComment> = {}): MrsfComment {
  return {
    id: "test-id",
    author: "tester",
    timestamp: "2025-01-01T00:00:00Z",
    text: "test",
    resolved: false,
    ...overrides,
  };
}

describe("deriveAnchor", () => {
  it("returns c.anchor verbatim when present", () => {
    const anchor: Anchor = { kind: "file" };
    const c = stub({ anchor });
    expect(deriveAnchor(c)).toBe(anchor);
  });

  it("derives a line anchor from flat fields when anchor_kind is undefined", () => {
    const c = stub({ line: 10, end_line: 15, selected_text: "hello" });
    const a = deriveAnchor(c);
    expect(a).toEqual({
      kind: "line",
      line: 10,
      end_line: 15,
      selected_text: "hello",
      start_column: undefined,
      end_column: undefined,
      selected_text_hash: undefined,
    });
  });

  it('derives a line anchor when anchor_kind is "line"', () => {
    const c = stub({ anchor_kind: "line", line: 5 });
    const a = deriveAnchor(c);
    expect(a.kind).toBe("line");
    if (a.kind === "line") expect(a.line).toBe(5);
  });

  it("defaults line to 0 when missing", () => {
    const c = stub();
    const a = deriveAnchor(c);
    expect(a.kind).toBe("line");
    if (a.kind === "line") expect(a.line).toBe(0);
  });

  it('returns { kind: "file" } for anchor_kind "file"', () => {
    const c = stub({ anchor_kind: "file" });
    expect(deriveAnchor(c)).toEqual({ kind: "file" });
  });

  it("derives word_range anchor from payload", () => {
    const wr = { start_word: 2, end_word: 5, line: 1, snippet: "foo bar", line_text_hash: "abc" };
    const c = stub({ anchor_kind: "word_range", word_range: wr });
    const a = deriveAnchor(c);
    expect(a).toEqual({ kind: "word_range", ...wr });
  });

  it('returns { kind: "unknown" } for word_range without payload', () => {
    const c = stub({ anchor_kind: "word_range" });
    expect(deriveAnchor(c)).toEqual({ kind: "unknown" });
  });

  // Known-but-deleted anchor types map to unknown
  it.each([
    "image_rect" as const,
    "csv_cell" as const,
    "json_path" as const,
    "html_range" as const,
    "html_element" as const,
  ])('returns { kind: "unknown" } for deleted anchor_kind "%s"', (kind) => {
    const c = stub({ anchor_kind: kind });
    expect(deriveAnchor(c)).toEqual({ kind: "unknown" });
  });

  it('returns { kind: "unknown" } for deleted anchor_kind even with payload present', () => {
    const c = stub({
      anchor_kind: "image_rect",
      image_rect: { x_pct: 0.5, y_pct: 0.5 },
    });
    expect(deriveAnchor(c)).toEqual({ kind: "unknown" });
  });

  // Forward-compat: an unknown future discriminator (e.g. a renderer running
  // against a sidecar emitted by a newer Rust core) must NOT silently
  // collapse to a fabricated `Line 0` anchor — that would render as a
  // normal line badge in the UI. Rust's `TryFrom<&MrsfCommentRepr> for
  // Anchor` (`src-tauri/src/core/types/wire.rs`) maps any unrecognised
  // kind to `Anchor::Unknown`; the JS adapter must do the same.
  it('returns { kind: "unknown" } for an unknown future anchor_kind', () => {
    const c = stub({ anchor_kind: "image_v2" });
    expect(deriveAnchor(c)).toEqual({ kind: "unknown" });
  });
});

describe("assertNeverAnchorKind", () => {
  it("throws with a descriptive message", () => {
    // Force-cast to bypass TS never check — runtime guard test
    const bogus = { kind: "bogus" } as never;
    expect(() => assertNeverAnchorKind(bogus)).toThrow("Unhandled anchor kind: bogus");
  });
});
