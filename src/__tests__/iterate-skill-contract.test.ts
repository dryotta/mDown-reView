import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

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

const EXE_TASK_IMPLEMENTER_PATH = resolve(
  __dirname,
  "../../.claude/agents/exe-task-implementer.md",
);
const EXE_TASK_IMPLEMENTER = readFileSync(EXE_TASK_IMPLEMENTER_PATH, "utf8");

const LEAN_EXPERT_PATH = resolve(
  __dirname,
  "../../.claude/agents/lean-expert.md",
);
const LEAN_EXPERT = readFileSync(LEAN_EXPERT_PATH, "utf8");

const TEST_EXPERT_PATH = resolve(
  __dirname,
  "../../.claude/agents/test-expert.md",
);
const TEST_EXPERT = readFileSync(TEST_EXPERT_PATH, "utf8");
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

describe("iterate-one-issue skill — scope guard against workspace-wide formatters (issue #302)", () => {
  // Issue #302 — implementer runs of `cargo fmt` (workspace-wide) created 44 files
  // of out-of-scope churn twice in a single iteration. The fix is two-pronged:
  //   1. The implementer agent prompt forbids `cargo fmt` / `cargo fmt --all` /
  //      `cargo fmt -p` outright.
  //   2. The iterate-one-issue skill's Step 6 has a pre-commit scope-diff guard
  //      that compares `git diff --name-only` against the implementer-reported
  //      file set and reverts/blocks unexpected files BEFORE `git commit`.
  //      The same guard is applied in the forward-fix path (6d).
  // These tests lock the contract so the prompt cannot silently regress.

  it("implementer agent prompt contains the literal `Do NOT run cargo fmt` rule", () => {
    expect(EXE_TASK_IMPLEMENTER).toMatch(/Do NOT run\s+`?cargo fmt`?/);
  });

  it("implementer agent prompt names all three forbidden invocations", () => {
    expect(EXE_TASK_IMPLEMENTER).toMatch(/cargo fmt --all/);
    expect(EXE_TASK_IMPLEMENTER).toMatch(/cargo fmt -p/);
  });

  it("implementer agent prompt instructs to report rather than run the formatter", () => {
    // The rule must explicitly tell the implementer what to do INSTEAD of running fmt.
    expect(EXE_TASK_IMPLEMENTER).toMatch(/report\b[\s\S]{0,160}\bformat/i);
  });

  it("Step 6 contains a `git diff --name-only` based scope-diff guard", () => {
    expect(SKILL).toMatch(/####\s+6a\.?\s+Push/);
    expect(SKILL).toMatch(/git diff --name-only/);
    expect(SKILL).toMatch(/scope.diff guard/i);
  });

  it("Step 6 scope-diff guard appears BEFORE the `git commit` line in 6a", () => {
    // The whole point: revert/block unexpected files BEFORE the commit, not after.
    const sixA = SKILL.indexOf("#### 6a. Push");
    expect(sixA, "Step 6a not found").toBeGreaterThan(-1);
    const sixB = SKILL.indexOf("#### 6b.");
    expect(sixB, "Step 6b not found").toBeGreaterThan(sixA);

    const sixABlock = SKILL.slice(sixA, sixB);
    const guardIdx = sixABlock.search(/git diff --name-only/);
    const commitIdx = sixABlock.indexOf("git commit");
    expect(guardIdx, "scope-diff guard missing in Step 6a block").toBeGreaterThan(-1);
    expect(commitIdx, "git commit reference missing in Step 6a block").toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(commitIdx);
  });

  it("Step 6 scope-diff guard reverts whitespace-only `.rs` churn (the issue #302 failure mode)", () => {
    // The guard's revert branch must be triggered by a `git diff -w` whitespace-only check.
    expect(SKILL).toMatch(/git diff -w/);
    expect(SKILL).toMatch(/git checkout HEAD --/);
    expect(SKILL).toMatch(/whitespace.only|format.only/i);
  });

  it("forward-fix path (6d) re-applies the same scope-diff guard before its own commit", () => {
    const sixD = SKILL.indexOf("#### 6d.");
    expect(sixD, "Step 6d not found").toBeGreaterThan(-1);
    const stepSeven = SKILL.indexOf("### Step 7");
    expect(stepSeven, "Step 7 header not found").toBeGreaterThan(sixD);

    const sixDBlock = SKILL.slice(sixD, stepSeven);
    // Must reference the 6a-pre guard (or restate it) before its own commit.
    expect(sixDBlock).toMatch(/scope.diff guard|6a.pre/i);
    const guardRefIdx = sixDBlock.search(/scope.diff guard|6a.pre/i);
    const commitIdx = sixDBlock.indexOf("git commit");
    expect(guardRefIdx, "scope-diff guard reference missing in Step 6d block").toBeGreaterThan(-1);
    expect(commitIdx, "git commit missing in Step 6d block").toBeGreaterThan(-1);
    expect(guardRefIdx).toBeLessThan(commitIdx);
  });

  it("Step 6d explicitly carves out scope-guard BLOCKs from the no-revert forward-fix rule", () => {
    // Without this carve-out, the forward-fix prompt's "no revert" rule conflicts with
    // the scope-guard's correct recovery path (revert the off-scope file). The loop would
    // thrash to the 5-attempt cap or pressure the implementer to wrongly absorb the file.
    const sixD = SKILL.indexOf("#### 6d.");
    const stepSeven = SKILL.indexOf("### Step 7");
    const sixDBlock = SKILL.slice(sixD, stepSeven);
    // Must mention scope-guard explicitly inside 6d.
    expect(sixDBlock).toMatch(/[Ss]cope.guard/);
    // Must allow revert (justify-or-revert semantics) for scope-guard BLOCKs specifically.
    expect(sixDBlock).toMatch(/justify.or.revert|revert[\s\S]{0,160}justify|`?git checkout HEAD --/);
  });

  it("Step 6d preserves original Step 5 EXPECTED_FILES as in-scope during forward-fix", () => {
    // Locks the EXPECTED_FILES composition. Without this clause, every forward-fix wave
    // would re-flag every Step-5 file as "unexpected" the moment the forward-fix touched
    // a different file inside the original scope.
    const sixD = SKILL.indexOf("#### 6d.");
    const stepSeven = SKILL.indexOf("### Step 7");
    const sixDBlock = SKILL.slice(sixD, stepSeven);
    expect(sixDBlock).toMatch(/[Oo]riginal Step 5[\s\S]{0,160}in.scope|still counts as in.scope/);
  });

  it("Step 8 iteration template captures scope-guard activity for cross-iteration retros", () => {
    // Without this, a misbehaving implementer's formatter abuse is silently wiped each
    // iteration — the retro author can't see a recurring pattern it has no log of.
    const stepEight = SKILL.indexOf("### Step 8 — Record");
    expect(stepEight, "Step 8 header not found").toBeGreaterThan(-1);
    const stepEightFive = SKILL.indexOf("### Step 8.5", stepEight);
    expect(stepEightFive, "Step 8.5 header not found").toBeGreaterThan(stepEight);
    const stepEightBlock = SKILL.slice(stepEight, stepEightFive);
    expect(stepEightBlock).toMatch(/Scope-guard:/);
  });

  it("scope-guard log lines are appended to the state file (cross-iteration retro visibility)", () => {
    // Both branches of 6a-pre (revert + block) must tee their log lines into the
    // state file so retros can spot patterns. Otherwise the in-stdout log evaporates.
    const sixA = SKILL.indexOf("#### 6a. Push");
    const sixB = SKILL.indexOf("#### 6b.");
    const sixABlock = SKILL.slice(sixA, sixB);
    expect(sixABlock).toMatch(/append[\s\S]{0,80}state file/i);
  });

  it("neither skill nor implementer prompt instructs running a workspace-wide Rust formatter", () => {
    // Belt-and-braces negative assertion. Covers the imperative phrasings most likely
    // to appear in a regression: Run/Execute/Apply/Use/Invoke/Call/Trigger/Perform/Format.
    const positiveRunPattern =
      /(?:^|\n)\s*[-*\d.)\s]{0,4}(?:Run|Execute|Apply|Use|Invoke|Call|Trigger|Perform|Format with)\s+`?cargo fmt[^`\n]*`?/i;
    expect(EXE_TASK_IMPLEMENTER).not.toMatch(positiveRunPattern);
    expect(SKILL).not.toMatch(positiveRunPattern);
  });
});

describe("iterate-one-issue skill — consume implementer scope non-action reports (issue #309)", () => {
  // Issue #309 — implementer agents are instructed at `.claude/agents/exe-task-implementer.md`
  // to fill in `**Did NOT do (scope):** ...` whenever they cannot do all the work in the task,
  // but the iterate skill had no consumer for those reports. The fix:
  //   1. `6a-noaction. Scope non-action capture` parses every implementer summary's
  //      `Did NOT do (scope)` block (with explicit start/end markers and malformed-summary
  //      rules) and appends non-empty entries to the BRANCH-LEVEL `## Open scope non-actions`
  //      section of the state file (not per-iteration), so pending entries survive across
  //      DEGRADED iterations until explicitly dispositioned.
  //   2. `8-pre. Scope non-action disposition gate` requires every entry in the Open list to
  //      have a non-pending disposition (one of `accepted`, `handled-in-forward-fix`,
  //      `follow-up-issue:<N>`) BEFORE the iteration can record PASSED. Pending entries
  //      force DEGRADED. Resolved entries move to `## Resolved scope non-actions` for audit.
  //   3. **Termination preconditions** in `references/done-handlers.md` run the same gate
  //      before ANY Done-X exit so the Step 2 → Done-Achieved shortcut cannot bypass 8-pre.
  //   4. 6d step 3 explicitly re-runs 6a-noaction against forward-fix Implementation Summaries.
  //   5. Step 8.5 retro context block + the PR comment include scope non-action data so
  //      Phase 2 synthesis can consume it as cross-run pattern signal.
  //   6. State file frontmatter carries `state_schema_version: 1` for forward compatibility.

  it("Step 6 has a 6a-noaction sub-step that parses Did NOT do (scope) from implementer summaries", () => {
    expect(SKILL).toMatch(/#####\s+6a-noaction/);
    // Must reference the literal field name from exe-task-implementer.md so a renamed/removed
    // field is caught loudly.
    expect(SKILL).toMatch(/\*\*Did NOT do \(scope\)/);
    expect(SKILL).toMatch(/scope_non_actions/);
    expect(SKILL).toMatch(/implementer_attempt_id/);
  });

  it("6a-noaction defines explicit parse boundaries (start marker, end marker, malformed)", () => {
    // duck-309 BLOCK 2: vague "scan the line and any bullet block" was insufficient.
    const sixANoaction = SKILL.indexOf("##### 6a-noaction");
    const sixAPre = SKILL.indexOf("##### 6a-pre");
    expect(sixANoaction).toBeGreaterThan(-1);
    expect(sixAPre).toBeGreaterThan(sixANoaction);
    const block = SKILL.slice(sixANoaction, sixAPre);
    expect(block).toMatch(/[Ss]tart marker/);
    expect(block).toMatch(/[Ee]nd marker/);
    expect(block).toMatch(/[Mm]alformed/);
    expect(block).toMatch(/[Mm]ultiple sections/);
  });

  it("6a-noaction is re-run on BOTH Step 5 AND 6d (forward-fix) implementer waves", () => {
    // duck-309 BLOCK 1: 6d previously only re-applied 6a-pre, not 6a-noaction. Without this
    // fix, deferrals introduced during forward-fix bypass scope_non_actions[] entirely.
    const sixANoaction = SKILL.indexOf("##### 6a-noaction");
    const sixAPre = SKILL.indexOf("##### 6a-pre");
    const block = SKILL.slice(sixANoaction, sixAPre);
    expect(block).toMatch(/Step 5/);
    expect(block).toMatch(/6d forward-fix/);

    // The 6d block itself MUST also explicitly say "re-run 6a-noaction" (not just 6a-pre).
    const sixD = SKILL.indexOf("#### 6d.");
    const stepSeven = SKILL.indexOf("### Step 7");
    const sixDBlock = SKILL.slice(sixD, stepSeven);
    expect(sixDBlock).toMatch(/6a-noaction/);
    expect(sixDBlock).toMatch(/iter-<N>-6d-attempt/);
  });

  it("scope non-actions live at the BRANCH level (Open + Resolved), not per-iteration", () => {
    // duck-309 BLOCK 3 + arch-309 BLOCK 2: per-iteration capture would orphan pending entries
    // across DEGRADED iterations. Branch-level Open + Resolved sections survive carry-over.
    expect(SKILL).toMatch(/##\s+Open scope non-actions/);
    expect(SKILL).toMatch(/##\s+Resolved scope non-actions/);
    // The 8-pre workflow must read from the Open section across iterations.
    const eightPre = SKILL.indexOf("#### 8-pre");
    const eightRecord = SKILL.indexOf("#### 8-record", eightPre);
    const eightPreBlock = SKILL.slice(eightPre, eightRecord);
    expect(eightPreBlock).toMatch(/branch-level/i);
    expect(eightPreBlock).toMatch(/prior[\s\S]{0,40}iterations|across iterations/i);
  });

  it("8-pre disposition gate enumerates exactly three allowed values (no `rejected`)", () => {
    expect(SKILL).toMatch(/####\s+8-pre/);
    // The three allowed disposition values must appear verbatim:
    expect(SKILL).toMatch(/`accepted`/);
    expect(SKILL).toMatch(/`handled-in-forward-fix`/);
    expect(SKILL).toMatch(/`follow-up-issue:<N>`|follow-up-issue:<\w+>/);
    // `rejected` was dropped per lean-309 — folded into `accepted` with rationale.
    const eightPre = SKILL.indexOf("#### 8-pre");
    const eightRecord = SKILL.indexOf("#### 8-record", eightPre);
    const eightPreBlock = SKILL.slice(eightPre, eightRecord);
    expect(eightPreBlock).not.toMatch(/`rejected`/);
  });

  it("8-pre gate appears BEFORE the Step 8 record body (cannot record PASSED with pending dispositions)", () => {
    const stepEight = SKILL.indexOf("### Step 8 — Record");
    expect(stepEight).toBeGreaterThan(-1);
    const stepEightFive = SKILL.indexOf("### Step 8.5", stepEight);
    expect(stepEightFive).toBeGreaterThan(stepEight);
    const stepEightBlock = SKILL.slice(stepEight, stepEightFive);
    const eightPreIdx = stepEightBlock.indexOf("8-pre");
    const recordIdx = stepEightBlock.indexOf("8-record");
    expect(eightPreIdx, "8-pre disposition gate missing in Step 8").toBeGreaterThan(-1);
    expect(recordIdx, "8-record sub-step missing in Step 8").toBeGreaterThan(-1);
    expect(eightPreIdx).toBeLessThan(recordIdx);
  });

  it("8-pre causally links pending → block PASSED → DEGRADED (not just co-occurrence)", () => {
    // Without the causal link, a future edit could leave the words but break the gate.
    const eightPre = SKILL.indexOf("#### 8-pre");
    const eightRecord = SKILL.indexOf("#### 8-record", eightPre);
    const block = SKILL.slice(eightPre, eightRecord);
    // Must say "remains pending → cannot record PASSED → DEGRADED" in close proximity.
    expect(block).toMatch(/[Bb]lock PASSED/);
    expect(block).toMatch(/pending[\s\S]{0,200}DEGRADED|DEGRADED[\s\S]{0,200}pending/);
  });

  it("Termination preconditions (done-handlers.md) drain Open scope non-actions before any Done-X", () => {
    // arch-309 BLOCK 1: Step 2 → Done-Achieved skips 3-8.5 (including 8-pre). The
    // termination-precondition gate is the single chokepoint that catches pending entries
    // before any terminal exit (Done-Achieved, Done-Blocked, Done-TimedOut).
    expect(DONE_HANDLERS).toMatch(/Termination preconditions/);
    expect(DONE_HANDLERS).toMatch(/Open scope non-actions/);
    expect(DONE_HANDLERS).toMatch(/issue #309/);
    // Must explicitly mention the Step 2 → Done-Achieved bypass and its mitigation.
    expect(DONE_HANDLERS).toMatch(/Done-Achieved[\s\S]{0,400}Done-Blocked|forced to.*Done-Blocked/);
    // Termination gate must appear BEFORE the existing "Handler steps (in order)" list.
    const termIdx = DONE_HANDLERS.indexOf("Termination preconditions");
    const handlerStepsIdx = DONE_HANDLERS.indexOf("Handler steps (in order):");
    expect(termIdx).toBeGreaterThan(-1);
    expect(handlerStepsIdx).toBeGreaterThan(termIdx);
  });

  it("Step 8 iteration template contains Scope-non-actions field for durable visibility", () => {
    const stepEight = SKILL.indexOf("### Step 8 — Record");
    const stepEightFive = SKILL.indexOf("### Step 8.5", stepEight);
    const stepEightBlock = SKILL.slice(stepEight, stepEightFive);
    expect(stepEightBlock).toMatch(/Scope-non-actions:/);
    expect(stepEightBlock).toMatch(/Scope-non-actions:[\s\S]{0,200}disposition/i);
  });

  it("Step 8.5 retro context block includes scope non-actions for Phase 2 consumption", () => {
    // arch-309 BLOCK 3: without this, scope non-action signal evaporates before reaching
    // cross-run pattern detection in Phase 2's improvement-spec synthesis.
    const stepEightFive = SKILL.indexOf("### Step 8.5");
    expect(stepEightFive).toBeGreaterThan(-1);
    const phaseR = SKILL.indexOf("## Phase R", stepEightFive);
    const phaseTwo = SKILL.indexOf("## Phase 2", stepEightFive);
    const block = SKILL.slice(stepEightFive, Math.min(
      phaseR > -1 ? phaseR : SKILL.length,
      phaseTwo > -1 ? phaseTwo : SKILL.length,
    ));
    expect(block).toMatch(/[Ss]cope non-actions/);
    expect(block).toMatch(/Open scope non-actions/);
  });

  it("state file frontmatter carries state_schema_version for forward compatibility", () => {
    // arch-309 medium: structured nested data is growing; version the schema now to avoid
    // silent parser breakage when more gates land.
    const zeroG = SKILL.indexOf("### 0g.");
    const zeroH = SKILL.indexOf("### 0h.");
    expect(zeroG).toBeGreaterThan(-1);
    expect(zeroH).toBeGreaterThan(zeroG);
    const block = SKILL.slice(zeroG, zeroH);
    // Bumped from 1 → 2 by issue #316 Wave 1 (added Env-flake retries field
    // to Step 8-record's iteration block). The schema-version field exists;
    // the value is part of the contract, so pin the current version explicitly.
    expect(block).toMatch(/state_schema_version:\s*2/);
  });

  it("worked example — synthetic 'rustfmt outside declared files' is locked into SKILL.md text", () => {
    // AC-5 of issue #309: regression test asserts a synthetic implementer summary containing
    // `Did NOT do (scope): rustfmt outside declared files` requires a visible disposition
    // before PASSED. The test-309 review noted the prior version's tautological assertions
    // (matching a JS literal against itself); the real lock is to assert the synthetic lives
    // in SKILL.md as the canonical worked example.
    const synthetic = "rustfmt outside declared files";
    expect(SKILL).toContain(synthetic);
    // The example must sit inside the 6a-noaction block so a future edit moving it elsewhere
    // would break this test (the canonical illustration belongs with the parser, not adrift).
    const sixANoaction = SKILL.indexOf("##### 6a-noaction");
    const sixAPre = SKILL.indexOf("##### 6a-pre");
    const block = SKILL.slice(sixANoaction, sixAPre);
    expect(block).toContain(synthetic);
    // The example must mention all three valid resolution paths (accepted /
    // handled-in-forward-fix / follow-up-issue:<N>) OR refer to the gate that does so.
    expect(block).toMatch(/disposition[\s\S]{0,80}(accepted|handled-in-forward-fix|follow-up-issue|gate at 8-pre)/i);
  });

  it("PR comment template surfaces non-action disposition counts", () => {
    const stepEight = SKILL.indexOf("### Step 8 — Record");
    const stepEightFive = SKILL.indexOf("### Step 8.5", stepEight);
    const stepEightBlock = SKILL.slice(stepEight, stepEightFive);
    expect(stepEightBlock).toMatch(/Scope non-actions/i);
  });

  it("ordering: 6a-noaction sits BEFORE 6a-pre (capture before scope-diff guard)", () => {
    // Belt-and-braces — only the ordering invariant is new; #302's full contract is locked
    // by the prior describe block. Without this ordering, capture would happen after the
    // guard reverts/blocks files, losing context for any non-actions correlated to those.
    const sixA = SKILL.indexOf("#### 6a. Push");
    const sixB = SKILL.indexOf("#### 6b.");
    const sixABlock = SKILL.slice(sixA, sixB);
    const noactionIdx = sixABlock.indexOf("6a-noaction");
    const preIdx = sixABlock.indexOf("6a-pre");
    expect(noactionIdx).toBeGreaterThan(-1);
    expect(preIdx).toBeGreaterThan(noactionIdx);
  });
});

/**
 * Issue #326 — Step 4 must extract literal AC strings, structured fields,
 * file paths, command names, headings, and regex patterns from explicit
 * acceptance criteria, and the Step 5 implementer prompt must copy that
 * section verbatim.
 *
 * Source retro evidence: Wave 1 of feature-issue-316 missed the literal
 * structured-field requirement `environmental_failure: true` in AC #3 even
 * though it was already explicit in the spec. The forward-fix promoted the
 * field to a contract-test assertion; this regression test does the same
 * for the Step 4 contract itself.
 */
describe("iterate-one-issue skill — Step 4 AC literal compliance extraction (issue #326)", () => {
  // Cache Step 4 + Step 5 sub-blocks once per describe.
  const stepFourIdx = SKILL.indexOf("### Step 4 — Plan");
  const stepFiveIdx = SKILL.indexOf("### Step 5 — Implement", stepFourIdx);
  const stepSixIdx = SKILL.indexOf("### Step 6 — Push", stepFiveIdx);
  const stepFourBlock = SKILL.slice(stepFourIdx, stepFiveIdx);
  const stepFiveBlock = SKILL.slice(stepFiveIdx, stepSixIdx);

  it("Step 4 planner prompt contains an `AC literal compliance` section", () => {
    expect(stepFourIdx).toBeGreaterThan(-1);
    expect(stepFiveIdx).toBeGreaterThan(stepFourIdx);
    expect(stepFourBlock).toMatch(/AC literal compliance/);
  });

  it("Step 4 instructs extraction for explicit AC checkboxes/bullets", () => {
    // The trigger condition: explicit AC bullets in the spec must turn the
    // section on. Vague spec → section may be skipped (the rule says so).
    expect(stepFourBlock).toMatch(/explicit acceptance.criteria/i);
    // The two checkbox shapes (` - [ ] ` and ` - [x] `) must both appear in
    // the rule body so the planner can recognise both checked and unchecked
    // bullets — backticks around the literals are allowed.
    expect(stepFourBlock).toMatch(/`?-\s*\[\s*\]`?\s*\/\s*`?-\s*\[x\]`?/);
  });

  it("Step 4 enumerates all six literal categories (mechanism check)", () => {
    // Mechanism assertions — guard against future rewrites that drop one
    // category and rely on the sentinel test alone.
    expect(stepFourBlock).toMatch(/LITERAL STRING/);
    expect(stepFourBlock).toMatch(/STRUCTURED FIELD/);
    expect(stepFourBlock).toMatch(/FILE PATH/);
    expect(stepFourBlock).toMatch(/COMMAND NAME/);
    expect(stepFourBlock).toMatch(/HEADING/);
    expect(stepFourBlock).toMatch(/REGEX/);
  });

  it("Step 4 cites a structured-field sentinel literal so an AC like `environmental_failure: true` cannot be silently summarised", () => {
    // Sentinel oracle — locks the canonical worked example from the
    // feature-issue-316 retro into the prompt, alongside the mechanism
    // assertions above. A future rewrite that omits structured-field
    // examples would break this test even if the mechanism checks still
    // pass with looser wording.
    expect(stepFourBlock).toMatch(/environmental_failure:\s*true/);
  });

  it("Step 4 forbids summarising the AC text in place of literal extraction", () => {
    expect(stepFourBlock).toMatch(/never summarise/i);
  });

  it("Step 5 implementer prompt copies the AC literal compliance section VERBATIM, not summarised", () => {
    expect(stepFiveBlock).toMatch(/AC literal compliance/);
    expect(stepFiveBlock).toMatch(/copy VERBATIM/);
    expect(stepFiveBlock).toMatch(/do not summarise/i);
  });

  it("Step 5 marks the AC literal compliance handoff as load-bearing (i.e. failure to embed = contract violation surfaced at Step 7)", () => {
    expect(stepFiveBlock).toMatch(/load-bearing/);
    expect(stepFiveBlock).toMatch(/Step 7/);
  });

  it("ordering: Step 4 emits the section BEFORE the per-group breakdown, and Step 5 forwards it INSIDE the group prompt", () => {
    // The section must appear before the "Save as PLAN" hand-off so the
    // planner cannot defer extraction to the implementer.
    const acIdx = stepFourBlock.indexOf("AC literal compliance");
    const saveIdx = stepFourBlock.indexOf("Save as `PLAN`");
    expect(acIdx).toBeGreaterThan(-1);
    expect(saveIdx).toBeGreaterThan(acIdx);
  });
});

/**
 * Issue #320 — reviewer code/assertion suggestions must cite the
 * struct/function/type definition that makes them type-valid, or be
 * labelled as pseudocode. The rule lives panel-wide (Step 7 prompt)
 * AND on the lean-expert agent (which is the always-included panel
 * member that produced the bad snippet in feature-issue-297).
 */
describe("iterate-one-issue + lean-expert — type-surface proof for reviewer code snippets (issue #320)", () => {
  const stepSevenIdx = SKILL.indexOf("### Step 7 — Expert diff review panel");
  const stepEightIdx = SKILL.indexOf("### Step 8 — Record", stepSevenIdx);
  const stepSevenBlock = SKILL.slice(stepSevenIdx, stepEightIdx);

  it("Step 7 panel-wide prompt requires type-surface proof for literal code/assertion suggestions", () => {
    expect(stepSevenIdx).toBeGreaterThan(-1);
    expect(stepSevenBlock).toMatch(/Type-surface proof/i);
    expect(stepSevenBlock).toMatch(/literal code or assertion suggestion/i);
    expect(stepSevenBlock).toMatch(/cite the struct\/function\/type definition/i);
  });

  it("Step 7 rule offers the pseudocode escape hatch", () => {
    expect(stepSevenBlock).toMatch(/labelled as `?pseudocode`?/i);
    expect(stepSevenBlock).toMatch(/needs verification/i);
  });

  it("Step 7 names this rule as panel-wide (applies to every reviewer in the panel)", () => {
    expect(stepSevenBlock).toMatch(/panel-wide/);
  });

  it("Step 7 makes a non-typecheckable snippet itself a BLOCK condition", () => {
    // Without this teeth, the rule degrades to advisory — the original retro
    // failure mode (lean-expert proposing `loaded.comments[0].responses[0].text`
    // against MrsfComment which has no `responses` field) would still slip.
    expect(stepSevenBlock).toMatch(/BLOCK/);
  });

  it("lean-expert.md Always-check section embeds the same type-surface proof rule", () => {
    expect(LEAN_EXPERT).toMatch(/\*\*Always check:\*\*/);
    expect(LEAN_EXPERT).toMatch(/Type-surface proof/i);
    expect(LEAN_EXPERT).toMatch(/literal code or assertion snippet/i);
    expect(LEAN_EXPERT).toMatch(/file:line/);
  });

  it("lean-expert.md Output template shows how to annotate a verified vs pseudocode snippet", () => {
    // The Output section must demonstrate the annotation so reviewers don't
    // have to re-invent the format every time.
    const outputIdx = LEAN_EXPERT.indexOf("**Output:**");
    expect(outputIdx).toBeGreaterThan(-1);
    const outputBlock = LEAN_EXPERT.slice(outputIdx);
    expect(outputBlock).toMatch(/verified against/i);
    expect(outputBlock).toMatch(/pseudocode/i);
  });

  it("lean-expert.md cites a worked-example struct/file:line reference (proves the format is concrete, not abstract)", () => {
    // The original retro identified MrsfComment's missing `responses` field —
    // pinning a concrete type-surface citation in the agent rule prevents
    // a future rewrite from silently dropping the file:line requirement.
    expect(LEAN_EXPERT).toMatch(/src-tauri\/src\/core\/types/);
  });
});

/**
 * New iterate-skill behaviour — Phase 1.5 inline-fix carry-over.
 *
 * When the just-written retro identifies a small product bug or test
 * fix (category ∈ {bug, test-strategy}, size ∈ {xs, s}, confidence ≥
 * medium, paths under src/src-tauri/e2e), iterate-one-issue extends
 * Phase 1 by one bounded iteration before invoking the Done-Achieved
 * handler — instead of filing a follow-up gh issue at Phase 2.
 *
 * The rubber-duck critique on the original Phase 2 mutation flagged
 * three killers: (a) Phase 2 runs after `gh pr ready` + `iterate-pr`
 * label, racing merge-pr-loop; (b) force-push recovery is destructive;
 * (c) bypassing Step 7 expert review weakens the acceptance bar. The
 * Phase 1.5 design fixes all three by interposing BEFORE the Done-
 * Achieved handler and reusing the full Phase 1 pipeline.
 */
describe("iterate-one-issue skill — Phase 1.5 inline-fix carry-over (Done-Achieved only, gated)", () => {
  const phase15Idx = SKILL.indexOf("## Phase 1.5 — Inline-fix carry-over");
  const phaseRIdx = SKILL.indexOf("## Phase R — Release-gate forward-fix");
  const phase15Block = SKILL.slice(phase15Idx, phaseRIdx);

  it("Phase 1.5 section exists and sits between Phase 1 and Phase R in the document", () => {
    const phase1Idx = SKILL.indexOf("## Phase 1 — Iteration loop");
    expect(phase1Idx).toBeGreaterThan(-1);
    expect(phase15Idx).toBeGreaterThan(phase1Idx);
    expect(phaseRIdx).toBeGreaterThan(phase15Idx);
  });

  it("Phase 1.5 declares the cap=1 invariant via INLINE_FIX_USED counter", () => {
    expect(phase15Block).toMatch(/INLINE_FIX_USED/);
    // The counter must be initialised in Phase 1's counter declaration.
    const phase1Block = SKILL.slice(
      SKILL.indexOf("## Phase 1 — Iteration loop"),
      phase15Idx,
    );
    expect(phase1Block).toMatch(/INLINE_FIX_USED\s*=\s*0/);
  });

  it("Phase 1.5 is gated to Done-Achieved only (skipped for blocked / Done-TimedOut / Done-ForwardFixed)", () => {
    expect(phase15Block).toMatch(/Done-Achieved only/i);
    expect(phase15Block).toMatch(/Skipped for every other terminal path/i);
    expect(phase15Block).toMatch(/blocked/);
    expect(phase15Block).toMatch(/Done-TimedOut/);
    expect(phase15Block).toMatch(/Done-ForwardFixed/);
  });

  it("Phase 1.5 eligibility gate enumerates ALL four required preconditions", () => {
    // (1) Step 2 = achieved, (2) cap not used, (3) retro candidate exists,
    // (4) light-synthesis emits an eligible candidate. All four must be
    // explicitly named — partial enumeration is a contract drift bug.
    expect(phase15Block).toMatch(/INLINE_FIX_USED == 0/);
    expect(phase15Block).toMatch(/Step 2 of iteration/);
    expect(phase15Block).toMatch(/RETRO_FILE/);
    expect(phase15Block).toMatch(/Light synthesis/);
  });

  it("Phase 1.5 eligibility category whitelist is exactly {bug, test-strategy}", () => {
    expect(phase15Block).toMatch(/exactly one of `bug`\s+OR\s+`test-strategy`/);
  });

  it("Phase 1.5 eligibility size whitelist is exactly {xs, s}", () => {
    expect(phase15Block).toMatch(/exactly one of `xs`\s+OR\s+`s`/);
  });

  it("Phase 1.5 eligibility confidence whitelist is exactly {medium, high}", () => {
    expect(phase15Block).toMatch(/exactly one of `medium`\s+OR\s+`high`/);
  });

  it("Phase 1.5 path whitelist is src/, src-tauri/, e2e/ ONLY (no .claude/, no docs/, no .github/)", () => {
    // The path filter is the single most important guard against accidental
    // skill / documentation / CI churn during inline-fix. Lock it.
    expect(phase15Block).toMatch(/`src\/`,?\s*`src-tauri\/`,?\s*(?:or\s+)?`e2e\/`/);
    expect(phase15Block).toMatch(/no `\.claude\/`/);
    expect(phase15Block).toMatch(/no `docs\/`/);
    expect(phase15Block).toMatch(/no `\.github\/`/);
  });

  it("Phase 1.5 light synthesis is distinct from Phase 2's R2b (current-run retros only, no cross-run)", () => {
    expect(phase15Block).toMatch(/single `general-purpose` call/);
    expect(phase15Block).toMatch(/NOT the cross-run R2b/);
  });

  it("Phase 1.5 light-synthesis output template enumerates the structured fields it must emit", () => {
    expect(phase15Block).toMatch(/INLINE_FIX_INELIGIBLE/);
    expect(phase15Block).toMatch(/INLINE_FIX_ELIGIBLE/);
    expect(phase15Block).toMatch(/^TITLE:/m);
    expect(phase15Block).toMatch(/^CATEGORY:/m);
    expect(phase15Block).toMatch(/^SIZE:/m);
    expect(phase15Block).toMatch(/^CONFIDENCE:/m);
    expect(phase15Block).toMatch(/^PATHS:/m);
    expect(phase15Block).toMatch(/^ACCEPTANCE_SIGNAL:/m);
    expect(phase15Block).toMatch(/^TASK_BRIEF:/m);
  });

  it("Phase 1.5 extends the loop by appending an AC to REQUIREMENTS (so Step 2 returns in_progress on next pass)", () => {
    expect(phase15Block).toMatch(/Append a new requirement to `REQUIREMENTS`/);
    expect(phase15Block).toMatch(/Phase 1\.5 inline-fix carry-over:/);
  });

  it("Phase 1.5 records the carry-over in the state file under `## Inline-fix carry-overs` with status=pending", () => {
    expect(phase15Block).toMatch(/## Inline-fix carry-overs/);
    expect(phase15Block).toMatch(/status:\s*pending/);
  });

  it("Phase 1.5 increments iteration (counts against the 30-cap, not bypasses it)", () => {
    expect(phase15Block).toMatch(/iteration \+= 1/);
    expect(phase15Block).toMatch(/30-cap/);
    expect(phase15Block).toMatch(/iteration\s*>\s*30/);
  });

  it("Phase 1.5 forwards the TASK_BRIEF into the follow-on iteration's Step 4 planner", () => {
    expect(phase15Block).toMatch(/TASK_BRIEF/);
    expect(phase15Block).toMatch(/Step 4/);
  });

  it("Phase 1.5 re-enters Phase 1 at Step 1 (reuses the full pipeline incl. validators + expert panel + forward-fix)", () => {
    expect(phase15Block).toMatch(/Re-enter Phase 1 at \*\*Step 1\*\*/);
    expect(phase15Block).toMatch(/expert panel/);
    expect(phase15Block).toMatch(/forward-fix loop/);
  });

  it("Phase 1.5 cap-of-1 is enforced on the SECOND pass (re-runs eligibility gate, sees INLINE_FIX_USED == 1, skips)", () => {
    expect(phase15Block).toMatch(/Phase 1\.5 re-runs its eligibility gate/);
    expect(phase15Block).toMatch(/INLINE_FIX_USED == 1/);
  });

  it("Phase 1.5 invariant: runs BEFORE Done-Achieved handler so PR stays draft (no race with merge-pr-loop)", () => {
    // The ordering invariant is the load-bearing safety property — the
    // rubber-duck critique on the original Phase 2 mutation called this
    // out as the killer issue. Lock both the prose statement AND the
    // structural ordering between Phase 1.5 and the Done-Achieved handler
    // routing in Step 2.
    expect(phase15Block).toMatch(/PR (?:is )?still draft/i);
    expect(phase15Block).toMatch(/no merge-loop interaction risk/i);
    // Step 2 routing must point to Phase 1.5 before Done-Achieved.
    const stepTwoRouting = SKILL.match(
      /`achieved`\s*→\s*\*\*\[Phase 1\.5\][^\n]*Done-Achieved handler/,
    );
    expect(stepTwoRouting, "Step 2 routing must route `achieved` through Phase 1.5 before Done-Achieved").not.toBeNull();
  });

  it("Termination table acknowledges Phase 1.5 interposing on the `achieved` path", () => {
    const terminationIdx = SKILL.indexOf("## Termination");
    const haltIdx = SKILL.indexOf("## Halt semantics", terminationIdx);
    const terminationBlock = SKILL.slice(terminationIdx, haltIdx);
    expect(terminationBlock).toMatch(/Step 2 `achieved`\s*\(after Phase 1\.5 gate\)/);
    expect(terminationBlock).toMatch(/Phase 1\.5 interposes between/);
  });

  it("Done-Achieved handler invariant note appears INSIDE Phase 1.5 (so a future Done-Achieved rewrite cannot drop the gate)", () => {
    expect(phase15Block).toMatch(/Done-Achieved handler invariant/i);
    expect(phase15Block).toMatch(/INVOKED ONLY AFTER Phase 1\.5 has either skipped/i);
  });

  it("Phase 1.5 invariant: Step 4 prompt template exposes the **Inline-fix task brief:** placeholder so the carry-over candidate's scope budget reaches the planner", () => {
    // Without this, Phase 1.5's step 6 ("Carry the parsed TASK_BRIEF into
    // Step 4") would be prose-only — the follow-on planner could ignore
    // the inline-fix scope budget entirely. The Step 4 prompt template
    // must contain the conditional so an autonomous run knows to inject
    // it when INLINE_FIX_USED == 1.
    const stepFourIdx = SKILL.indexOf("### Step 4 — Plan");
    const stepFiveIdx = SKILL.indexOf("### Step 5 — Implement", stepFourIdx);
    const stepFourBlock = SKILL.slice(stepFourIdx, stepFiveIdx);
    expect(stepFourBlock).toMatch(/INLINE_FIX_USED == 1/);
    expect(stepFourBlock).toMatch(/\*\*Inline-fix task brief:\*\*/);
    expect(stepFourBlock).toMatch(/TASK_BRIEF/);
  });

  it("Phase 1.5 has a single chokepoint that writes status=landed/dropped on terminal exit (no orphaned pending entries)", () => {
    expect(phase15Block).toMatch(/State-file status flip on second-pass termination/i);
    expect(phase15Block).toMatch(/status:\s*landed/);
    expect(phase15Block).toMatch(/status:\s*dropped/);
    // All three terminal paths (achieved-again, blocked, timed-out / 30-cap) must be enumerated.
    expect(phase15Block).toMatch(/terminates `achieved` AGAIN/);
    expect(phase15Block).toMatch(/terminates `blocked`/);
    expect(phase15Block).toMatch(/iteration > 30/);
    expect(phase15Block).toMatch(/never leave `status: pending`/);
  });

  it("Phase 1.5 ordering invariant: appears in SKILL.md BEFORE Phase R AND BEFORE the Done-Achieved handler reference (no race with merge-pr-loop)", () => {
    // Structural lock — replaces the earlier occurrence-count oracle.
    // A future PR that reintroduces a racy post-`gh pr ready` mutation
    // would either (a) move Phase 1.5 after Phase R / done-handlers, or
    // (b) add inline-fix branch-mutation prose to done-handlers.md. Both
    // are caught here.
    const phase1Idx = SKILL.indexOf("## Phase 1 — Iteration loop");
    expect(phase1Idx).toBeGreaterThan(-1);
    expect(phase15Idx).toBeGreaterThan(phase1Idx);
    expect(phaseRIdx).toBeGreaterThan(phase15Idx);
  });

  it("Phase 1.5 invariant: done-handlers.md does NOT carry inline-fix branch-mutation instructions (chokepoint stays in SKILL.md)", () => {
    // If a future PR re-introduces post-ready branch mutation, it would
    // most likely land in done-handlers.md (since that's where the PR
    // ready / iterate-pr label add lives). Lock that surface so it
    // cannot reference the inline-fix counter or feature-name itself.
    // (done-handlers.md legitimately mentions exe-task-implementer in
    // Phase R / release-gate forward-fix — we only block inline-fix
    // co-occurrence.)
    expect(DONE_HANDLERS).not.toMatch(/INLINE_FIX_USED/);
    expect(DONE_HANDLERS).not.toMatch(/inline-fix/i);
    expect(DONE_HANDLERS).not.toMatch(/Phase 1\.5/);
  });
});

/**
 * Issue #331 — test-expert pre-consult must enumerate bypass vectors when
 * reviewing source-byte regression guards (e.g. `include_str!`-based
 * `contains` assertions). The original lapse was on PR #323 (Rule-26
 * log-rotation guard), where rubber-duck caught three bypass vectors that
 * test-expert's pre-consult had not red-teamed — costing one forward-fix
 * iteration. Locking the agent prompt here parallelises that check.
 */
describe("test-expert agent — bypass-vector enumeration for source-byte regression guards (issue #331)", () => {
  it("test-expert.md Always-check section embeds the bypass-vector enumeration rule with a trigger pattern", () => {
    const alwaysCheckIdx = TEST_EXPERT.indexOf("**Always check:**");
    const outOfScopeIdx = TEST_EXPERT.indexOf("**Out of scope", alwaysCheckIdx);
    expect(alwaysCheckIdx).toBeGreaterThan(-1);
    expect(outOfScopeIdx).toBeGreaterThan(alwaysCheckIdx);
    const alwaysBlock = TEST_EXPERT.slice(alwaysCheckIdx, outOfScopeIdx);

    // Rule must be present and self-identify as the issue #331 follow-on.
    expect(alwaysBlock).toMatch(/Bypass-vector enumeration/i);
    expect(alwaysBlock).toMatch(/issue #331/);

    // Trigger pattern must enumerate BOTH halves: include_str! AND a contains/needles loop.
    expect(alwaysBlock).toMatch(/include_str!/);
    expect(alwaysBlock).toMatch(/contains/);
    expect(alwaysBlock).toMatch(/forbidden|needles|bypass|bad_patterns/);

    // Quantitative requirement: ≥3 vectors, each with explicit catches-it verdict.
    expect(alwaysBlock).toMatch(/at least 3 bypass vectors/);
    expect(alwaysBlock).toMatch(/state explicitly whether/);
    // Each uncaught vector must propose either (a) needle/check or (b) out-of-scope rationale.
    expect(alwaysBlock).toMatch(/needle/);
    expect(alwaysBlock).toMatch(/out-of-scope rationale/);
  });

  it("test-expert.md cites the PR #323 worked example with all three bypass-vector categories", () => {
    // The worked example is the prompt's concrete anchor — without it, "bypass
    // vector" stays abstract. The PR #323 case spans three vector categories
    // (constant-interpolation, non-year literal, concat reconstruction) — all
    // three must be named so a future test-expert call has the templates.
    expect(TEST_EXPERT).toMatch(/PR #323/);

    // Vector 1 — constant-interpolation bypass.
    expect(TEST_EXPERT).toMatch(/Constant-interpolation/i);
    expect(TEST_EXPERT).toMatch(/format!\("\{FILE_PREFIX\}\.\{stamp\}\{FILE_SUFFIX\}"\)/);

    // Vector 2 — non-year literal bypass.
    expect(TEST_EXPERT).toMatch(/Non-year literal/i);
    expect(TEST_EXPERT).toMatch(/"mdownreview\.placeholder\.log"/);

    // Vector 3 — concat reconstruction.
    expect(TEST_EXPERT).toMatch(/Concat reconstruction/i);
    expect(TEST_EXPERT).toMatch(/concat\(\)|\.join\(""\)/);
  });

  it("test-expert.md cites the forward-fix commit that closed two of the three vectors (anchor for future regressions)", () => {
    // Pin the commit SHA that adopted the bypass needles so a future
    // regression has a concrete recovery reference. If the SHA is ever
    // amended, this test will fail and force a deliberate refresh.
    expect(TEST_EXPERT).toMatch(/9d663d8/);
    // The placeholder needle pair from the forward-fix is the canonical
    // "what does a bypass needle look like" example.
    expect(TEST_EXPERT).toMatch(/format!\("<prefix>\.\{/);
    expect(TEST_EXPERT).toMatch(/format!\("<prefix>_\{/);
  });

  it("test-expert.md mandates a `### Bypass-vector enumeration` block in the agent's output when the trigger fires", () => {
    expect(TEST_EXPERT).toMatch(/### Bypass-vector enumeration/);
    // Output template must enumerate the catches-it verdicts and the
    // (a)/(b) propose alternatives so the format is consistent across runs.
    const exampleBlock = TEST_EXPERT.slice(TEST_EXPERT.indexOf("### Bypass-vector enumeration"));
    expect(exampleBlock).toMatch(/caught\?\s*<yes/);
    expect(exampleBlock).toMatch(/no\s*[—-]\s*propose:/);
  });

  it("test-expert.md Output template lists Bypass-vector enumeration as a recognised section (with trigger gate)", () => {
    const outputIdx = TEST_EXPERT.indexOf("**Output:**");
    expect(outputIdx).toBeGreaterThan(-1);
    const outputBlock = TEST_EXPERT.slice(outputIdx);
    expect(outputBlock).toMatch(/### Bypass-vector enumeration/);
    // The trigger gate must be reasserted in the Output template so a future
    // rewrite that strips the Always-check section can't silently leave the
    // Output expecting a section that's never produced.
    expect(outputBlock).toMatch(/only when trigger fires|only emit when/i);
  });

  it("test-expert.md trigger pattern is scoped narrowly enough to avoid noise on every PR (issue #331 'Out of scope' constraint)", () => {
    // The spec is explicit: "Broader bypass-vector enumeration for non-source-byte
    // tests (e.g. behaviour-level tests). The trigger is explicitly include_str!
    // + contains patterns; expanding scope risks noise on every PR."
    // Verify the trigger names BOTH terms and is attached to the source-byte
    // guard rule (not the general Always-check pyramid). Drift here would
    // turn a narrowly-scoped check into a per-PR grind.
    const alwaysCheckIdx = TEST_EXPERT.indexOf("**Always check:**");
    const outOfScopeIdx = TEST_EXPERT.indexOf("**Out of scope", alwaysCheckIdx);
    const alwaysBlock = TEST_EXPERT.slice(alwaysCheckIdx, outOfScopeIdx);
    // Trigger words must co-locate within the same bullet (within 400 chars
    // of "Bypass-vector enumeration" header).
    const ruleIdx = alwaysBlock.indexOf("Bypass-vector enumeration");
    const ruleSpan = alwaysBlock.slice(ruleIdx, ruleIdx + 600);
    expect(ruleSpan).toMatch(/include_str!/);
    expect(ruleSpan).toMatch(/contains/);
    expect(ruleSpan).toMatch(/Trigger:/);
  });
});

const VALIDATOR_PATH = resolve(
  __dirname,
  "../../.claude/agents/exe-implementation-validator.md",
);
const VALIDATOR = readFileSync(VALIDATOR_PATH, "utf8");

const TEST_STRATEGY_PATH = resolve(__dirname, "../../docs/test-strategy.md");
const TEST_STRATEGY = readFileSync(TEST_STRATEGY_PATH, "utf8");

describe("exe-implementation-validator + iterate-one-issue  ENVIRONMENTAL native-E2E classification rule 27 (issue #316)", () => {
  it("validator doc declares the three host-state signatures verbatim", () => {
    expect(VALIDATOR).toContain("0x8007139F");
    expect(VALIDATOR).toContain("ERROR_SERVICE_NOT_ACTIVE");
    expect(VALIDATOR).toContain("CDP HTTP did not become ready");
  });

  it("validator doc declares the diff-scope precondition path list", () => {
    expect(VALIDATOR).toContain("e2e/native/");
    expect(VALIDATOR).toContain("src-tauri/src/lib.rs");
    expect(VALIDATOR).toContain("src-tauri/src/main.rs");
    expect(VALIDATOR).toContain("src-tauri/tauri.conf.json");
  });

  it("validator doc declares the structured YAML output marker", () => {
    expect(VALIDATOR).toContain("<!-- iterate-validator-classification -->");
    expect(VALIDATOR).toContain("classification: ENVIRONMENTAL");
    expect(VALIDATOR).toContain("suite: native-e2e");
    expect(VALIDATOR).toContain("retry_recommended: true");
  });

  it("validator doc has positive transcript example: HRESULT + non-native diff -> ENVIRONMENTAL", () => {
    // Pin proximity: a transcript block contains a non-native diff path,
    // both env-flake signatures, and the ENVIRONMENTAL verdict header,
    // all within a single ~600-char window.
    const positive = VALIDATOR.match(
      /src-tauri\/tests\/watcher_emit_test\.rs[\s\S]{0,600}0x8007139F[\s\S]{0,600}CDP HTTP at http:\/\/localhost:9222\/json\/version did not become ready[\s\S]{0,600}### Native E2E: ENVIRONMENTAL/,
    );
    expect(
      positive,
      "validator must include a transcript fixture: non-native diff + 0x8007139F + CDP HTTP not ready -> ENVIRONMENTAL verdict",
    ).not.toBeNull();
  });

  it("validator doc has negative transcript example: HRESULT + e2e/native diff -> FAIL", () => {
    const negative = VALIDATOR.match(
      /e2e\/native\/global-setup\.ts[\s\S]{0,600}0x8007139F[\s\S]{0,600}CDP HTTP[\s\S]{0,600}did not become ready[\s\S]{0,600}### Native E2E: FAIL[\s\S]{0,200}e2e\/native\/global-setup\.ts/,
    );
    expect(
      negative,
      "validator must include a transcript fixture: e2e/native/global-setup.ts diff + env signatures -> FAIL (env classification disqualified)",
    ).not.toBeNull();
  });

  it("validator doc has negative transcript example: HRESULT + Rust startup diff -> FAIL", () => {
    const negative = VALIDATOR.match(
      /# Diff[\s\S]{0,200}src-tauri\/src\/lib\.rs[\s\S]{0,600}(?:0x8007139F|ERROR_SERVICE_NOT_ACTIVE)[\s\S]{0,600}CDP HTTP[\s\S]{0,600}did not become ready[\s\S]{0,600}### Native E2E: FAIL[\s\S]{0,200}src-tauri\/src\/lib\.rs/,
    );
    expect(
      negative,
      "validator must include a transcript fixture: src-tauri/src/lib.rs diff + env signatures -> FAIL (env classification disqualified)",
    ).not.toBeNull();
  });

  it("validator doc has negative transcript example: real test failure (no env-flake signature) -> FAIL", () => {
    // A real-failure transcript: assertion error and NO env-flake token,
    // with a FAIL verdict that explicitly cites "no env-flake signature".
    const realFail = VALIDATOR.match(
      /expect\(received\)\.toBe\(expected\)[\s\S]{0,600}### Native E2E: FAIL[\s\S]{0,200}no env-flake signature/,
    );
    expect(
      realFail,
      "validator must include a transcript fixture: real assertion failure -> FAIL with explicit 'no env-flake signature' rationale",
    ).not.toBeNull();
    // Sanity: this transcript block must not contain the env-flake tokens
    // (otherwise the proximity match is meaningless).
    const blockStart = VALIDATOR.indexOf("expect(received).toBe(expected)");
    const blockEnd = VALIDATOR.indexOf("no env-flake signature", blockStart);
    const block = VALIDATOR.slice(blockStart, blockEnd);
    expect(block).not.toMatch(/0x8007139F|ERROR_SERVICE_NOT_ACTIVE|CDP HTTP did not become ready/);
  });

  it("SKILL.md Step 6d.0 cites rule 27 in test-strategy.md", () => {
    expect(SKILL).toContain("rule 27 in `docs/test-strategy.md`");
    expect(SKILL).toContain("#### 6d.0");
    expect(SKILL).toContain("classification: ENVIRONMENTAL");
    expect(SKILL).toContain("suite: native-e2e");
  });

  it("SKILL.md Step 6d.0 declares retry-cap and free-from-budget semantics", () => {
    expect(SKILL).toContain("One retry total");
    expect(SKILL).toContain("Does NOT consume the 5-attempt forward-fix budget");
  });

  it("SKILL.md 8-record iteration block declares Env-flake retries field", () => {
    expect(SKILL).toContain("Env-flake retries:");
  });

  it("test-strategy.md rule 27 cites issue #316 and the env-flake signatures", () => {
    expect(TEST_STRATEGY).toMatch(/^27\. Native-E2E WebView2 host-state failures matching/m);
    expect(TEST_STRATEGY).toContain("Issue #316");
    expect(TEST_STRATEGY).toContain("0x8007139F");
    expect(TEST_STRATEGY).toContain("ERROR_SERVICE_NOT_ACTIVE");
    expect(TEST_STRATEGY).toContain("CDP HTTP did not become ready");
    expect(TEST_STRATEGY).toContain("6d.0");
  });
});
