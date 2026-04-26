import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readDraft, writeDraft, clearDraft } from "@/lib/comment-drafts";

// T3 (iter-5): the draft persistence layer is the safety net behind every
// composer in the comment system — silent failures here mean lost user
// text. These tests pin the contract for both the happy path and the two
// failure modes (key absent, localStorage throwing).

describe("comment-drafts", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("round-trips: write then read returns the same string", () => {
    writeDraft("file.md::reply::c1", "hello world");
    expect(readDraft("file.md::reply::c1")).toBe("hello world");
  });

  it("readDraft returns empty string for an unknown key", () => {
    expect(readDraft("never-set")).toBe("");
  });

  it("clearDraft removes the slot so a subsequent read returns empty", () => {
    writeDraft("k", "v");
    expect(readDraft("k")).toBe("v");
    clearDraft("k");
    expect(readDraft("k")).toBe("");
  });

  it("falls back to in-memory storage when localStorage.setItem throws", () => {
    const setSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    // Read also throws here to simulate a fully-disabled localStorage,
    // forcing the read path to consult the memory map. Otherwise the
    // first getItem() returns null (cleared in beforeEach) and the
    // memory-map fallback never runs.
    const getSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Disabled");
    });

    writeDraft("mem-key", "memory-only");
    expect(readDraft("mem-key")).toBe("memory-only");

    setSpy.mockRestore();
    getSpy.mockRestore();
  });

  it("clearDraft does not throw when localStorage.removeItem fails", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("Disabled");
    });
    expect(() => clearDraft("anything")).not.toThrow();
  });
});
