import { describe, it, expect } from "vitest";
import { computeFoldRegions, type FoldRegion } from "@/lib/fold-regions";

describe("computeFoldRegions — brace matching", () => {
  it("detects simple brace block", () => {
    const lines = ["function foo() {", "  return 1;", "}"];
    const regions = computeFoldRegions(lines);
    expect(regions).toEqual([{ startLine: 1, endLine: 3 }]);
  });

  it("detects nested brace blocks", () => {
    const lines = ["if (x) {", "  if (y) {", "    z();", "  }", "}"];
    const regions = computeFoldRegions(lines);
    expect(regions).toContainEqual({ startLine: 1, endLine: 5 });
    expect(regions).toContainEqual({ startLine: 2, endLine: 4 });
  });

  it("ignores braces inside strings", () => {
    const lines = ['const s = "a { b";', "const t = 1;"];
    const regions = computeFoldRegions(lines);
    expect(regions).toEqual([]);
  });

  it("ignores braces inside comments", () => {
    const lines = ["// function foo() {", "const x = 1;"];
    const regions = computeFoldRegions(lines);
    expect(regions).toEqual([]);
  });

  it("detects bracket blocks", () => {
    const lines = ["const arr = [", "  1,", "  2,", "];"];
    const regions = computeFoldRegions(lines);
    expect(regions).toEqual([{ startLine: 1, endLine: 4 }]);
  });

  it("requires minimum 2 inner lines to fold", () => {
    const lines = ["{ }", "x"];
    const regions = computeFoldRegions(lines);
    expect(regions).toEqual([]);
  });
});

describe("computeFoldRegions — indentation", () => {
  it("detects indentation block in Python-like code", () => {
    const lines = ["def foo():", "  x = 1", "  y = 2", "z = 3"];
    const regions = computeFoldRegions(lines);
    expect(regions).toContainEqual({ startLine: 1, endLine: 3 });
  });

  it("detects nested indentation blocks", () => {
    const lines = [
      "class Foo:",
      "  def bar():",
      "    pass",
      "  def baz():",
      "    pass",
    ];
    const regions = computeFoldRegions(lines);
    expect(regions).toContainEqual({ startLine: 1, endLine: 5 });
    expect(regions).toContainEqual({ startLine: 2, endLine: 3 });
    expect(regions).toContainEqual({ startLine: 4, endLine: 5 });
  });

  it("skips blank lines in indentation tracking", () => {
    const lines = ["def foo():", "  x = 1", "", "  y = 2", "z = 3"];
    const regions = computeFoldRegions(lines);
    expect(regions).toContainEqual({ startLine: 1, endLine: 4 });
  });

  it("returns empty for flat file", () => {
    const lines = ["a", "b", "c"];
    const regions = computeFoldRegions(lines);
    expect(regions).toEqual([]);
  });
});
