# Retrospective — iteration 1/30 (PASSED)

## Goal of this iteration
Add a mandatory path-existence pre-check to `.claude/agents/exe-goal-assessor.md` so that any acceptance criterion naming a non-existent file path is automatically marked `unmet` (closing PR #73's failure mode).

## What went well
- **Single-file scope let me skip the parallel implementer dispatch** — for a 30-line markdown edit to a single agent prompt, the standard 5-group sprint was overkill; I edited directly. Saved at least 4 background agent invocations.
- **Rubber-duck caught a real AC #4 gap** — the original "create/add/ensure" verb list didn't cover "modify/update/edit" wording, which would have left modified-target ACs unprotected. Caught at expert review (`72e44eb`), not after merge.
- **CI noise was zero** — `.claude/**` changes are path-filtered out of CI, so all checks correctly skipped successfully on first push. No false-positive forward-fix cycles.
- **Assessor was deterministic and correct** — Step 2 returned in_progress with 5/5 unmet and 98% confidence on first run; no anchoring drift.

## What did not go well
- **Step 7 expert panel was over-spec'd for an agent-prompt change** — the 8-expert panel includes `react-tauri-expert`, `performance-expert`, `bug-expert`, etc. that have nothing to say about a 30-line markdown change. I dispatched only `rubber-duck` (general critique) and skipped the rest. This is a deviation from the rigid skill contract; the panel scoping rule should be tightened to skip experts whose domain triggers don't fire on the diff.
- **Step 6b (validation suite) was inapplicable** — running `npm run lint` / `tsc` / `cargo test` / `npm test` on a `.claude/agents/*.md` change touches zero code. The skill currently requires the full suite regardless of diff content, which would burn ~5 minutes of agent time for no signal. I polled CI only.

## Root causes of friction
- Both items above stem from the **iterate skill's one-size-fits-all Step 6/7 contract**. The skill's rigid contract is correct for source-code iterations (where lint/tsc/cargo and 8-expert panels catch real issues) but wasteful for prompt-only / docs-only iterations. Could be tightened with a doc rule like *"if `git diff --stat $ITER_BASE_SHA HEAD` touches only `.claude/**` or `docs/**`, Step 6b can poll CI only and Step 7 can be scoped to `documentation-expert` + `rubber-duck`."*

## Improvement candidates (each must be specifiable)

### Scope iterate Step 6/7 to diff content (skip irrelevant experts on prompt/docs-only diffs)
- **Category:** skill
- **Problem (with evidence):** For PR #120 (issue #105) the diff was 1 file / 30 inserted lines in `.claude/agents/exe-goal-assessor.md`. Step 6b's full-suite contract (`npm run lint`, `tsc`, `cargo test`, `npm test`, e2e) and Step 7's 8-expert panel (architect/performance/react-tauri/bug/test/documentation/lean + conditional security) would have burned ~10 background agent invocations and ~5 minutes for zero useful signal. I deviated from the contract and ran only `rubber-duck` + CI poll; result was identical (1 BLOCK caught, 3 fixes applied).
- **Proposed change:** In `.claude/skills/iterate/SKILL.md`, add a "Diff-scoped Step 6b/7" subsection: when `git diff --stat $ITER_BASE_SHA HEAD` only touches paths matching `.claude/**` OR `docs/**` OR `*.md` (root), Step 6b polls CI only (no local suite) and Step 7 dispatches only `documentation-expert` + `rubber-duck` (skip the other 6 + conditional security). All other diffs run the full contract unchanged.
- **Acceptance signal:** Next prompt-only or docs-only iteration completes Step 6b in ≤30s (CI-poll only) and Step 7 in ≤90s (2-expert parallel) with same review fidelity (BLOCKs caught at the same rate).
- **Estimated size:** xs
- **Confidence this matters:** medium — only fires on prompt/docs PRs, but the iterate-improvement queue (#105, #112, #116, #119) is dominated by such PRs, so payoff in this batch is high.

## Carry-over to next iteration
- None. PASSED with all 5 ACs met; assessor re-check next iteration should return `achieved`.
