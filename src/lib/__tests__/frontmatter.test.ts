import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "@/lib/frontmatter";

// Iter 2 of issue #280 trimmed `parseFrontmatter`'s return shape to
// `Record<string, unknown> | null` (only `data`); the prior `body` field
// became dead code once the visual viewer switched to file-coord rendering
// via `remark-frontmatter`. These tests cover the surviving `data` contract.
describe("parseFrontmatter", () => {
  it("parses a happy-path block with multiple keys", () => {
    const input = "---\ntitle: Hello\nauthor: Alice\ndate: 2024-01-01\n---\n\nBody here\n";
    expect(parseFrontmatter(input)).toEqual({
      title: "Hello",
      author: "Alice",
      date: "2024-01-01",
    });
  });

  it("returns null when there is no leading ---", () => {
    expect(parseFrontmatter("no frontmatter here\n---\nstill body\n")).toBeNull();
  });

  it("returns null when there is no closing --- (malformed treated as plain content)", () => {
    expect(parseFrontmatter("---\ntitle: Hello\nauthor: Alice\nbody never closed")).toBeNull();
  });

  it("returns the parsed map even when frontmatter is followed by nothing", () => {
    expect(parseFrontmatter("---\ntitle: Hello\n---")).toEqual({ title: "Hello" });
  });

  it("silently skips lines without a colon inside the YAML block", () => {
    const input = "---\ntitle: Hello\nthis-line-has-no-colon\nauthor: Bob\n---\nBody\n";
    expect(parseFrontmatter(input)).toEqual({ title: "Hello", author: "Bob" });
  });

  it("preserves colons in the value (only the first colon is the separator)", () => {
    const input = "---\nurl: https://example.com:8080/path\ntime: 12:34:56\n---\nx";
    expect(parseFrontmatter(input)).toEqual({
      url: "https://example.com:8080/path",
      time: "12:34:56",
    });
  });

  it("returns null when there is no frontmatter at all", () => {
    expect(parseFrontmatter("# Just a heading\n\nSome paragraph.\n")).toBeNull();
  });

  it("drops empty keys (e.g. lines starting with a colon)", () => {
    expect(parseFrontmatter("---\n: orphan\nkey: value\n---\nBody")).toEqual({ key: "value" });
  });
});
