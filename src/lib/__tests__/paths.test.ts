import { describe, it, expect } from "vitest";
import { stripVerbatimPrefix } from "@/lib/paths";

describe("stripVerbatimPrefix", () => {
  it("strips `\\\\?\\` disk-form verbatim prefix", () => {
    expect(stripVerbatimPrefix("\\\\?\\C:\\proj\\a.md")).toBe("C:\\proj\\a.md");
  });

  it("strips `\\\\?\\UNC\\` UNC verbatim prefix back to `\\\\srv\\share`", () => {
    expect(stripVerbatimPrefix("\\\\?\\UNC\\srv\\share\\a.md")).toBe(
      "\\\\srv\\share\\a.md",
    );
  });

  it("returns posix paths unchanged", () => {
    expect(stripVerbatimPrefix("/home/user/a.md")).toBe("/home/user/a.md");
  });

  it("returns bare-form Windows paths unchanged", () => {
    expect(stripVerbatimPrefix("C:\\proj\\a.md")).toBe("C:\\proj\\a.md");
  });

  it("round-trips null and undefined", () => {
    expect(stripVerbatimPrefix(null)).toBe(null);
    expect(stripVerbatimPrefix(undefined)).toBe(undefined);
  });

  it("UNC strip happens before disk-form to avoid half-stripping", () => {
    // If we ran the disk-form strip first the result would be the corrupt
    // `UNC\srv\share\a.md`. The helper must never produce that.
    const out = stripVerbatimPrefix("\\\\?\\UNC\\srv\\share\\a.md");
    expect(out.startsWith("UNC\\")).toBe(false);
  });
});
