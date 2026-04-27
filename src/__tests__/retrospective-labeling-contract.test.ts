import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const RETRO_PATH = resolve(".", ".claude/shared/retrospective.md");

describe("retrospective labeling contract (#174)", () => {
  const content = readFileSync(RETRO_PATH, "utf8");

  it("contains the 'ALWAYS includes groomed' rule", () => {
    expect(content).toContain("ALWAYS includes `groomed`");
  });

  it("contains a Forbidden labels block with needs-grooming", () => {
    expect(content).toContain("FORBIDDEN");
    expect(content).toContain("`needs-grooming`");
    // Verify the forbidden rule explains WHY
    expect(content).toMatch(/FORBIDDEN.*needs-grooming/s);
  });

  it("contains the post-create label assertion snippet", () => {
    // Must have the gh issue view --json labels verification
    expect(content).toMatch(/gh issue view.*--json labels/);
    // Must check for groomed presence
    expect(content).toMatch(/HAS_GROOMED/);
    // Must check for needs-grooming absence
    expect(content).toMatch(/HAS_FORBIDDEN/);
  });

  it("contains the auto-correct backfill step", () => {
    // Must auto-add groomed and remove needs-grooming
    expect(content).toMatch(/--add-label.*groomed.*--remove-label.*needs-grooming/);
  });

  it("references issue #174 for traceability", () => {
    expect(content).toContain("#174");
  });
});
