import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Issue #122 — contract test for the iterate-one-issue skill's DIFF_CLASS
 * scoping in Step 6b/6c/7. PR #158 implemented the scoping (validator and
 * expert panel both branch on DIFF_CLASS); this test locks the contract in
 * so a future skill rewrite can't silently regress to the rigid full-suite
 * shape that motivated the issue (~5 min wall + ~9 expert agents burned on
 * a 30-line markdown change in PR #120).
 */

const SKILL_PATH = resolve(
  __dirname,
  "../../.claude/skills/iterate-one-issue/SKILL.md",
);
const SKILL = readFileSync(SKILL_PATH, "utf8");

const HALT_PATH = resolve(
  __dirname,
  "../../.claude/skills/iterate-one-issue/references/halt-semantics.md",
);
const HALT = readFileSync(HALT_PATH, "utf8");

const DONE_HANDLERS_PATH = resolve(
  __dirname,
  "../../.claude/skills/iterate-one-issue/references/done-handlers.md",
);
const DONE_HANDLERS = readFileSync(DONE_HANDLERS_PATH, "utf8");

describe("iterate-one-issue skill — DIFF_CLASS scoping (issue #122)", () => {
  it("Step 6b classifies the diff into code | prompt-only | docs-only | none", () => {
    expect(SKILL).toMatch(/####\s+6b\.?\s+Classify diff/i);
    expect(SKILL).toMatch(/DIFF_CLASS=code/);
    expect(SKILL).toMatch(/DIFF_CLASS=prompt-only/);
    expect(SKILL).toMatch(/DIFF_CLASS=docs-only/);
    expect(SKILL).toMatch(/DIFF_CLASS=none/);
  });

  it("validator suite (6c-A) is scoped per DIFF_CLASS — docs-only must skip entirely", () => {
    expect(SKILL).toMatch(/`docs-only`\s*\|\s*Skip entirely/);
    expect(SKILL).toMatch(/`prompt-only`\s*\|\s*`?\d+\)\s*npm run lint:skills`?\s*only/);
  });

  it("validator full-suite gate is gated to DIFF_CLASS=code only", () => {
    // Find the validator table and confirm the heavy-suite row sits under `code`.
    const codeRow = SKILL.match(/`code`\s*\|\s*Full suite[^\n]*npm run lint[^\n]*tsc[^\n]*cargo test[^\n]*npm test/);
    expect(codeRow, "validator table missing 'code → Full suite' row").not.toBeNull();
  });

  it("expert panel (Step 7) is scoped per DIFF_CLASS and skips irrelevant experts on prompt/docs diffs", () => {
    // prompt-only must NOT pull react-tauri / performance / bug / security / test experts.
    const promptOnlyRow = SKILL.match(
      /`prompt-only`\s*\|[^\n]*Skip the rest[^\n]*react-tauri-expert[^\n]*performance-expert[^\n]*bug-expert[^\n]*security-expert[^\n]*test-expert/,
    );
    expect(promptOnlyRow, "Step 7 table must explicitly skip the irrelevant experts on prompt-only diffs").not.toBeNull();
    // docs-only must reduce to documentation-expert only.
    expect(SKILL).toMatch(/`docs-only`\s*\|\s*`documentation-expert` only/);
    // none must skip the panel entirely.
    expect(SKILL).toMatch(/`none`\s*\|\s*Skip Step 7 entirely/);
  });

  it("CI poller comment notes path-filtered checks skip fast on docs/prompt diffs", () => {
    expect(SKILL.toLowerCase()).toContain("path-filtered");
    expect(SKILL).toMatch(/prompt-only[`'/\\\s]+docs-only[\s\S]{0,80}skip[s]?\s+green/);
  });
});

describe("iterate-one-issue skill — 0d closed deferral categories (issue #147)", () => {
  it("Step 0d defines exactly three closed deferral categories", () => {
    expect(SKILL).toMatch(/Internal contradictions/);
    expect(SKILL).toMatch(/Undefined success signal/);
    expect(SKILL).toMatch(/Unresolvable external dependency/);
  });

  it("Step 0d explicitly forbids scope-size deferral as an anti-pattern", () => {
    expect(SKILL).toMatch(
      /[Ss]cope.size[\s\S]*?never[\s\S]*?deferral reason/,
    );
  });

  it("Step 0d deferral comment template requires citing a category", () => {
    expect(SKILL).toMatch(
      /Deferral category.*internal-contradiction.*undefined-success-signal.*unresolvable-external-dependency/s,
    );
  });

  it("halt-semantics.md lists scope size in 'No longer halts'", () => {
    expect(HALT).toMatch(/No longer halts/);
    expect(HALT).toMatch(/[Ll]arge scope|many ACs|many files/);
  });

  it("halt-semantics.md pre-loop halt cites the three closed categories", () => {
    expect(HALT).toMatch(
      /internal contradictions.*undefined success signal.*unresolvable external dependency/is,
    );
  });
});

describe("iterate-one-issue skill — phased planning in Step 4", () => {
  it("Step 4 planner prompt includes phased planning guidance", () => {
    expect(SKILL).toMatch(/Phased planning/);
    expect(SKILL).toMatch(/iteration-sized phase/);
  });

  it("Step 4 planner prompt does not say 'do not artificially narrow scope'", () => {
    // Old wording conflicted with phased planning; replaced with convergent-phase language
    expect(SKILL).not.toMatch(/do not artificially narrow scope/i);
  });
});

describe("iterate-one-issue skill — bug-mode behavioural verification (issue #192)", () => {
  it("Done-Achieved handler includes bug-mode behavioural verification step", () => {
    expect(DONE_HANDLERS).toMatch(/[Bb]ug.mode behavioural verification/);
  });

  it("verification requires observation-level evidence, not implementation-level", () => {
    expect(DONE_HANDLERS).toMatch(/observation level/);
    expect(DONE_HANDLERS).toMatch(/not the implementation level/);
  });

  it("verification template includes structured fields", () => {
    expect(DONE_HANDLERS).toMatch(/LAYER:/);
    expect(DONE_HANDLERS).toMatch(/REPRO_COMMAND:/);
    expect(DONE_HANDLERS).toMatch(/OBSERVATION:/);
    expect(DONE_HANDLERS).toMatch(/VERDICT:.*CONFIRMED_FIXED.*STILL_BROKEN.*UNABLE_TO_VERIFY/s);
  });

  it("STILL_BROKEN verdict reverts to in_progress, not ready-for-review", () => {
    expect(DONE_HANDLERS).toMatch(/STILL_BROKEN.*revert to.*in_progress/is);
  });

  it("verification runs before PR is marked ready-for-review", () => {
    // Bug verification (step 1) must appear before gh pr ready (step 3)
    const verifyIdx = DONE_HANDLERS.indexOf("Bug-mode behavioural verification");
    const readyIdx = DONE_HANDLERS.indexOf("gh pr ready");
    expect(verifyIdx).toBeGreaterThan(-1);
    expect(readyIdx).toBeGreaterThan(-1);
    expect(verifyIdx).toBeLessThan(readyIdx);
  });
});
