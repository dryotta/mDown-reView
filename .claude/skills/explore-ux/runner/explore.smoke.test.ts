import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const SKIP = process.platform !== "win32" || process.env.EXPLORE_UX_SMOKE !== "1";

describe.skipIf(SKIP)("explore-ux smoke (Windows + EXPLORE_UX_SMOKE=1)", () => {
  it("runs 3 steps end-to-end in dry-run mode", () => {
    const result = spawnSync(
      "npx",
      ["tsx", ".claude/skills/explore-ux/runner/explore.ts",
       "--steps", "3", "--no-vision"],
      { encoding: "utf8", shell: true, timeout: 120_000 },
    );
    expect(result.status).toBe(0);
    const runs = ".claude/explore-ux/runs";
    expect(existsSync(runs)).toBe(true);
    const latest = readdirSync(runs).sort().pop()!;
    const dir = join(runs, latest);
    expect(existsSync(join(dir, "report.md"))).toBe(true);
    expect(existsSync(join(dir, "evidence.jsonl"))).toBe(true);
    expect(readdirSync(join(dir, "screenshots")).length).toBeGreaterThan(0);
    const known = JSON.parse(readFileSync(".claude/explore-ux/known-findings.json", "utf8"));
    const someFinding = Object.values(known.findings as Record<string, { issue: number | null }>)[0];
    expect(someFinding?.issue ?? null).toBe(null);
  });
});
