import { describe, it, expect } from "vitest";
import { fnv1a8 } from "@/lib/fnv1a";

describe("fnv1a8", () => {
  it("returns 8-char hex string", () => {
    const hash = fnv1a8("hello");
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("produces consistent hashes", () => {
    expect(fnv1a8("test")).toBe(fnv1a8("test"));
  });

  it("produces different hashes for different input", () => {
    expect(fnv1a8("hello")).not.toBe(fnv1a8("world"));
  });

  it("handles empty string", () => {
    const hash = fnv1a8("");
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });
});
