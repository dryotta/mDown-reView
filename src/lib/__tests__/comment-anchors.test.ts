import { describe, it, expect } from "vitest";
import { computeSelectedTextHash } from "@/lib/comment-anchors";

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
