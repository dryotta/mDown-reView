import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Meta-test: the numbered rules list under each canonical doc's "## Rules"
 * section must be strictly monotonically increasing 1, 2, 3, ... with no
 * duplicates and no gaps. Subsection headers (### ...) and blank lines are
 * allowed between items but do not reset the count.
 *
 * This catches regressions like the iter-1 BLOCK where performance.md had
 * "19, 20, 19, 20" because two new rules were inserted without renumbering
 * the rules below.
 */

const REPO_ROOT = resolve(__dirname, "..", "..");

function extractRulesSection(content: string): string {
  const lines = content.split("\n");
  const start = lines.findIndex((l) => l.trim() === "## Rules");
  if (start === -1) throw new Error("no '## Rules' section found");
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

function extractRuleNumbers(section: string): number[] {
  const numbers: number[] = [];
  for (const line of section.split("\n")) {
    const m = /^(\d+)\.\s+/.exec(line);
    if (m) numbers.push(parseInt(m[1], 10));
  }
  return numbers;
}

const DOCS = ["performance.md", "architecture.md", "security.md"];

describe.each(DOCS)("docs/%s rules numbering", (docName) => {
  const path = join(REPO_ROOT, "docs", docName);
  const content = readFileSync(path, "utf8");
  const section = extractRulesSection(content);
  const numbers = extractRuleNumbers(section);

  it("contains a non-trivial numbered rules list", () => {
    expect(numbers.length).toBeGreaterThanOrEqual(3);
  });

  it("starts at 1", () => {
    expect(numbers[0]).toBe(1);
  });

  it("is strictly increasing by 1 with no duplicates or gaps", () => {
    const expected = numbers.map((_, i) => i + 1);
    expect(numbers).toEqual(expected);
  });
});
