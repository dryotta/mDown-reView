import { describe, it, expect } from "vitest";
import { canonicalizeAnchor, fingerprintAnchor } from "../anchor-fingerprint";
import type { Anchor } from "@/types/comments";

describe("anchor-fingerprint", () => {
  it("produces an 8-char lowercase hex fingerprint", () => {
    const fp = fingerprintAnchor({ kind: "file" });
    expect(fp).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is deterministic — same anchor → same fingerprint", () => {
    const a: Anchor = { kind: "line", line: 42, selected_text: "hello" };
    const b: Anchor = { kind: "line", line: 42, selected_text: "hello" };
    expect(fingerprintAnchor(a)).toBe(fingerprintAnchor(b));
  });

  it("different anchors → different fingerprints", () => {
    const a = fingerprintAnchor({ kind: "line", line: 1 });
    const b = fingerprintAnchor({ kind: "line", line: 2 });
    const c = fingerprintAnchor({ kind: "file" });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it("is independent of key order in the payload", () => {
    const a = canonicalizeAnchor({
      kind: "image_rect",
      x_pct: 0.1,
      y_pct: 0.2,
      w_pct: 0.3,
      h_pct: 0.4,
    });
    // Same logical anchor with keys reshuffled.
    const b = canonicalizeAnchor({
      h_pct: 0.4,
      w_pct: 0.3,
      y_pct: 0.2,
      x_pct: 0.1,
      kind: "image_rect",
    } as Anchor);
    expect(a).toBe(b);
    expect(fingerprintAnchor({
      kind: "csv_cell",
      row_idx: 3,
      col_idx: 1,
      col_header: "name",
    })).toBe(fingerprintAnchor({
      col_header: "name",
      col_idx: 1,
      row_idx: 3,
      kind: "csv_cell",
    } as Anchor));
  });

  it("covers all 8 anchor variants with distinct fingerprints", () => {
    const anchors: Anchor[] = [
      { kind: "line", line: 7 },
      { kind: "file" },
      { kind: "word_range", start_word: 0, end_word: 3, line: 1, snippet: "hi", line_text_hash: "abc" },
      { kind: "image_rect", x_pct: 0.1, y_pct: 0.2 },
      { kind: "csv_cell", row_idx: 2, col_idx: 1, col_header: "name" },
      { kind: "json_path", json_path: "$.a.b" },
      { kind: "html_range", selector_path: "body>p", start_offset: 0, end_offset: 5, selected_text: "hello" },
      { kind: "html_element", selector_path: "body>p", tag: "p", text_preview: "x" },
    ];
    const fps = anchors.map(fingerprintAnchor);
    // Each fingerprint is well-formed.
    fps.forEach((fp) => expect(fp).toMatch(/^[0-9a-f]{8}$/));
    // All 8 are distinct.
    expect(new Set(fps).size).toBe(8);
  });

  it("canonicalizeAnchor includes the kind discriminator", () => {
    expect(canonicalizeAnchor({ kind: "file" })).toContain('"kind":"file"');
    expect(canonicalizeAnchor({ kind: "line", line: 5 })).toContain('"kind":"line"');
  });
});
