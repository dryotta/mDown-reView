import { describe, it, expect } from "vitest";
import { canonicalizeAnchor, fingerprintAnchor } from "../anchor-fingerprint";
import type { Anchor } from "@/lib/anchor-derive";

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
      kind: "word_range",
      start_word: 0,
      end_word: 3,
      line: 1,
      snippet: "hello",
      line_text_hash: "abc",
    });
    // Same logical anchor with keys reshuffled.
    const b = canonicalizeAnchor({
      line_text_hash: "abc",
      snippet: "hello",
      line: 1,
      end_word: 3,
      start_word: 0,
      kind: "word_range",
    } as Anchor);
    expect(a).toBe(b);
  });

  it("covers all 4 anchor variants with distinct fingerprints", () => {
    const anchors: Anchor[] = [
      { kind: "line", line: 7 },
      { kind: "file" },
      {
        kind: "word_range",
        start_word: 0,
        end_word: 3,
        line: 1,
        snippet: "hi",
        line_text_hash: "abc",
      },
      { kind: "unknown" },
    ];
    const fps = anchors.map(fingerprintAnchor);
    // Each fingerprint is well-formed.
    fps.forEach((fp) => expect(fp).toMatch(/^[0-9a-f]{8}$/));
    // All 4 are distinct.
    expect(new Set(fps).size).toBe(4);
  });

  it("canonicalizeAnchor includes the kind discriminator", () => {
    expect(canonicalizeAnchor({ kind: "file" })).toContain('"kind":"file"');
    expect(canonicalizeAnchor({ kind: "line", line: 5 })).toContain('"kind":"line"');
  });
});
