/**
 * B3 — `HAS_MATH_RE` is the gate that decides whether to lazy-load
 * `rehype-katex` (~150 KB). False positives cost a wasted bundle download;
 * false negatives cost broken math rendering. These tests pin the regex's
 * documented contract so future edits cannot silently regress either side.
 */
import { describe, it, expect } from "vitest";
import { HAS_MATH_RE } from "../MarkdownViewer";

describe("HAS_MATH_RE", () => {
  it("matches inline math `$E=mc^2$`", () => {
    expect(HAS_MATH_RE.test("see $E=mc^2$ here")).toBe(true);
  });

  it("matches single-char inline `$x$`", () => {
    expect(HAS_MATH_RE.test("the value $x$ wins")).toBe(true);
  });

  it("matches block math `$$\\int$$`", () => {
    expect(HAS_MATH_RE.test("equation: $$\\int_0^1 x\\,dx$$")).toBe(true);
  });

  it("matches block math spanning multiple lines", () => {
    expect(HAS_MATH_RE.test("$$\n\\sum_{i=1}^n i\n$$")).toBe(true);
  });

  it("rejects currency `$5 and $10`", () => {
    expect(HAS_MATH_RE.test("price is $5 and $10 too")).toBe(false);
  });

  it("rejects spaced-pair `$ x $` (whitespace adjacent to delimiters)", () => {
    expect(HAS_MATH_RE.test("see $ x $ here")).toBe(false);
  });

  it("rejects trailing-space `$ x$`", () => {
    expect(HAS_MATH_RE.test("see $ x$ here")).toBe(false);
  });

  it("rejects single dollar `$5`", () => {
    expect(HAS_MATH_RE.test("$5")).toBe(false);
  });

  it("admits digit-starting math with operators `$2^n$`", () => {
    expect(HAS_MATH_RE.test("complexity is $2^n$ growth")).toBe(true);
  });

  it("admits digit-starting math `$100 + x$`", () => {
    expect(HAS_MATH_RE.test("solve $100 + x$ for x")).toBe(true);
  });

  it("rejects empty document", () => {
    expect(HAS_MATH_RE.test("")).toBe(false);
  });

  it("rejects plain prose without delimiters", () => {
    expect(HAS_MATH_RE.test("just a sentence with no math at all")).toBe(false);
  });
});
