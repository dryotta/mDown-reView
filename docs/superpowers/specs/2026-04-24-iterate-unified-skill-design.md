# `/iterate` — Unified Iteration Skill

**Date:** 2026-04-24
**Status:** Proposed
**Supersedes:** `.claude/skills/implement-issue/SKILL.md`, `.claude/skills/self-improve-loop/SKILL.md`, `.claude/skills/start-feature/SKILL.md`

## Goal

Replace the two overlapping skills (`implement-issue`, `self-improve-loop`) with a single `iterate` skill that unifies their machinery. The skill runs an autonomous iteration loop on a single branch and single PR, driven by a `goal-assessor` that decides what work is next each iteration. It accepts either a GitHub issue reference or a free-text goal, and picks the mode itself from the argument shape. Quality machinery from `self-improve-loop` (rebase with rerere, parallel local-vs-CI validation, 6-expert diff review, forward-fix loops) applies uniformly in both modes. On the successful path, a final release-gate validation step (§3.10) runs the full Windows + macOS Release Gate workflow against the accumulated work, forward-fixing any platform-matrix issues before the PR is marked ready.

## Non-goals

- No change to `groom-issues`, `run-tests`, `validate-ci`, or `publish-release`.
- No change to the expert subagents themselves — this skill only coordinates them.
- No multi-branch or multi-PR execution. One skill invocation ⇒ one branch ⇒ one draft PR.
- No resume support. If a prior branch with the target name exists, the skill halts rather than mutating work in progress.
- No concept of "phases" as predetermined work chunks. The assessor re-decides scope every iteration.

## Why unify

1. **Redundancy.** The two skills share ~80% of their machinery: pre-flight, branch creation, draft PR opening, `task-implementer` dispatch, push, commit message formatting, PR body updates, state file. Duplicated prompt logic drifts.
2. **Quality gap.** `implement-issue` has a single `superpowers:code-reviewer` per phase; `self-improve-loop` has a 6-expert panel per iteration. Issues deserve the same review bar as goals.
3. **Adaptive scope.** `implement-issue`'s rigid phase list becomes wrong whenever early work reveals that later phases need to change. The assessor-regenerates-each-iteration model handles that correctly.
4. **One mental model.** Developers and agents both reason about `iterate` as "one loop with a termination condition" — the only knob that varies is where requirements come from.

`start-feature` is also removed in the same change: its sole job (clean-main check + `git checkout -b <type>/<slug>`) is duplicated by `iterate`'s §2.2/§2.4 for autonomous work and by `validate-ci` for release validation. For hand-coded, non-automated work, a bare `git checkout -b feature/<slug>` is sufficient — the skill added no machinery beyond what a developer types naturally.

## Charter compliance

Every iteration is judged against the product charter and deep-dives (see `AGENTS.md` §Principles & Rules). The goal-assessor, the demand-driven pre-consult experts, and the 6-expert diff review all cite specific rule numbers. An iteration that violates a rule from `docs/architecture.md`, `docs/performance.md`, `docs/security.md`, `docs/design-patterns.md`, or `docs/test-strategy.md` is blocked at expert review even if tests are green.

---

## 1. Skill surface

### 1.1 Invocation

```
/iterate                    → issue mode; pick oldest open groomed issue
/iterate 42                 → issue mode, issue #42
/iterate #42                → issue mode, issue #42
/iterate issue-42           → issue mode, issue #42
/iterate https://github.com/owner/repo/issues/42  → issue mode, issue #42
/iterate "eliminate ESLint warnings"              → goal mode, free text
/iterate improve startup time below 800ms         → goal mode, free text
```

### 1.2 Intent detection (deterministic, in order)

Let `arg` be the entire argument string after `/iterate`, trimmed.

1. If `arg` is empty → **issue mode, auto-pick**.
2. If `arg` matches `^\d+$` → **issue mode, number = arg**.
3. If `arg` matches `^#(\d+)$` → **issue mode, number = group 1**.
4. If `arg` matches `^issue-(\d+)$` (case-insensitive) → **issue mode, number = group 1**.
5. If `arg` matches a GitHub issue URL (`^https?://github.com/[^/]+/[^/]+/issues/(\d+)(?:[/#?].*)?$`) → **issue mode, number = group 1**.
6. Otherwise → **goal mode, goal text = arg** (stripped of surrounding quotes if present).

No other parsing. Free text that happens to contain an issue number (`"fix issue 42 differently"`) falls to rule 6 and becomes goal mode with the full text as the goal. This is deliberate: explicit invocations are unambiguous; ambiguous invocations get the goal treatment, which is the more flexible mode.

### 1.3 Auto-pick behaviour for `arg=""`

```bash
gh issue list --label "groomed" --state open --json number,title,body,labels --limit 100 \
  | jq 'sort_by(.number) | .[0]'
```

If nothing returned, halt with: `[iterate] No groomed issues found. Run /groom-issues first, or call /iterate with a goal.`

### 1.4 Mode-specific setup parameters

| Parameter | Issue mode | Goal mode |
|---|---|---|
| `goal_for_assessor` | `"Satisfy all acceptance criteria of #N: <title>"` | `arg` verbatim |
| `branch_pattern` | `feature/issue-<N>-<3-5-word-kebab-slug>` (slug derived from title) | `auto-improve/<slug>-<YYYYMMDD>` (slug derived from goal text, 40-char cap) |
| `pr_title` | `feat: implement #<N> — <title>` | `auto-improve: <goal>` |
| `pr_body_frontmatter` | Includes `Closes #<N>` and full acceptance-criteria checklist from spec | Includes goal text and empty progress list |
| `commit_prefix_non_final` | `feat(#<N>):` with `Refs #<N>` trailer | `auto-improve:` |
| `commit_prefix_final` | `feat(#<N>):` with `Closes #<N>` trailer | `auto-improve:` with no close trailer |
| `assessor_extra_context` | Full issue body + `<!-- mdownreview-spec -->` comment body + current open AC checkboxes | None |
| `iteration_cap` | 30 | 30 |

---

## 2. Phase 0 — Setup (runs once per invocation)

### 2.1 Parse `arg` and decide mode (see §1.2). Capture: `mode`, `issue_number` (issue mode only), `goal_text` (the text shown to users and stored in state).

### 2.2 Pre-flight (parallel)

```bash
git status --porcelain
git branch --show-current
git rev-parse HEAD
```

- **Dirty working tree** → halt: `[iterate] Working tree is dirty. Commit or stash changes first.`
- **Not on `main`** → `git checkout main && git pull` (no halt).

### 2.3 Issue-mode-only: load spec

```bash
gh issue view <N> --json number,title,body,labels,comments
```

Search comments for `<!-- mdownreview-spec -->`. Extract its full content. If missing, halt:
`[iterate] #<N> has no spec. Run /groom-issues <N> first.`

Capture: `issue_title`, `issue_body`, `spec_markdown`, `acceptance_criteria` (parsed checklist from spec).

### 2.4 Create branch and draft PR

```bash
git checkout main && git pull
git checkout -b "$BRANCH"            # mode-specific pattern
git commit --allow-empty -m "chore(iterate): start — $GOAL_TEXT"
git push -u origin HEAD

# Enable rerere so conflict resolutions are cached for future rebases
git config rerere.enabled true
git config rerere.autoupdate true

gh pr create --draft --title "$PR_TITLE" --body "$PR_BODY"
```

If `$BRANCH` already exists (local or remote): halt with
`[iterate] Branch $BRANCH already exists. Delete it or pick a different invocation — resume is not supported.`
Do NOT delete. A pre-existing branch may hold human work.

Capture `PR_NUMBER` and `PR_URL`.

### 2.5 Initialise state file

Write `.claude/iterate-state.md`:

```markdown
---
mode: issue | goal
goal: "<goal_text>"
issue_number: <N or null>
started_at: <ISO datetime>
branch: <branch>
pr: <pr url>
pr_number: <pr number>
iteration_cap: 30
---
# Iteration Log
```

### 2.6 Print start banner

```
[iterate] Mode: <mode> | Goal: <goal_text>
Branch: <branch> | PR: <pr url>
Starting autonomous loop — cap 30 iterations. No further interaction needed.
```

---

## 3. Phase 1 — Iteration loop

Track counters: `iteration=1`, `passed_count=0`, `degraded_count=0`.

Execute steps 3.1 → 3.8 in order each iteration. Termination can fire at three specific points within an iteration (§4); everything else **logs and continues** — it does NOT halt the loop (see §5 for halt semantics).

### 3.1 Rebase onto `origin/main`

Lifted from `self-improve-loop` Step 0. Strategy (in order of preference):
1. rerere replay of cached resolutions
2. Git's own merge drivers (`recursive --strategy-option=diff3`)
3. Parallel per-file `task-implementer` agents (up to 3 attempts per conflicted commit)
4. `architect-expert` last-resort escalation (once per conflicted commit)

If all four fail OR if a running rebase has replayed more than 20 commits, **abort the rebase** and jump straight to **Done-Blocked** (§4.2) with reason `merge conflict against main at iteration N — human resolution required`.

**Post-rebase sanity gate** (fast, catches resolution errors before the full suite):

```bash
npx tsc --noEmit
cd src-tauri && cargo check
```

If either fails, treat as rebase-introduced breakage: spawn `task-implementer` with the compile errors and instruction to fix as a follow-up commit. Commit + push. Only continue to 3.2 once the tree compiles.

After success:

```bash
git push --force-with-lease
ITER_BASE_SHA=$(git rev-parse HEAD)
```

`ITER_BASE_SHA` bounds the diff for Step 3.7's review so it sees only this iteration's NEW work.

### 3.2 Assess

Spawn `goal-assessor`. Inputs:

```
Goal: <goal_for_assessor>
Iteration: <N>/<iteration_cap>
Passed so far: <passed_count>
Degraded so far: <degraded_count>
Iteration log (prior): <state file content>

<Issue mode only:>
Issue #<N>: <title>
Issue body:
<issue_body>

Spec (source of truth for acceptance criteria):
<spec_markdown>

Acceptance criteria (open items):
<remaining AC checkboxes>

Instruction:
Read the codebase from scratch. Ignore prior iteration specs. Assess whether the goal is fully achieved and, if not, write requirement specs for the next meaningful sprint — a coherent body of work that delivers visible progress toward the goal, not just the smallest next step. Group requirements by what can be implemented in parallel.

In issue mode: for each remaining acceptance-criterion checkbox, determine whether it is currently satisfied by the code and say so with file:line evidence. If NEXT_REQUIREMENTS is empty but some AC is still open, mark STATUS=blocked with BLOCKING_REASON pointing at the unreachable AC.
```

Returns:

```
STATUS: achieved | in_progress | blocked
CONFIDENCE: 0–100
NEXT_REQUIREMENTS: <bulleted spec, grouped for parallelism>
EVIDENCE: <file:line citations>
BLOCKING_REASON: <if blocked>
```

- `achieved` → skip 3.3–3.8, jump straight to **Done-Achieved** (§4.1). No new commit is made this iteration.
- `blocked` → skip 3.3–3.8, jump straight to **Done-Blocked** (§4.2). No new commit.
- `in_progress` → continue to 3.3.

### 3.3 Demand-driven pre-consult (parallel, optional)

Scan `NEXT_REQUIREMENTS` text for domain triggers. For each trigger matched, spawn the corresponding expert **in one parallel message**:

| Trigger keyword or path pattern in NEXT_REQUIREMENTS | Expert |
|---|---|
| "IPC", "Tauri command", "invoke", `src-tauri/src/commands.rs`, `src/lib/tauri-commands.ts`, `src/store/*` | `architect-expert` |
| "React component", "hook", "Zustand", `src/components/`, `src/hooks/`, `src/store/` | `react-tauri-expert` |
| "file read", "file write", "path", "markdown render", `src-tauri/src/core/sidecar.rs`, `MarkdownViewer` | `security-reviewer` |
| "startup", "debounce", "throttle", "watcher", "large file", "render cost" | `performance-expert` |

Each expert gets:

```
I'm about to plan iteration <N> for <mode> <ref>.

Goal: <goal_text>
Next requirements (assessor output):
<NEXT_REQUIREMENTS>
Evidence:
<EVIDENCE>

From your area of expertise:
1. Key considerations for this iteration's implementation.
2. Risks or pitfalls to watch for.
3. Which files to modify and how.

Cite file:line for every recommendation. Cite rule numbers from docs/*.md when a rule applies. If the plan looks sound, say so in one line.
```

Skip if no triggers match. Collect any guidance into a short advisory summary.

### 3.4 Plan

Spawn `general-purpose`. Prompt:

```
Produce a comprehensive sprint plan for this iteration. Identify ALL changes needed to make the requested progress — do not artificially limit scope.

Goal: <goal_text>
Iteration: <N>/<iteration_cap>
Mode: <mode>
<Issue mode only:>
Spec excerpt (the contract):
<relevant spec sections>
Remaining acceptance criteria:
<open AC bullets>
<End issue mode only.>
Next requirements (assessor):
<NEXT_REQUIREMENTS>
Expert guidance:
<advisory summary from 3.3, or "none — no expert domains triggered">

Use the grouping in NEXT_REQUIREMENTS to organise the plan: independent groups run in parallel, dependent groups wait for their dependencies.

For each group:
- Files to change · exact changes · tests to write · dependencies on other groups
- Local validation expected to pass
- Acceptance-criteria items satisfied (issue mode only — cite spec text)

Rate overall risk: low | medium | high.

Non-negotiable completeness rules:
- Every UI-visible behaviour change: browser e2e test in e2e/browser/ AND native e2e test in e2e/native/ if the scenario requires real file I/O or IPC (docs/test-strategy.md rules 4-5)
- Every new Tauri command: update commands.rs + tauri-commands.ts + IPC mock in src/__mocks__/@tauri-apps/api/core.ts (docs/test-strategy.md rule 5)
- Delete code made obsolete by this change in the same step
- No TODO comments, no half-wired code, no workarounds

Charter meta-principles (non-negotiable):
- Rust-First with MVVM: Model = Rust (src-tauri/src/core/, commands.rs); ViewModel = src/lib/vm/ + src/hooks/ + src/store/; View = src/components/
- Never Increase Engineering Debt: every iteration reduces or holds debt flat; close Gap markers in deep-dive docs where applicable
- Zero Bug Policy: every fix ships with a regression test reproducing the original failure
```

If `risk=high`, spawn `architect-expert` with the full plan and ask for mitigations. Incorporate them into a revised plan. If architect judges the approach fundamentally unsound, the iteration is **logged as skipped** (§3.9 `SKIPPED` entry) and the loop advances — the next iteration's assessor re-reads code and picks different work.

### 3.5 Implement (parallel by plan group)

For each **independent group**: spawn one `task-implementer`. Send all independent groups in one parallel message. Dependent groups wait for their dependency waves.

Each `task-implementer` prompt:

```
Implement this group of changes for mdownreview.

<Mode-specific header:>
Issue: #<N> — <title>
OR
Goal: <goal_text>
<End mode-specific.>

Iteration: <N>/<iteration_cap>
Group: <group name and dependency note>
Files: <file list for this group>
Changes: <exact changes from plan>
Tests: <tests to write — unit + e2e if UI-visible>
Context: <relevant spec/goal excerpt>

Do NOT touch files outside this group. Do NOT ask clarifying questions — if ambiguous, make the conservative choice and note it.
Return Implementation Summary: files modified · tests written · decisions made · concerns.
```

Wait for each dependency wave before spawning the next. Collect all Implementation Summaries.

If every implementer reports "no changes made or needed" for the whole iteration: log `SKIPPED — no-op: <reason>`, **do not commit or push**, advance iteration.

### 3.6 Push + race validate

**3.6.1 — Push immediately** (trigger CI as early as possible):

```bash
git add <specific files reported by implementers — never git add -A blindly>
git commit -m "$COMMIT_MESSAGE"    # mode-specific, see §1.4 and §3.9
git push
```

**3.6.2 — Local validation and CI poll in parallel** (one message, two agents):

**Agent A** — `implementation-validator`:

```
Run the full local test suite in order:
1. npm run lint
2. npx tsc --noEmit
3. cd src-tauri && cargo test
4. npm test
5. npm run test:e2e
6. npm run test:e2e:native

Return PASS or FAIL with full output for every check.
```

All six suites always run — this is the validator's job, not the iteration's. CI runs the same set, so skipping any suite locally would only delay a failure to the CI poller.

**Agent B** — `general-purpose` (CI poller):

```
Poll CI status for PR <PR_NUMBER> every 30 seconds until all checks complete or 30 minutes elapse.
  gh pr checks <PR_NUMBER>
Stop when no check shows "pending" or "in_progress".
Return: PASS (all checks green) or FAIL (list of failed check names with their logs).
```

Wait for both.

**3.6.3 — Forward-fix loop (max 5 attempts)**:

Repeat until both local and CI pass, or 5 attempts exhausted:

1. Spawn `task-implementer`:
   ```
   Fix the following failures. Do not revert — make a forward fix.
   Local failures: <full local output>
   CI failures: <failed check names and logs>
   Prior attempts in this loop: <summaries>

   Make the minimal change needed to resolve each failure. Prefer tightening existing code over adding new abstractions.
   Return Implementation Summary.
   ```
2. Commit + push:
   ```bash
   git add <specific files>
   git commit -m "fix(iter-$N): <one-line fix summary>"
   git push
   ```
3. Re-run 3.6.2.
4. If both pass: exit loop, proceed to 3.7.
5. If still failing after attempt 5: log `DEGRADED — could not fix validate/CI after 5 attempts: <summary>`. **Do not revert commits** — leave them for the next iteration's assessor and human review. Increment `degraded_count`. Proceed to 3.7 anyway so expert review can still catch issues, then advance iteration.

### 3.7 Expert review (parallel)

Capture only this iteration's NEW diff:

```bash
git diff $ITER_BASE_SHA HEAD --stat
git diff $ITER_BASE_SHA HEAD
```

Spawn the **6-expert panel** in one parallel message:

- `product-improvement-expert`
- `performance-expert`
- `architect-expert`
- `react-tauri-expert`
- `ux-expert`
- `bug-hunter`

Plus, **if** the diff touches `src-tauri/src/commands.rs`, `src-tauri/src/core/sidecar.rs`, any path-handling code, or any markdown rendering code, **also** spawn `security-reviewer` in the same parallel message. And **if** the diff adds or materially changes tests or introduces a new UI-visible behaviour without a browser e2e, also spawn `test-gap-reviewer`.

Each expert receives:

```
Review this iteration's diff for mdownreview.

<Mode-specific header:>
Issue: #<N> — <title>
OR
Goal: <goal_text>
<End.>

Iteration: <N>/<iteration_cap>
Spec/goal context:
<relevant excerpt>

Diff stat:
<output of git diff --stat>

Full diff:
<output of git diff>

BLOCK on any of these — APPROVE otherwise. Cite specific rule numbers from docs/*.md when blocking.

1. Does this make progress toward the goal / acceptance criterion it claims?
2. New bugs, regressions, or architectural problems? (docs/architecture.md rules)
3. Violates any rule in docs/performance.md, docs/security.md, docs/design-patterns.md, or docs/test-strategy.md?
4. UI-visible change without a browser e2e test in e2e/browser/? (docs/test-strategy.md rules 4-5)
5. Dead code, unused imports, replaced patterns not deleted in the same iteration?
6. Technical debt — TODO comments, half-wired code, bypassed checks, workarounds?
7. Rust-First with MVVM respected? (docs/principles.md, docs/architecture.md rules 1-10)

Return: APPROVE or BLOCK with file:line evidence AND "violates rule N in docs/X.md" citation for every BLOCK.
```

Wait for all experts.

**If any BLOCK**: spawn `task-implementer` with the union of all blocking issues:

```
Fix the following blocking review issues. Do not revert — forward fix.
<For each blocking issue: expert name, file:line, rule citation, fix direction>

Make the minimal change that satisfies each blocker. Do NOT reopen approved concerns.
Return Implementation Summary.
```

Commit + push. Re-run local validation + CI poll (same parallel pattern as 3.6.2). Then re-run the expert panel **once more** on the updated iteration diff.

If experts still BLOCK after one fix round: log `DEGRADED — expert review: <issue summaries>`. Increment `degraded_count`. **Do not revert commits** — the next iteration's assessor will re-read the code; recurring blockers will surface as `blocked` or force a different plan. Proceed to 3.8.

### 3.8 Record iteration

Append to `.claude/iterate-state.md`:

```markdown
## Iteration <N> — <PASSED | DEGRADED | SKIPPED>
- Commits: <list of SHAs from ITER_BASE_SHA to HEAD>
- Validate+CI: <passed / fixed in K attempts / degraded after 5>
- Expert review: <N approved / M blocked — list>
- Goal assessor confidence: <%>
- Summary: <one sentence>
<if degraded:>
- Carry-over issues: <bullet list — read by next iteration's assessor>
```

**Update PR body and progress**:

- Refresh the PR body's progress list. Issue mode: tick any newly-satisfied AC checkbox (per this iteration's assessor + implementer output). Goal mode: list the iteration's completed requirement groups.
- Post a progress comment:
  ```
  <!-- iterate-iter-<N> -->
  ### <✅ | ⚠️ | ⏭️> Iteration <N>/<iteration_cap> — <status>

  **Commits:** <short SHAs>
  **Files changed:** <count>
  **Tests added/updated:** <count>
  <Issue mode: **AC satisfied this iteration:** <bullet list>>
  <Goal mode: **Requirements completed:** <bullet list>>
  <If degraded: **Carry-over:** <summary>>

  Next: iteration <N+1> (assessor will re-scan on rebase)
  ```

Increment `iteration`. If `PASSED`, increment `passed_count`. If `iteration > iteration_cap` OR termination triggered this iteration (§4), exit the loop.

### 3.9 Commit-message conventions

| Situation | Mode | Message |
|---|---|---|
| Iteration implementation commit | Issue | `feat(#<N>): iter <N> — <one-line summary>\n\n<2-3 sentence summary>\n\nRefs #<N>\n\nCo-authored-by: Claude Opus 4.7 <noreply@anthropic.com>` |
| Iteration implementation commit | Goal | `auto-improve: iter <N> — <one-line summary>\n\n<2-3 sentence summary>\n\nCo-authored-by: Claude Opus 4.7 <noreply@anthropic.com>` |
| Forward-fix commit inside iteration | Either | `fix(iter-<N>): <summary>` |
| Rebase-repair commit | Either | `fix(rebase): <summary>` |

There is no "final-iteration" distinction: when the assessor returns `achieved`, steps 3.3–3.8 are skipped, so no new commit is produced. Issue closure on merge is driven by the `Closes #<N>` trailer in the PR body (set at §2.4), not by commit messages.

### 3.10 Release-gate validation (final step — runs ONLY on Done-Achieved path)

Runs once after §3.2 returns `STATUS=achieved`, before the PR is marked ready. Purpose: validate the accumulated work against the **Release Gate** workflow, which runs the full Windows + macOS platform matrix (real install, signed-build paths) and only triggers on branches prefixed `release/`. See `.claude/skills/validate-ci/SKILL.md` for the mechanism.

The iterate branch (`feature/issue-<N>-…` or `auto-improve/…`) does NOT trigger release gate. Step 3.10 creates a companion `release/iterate-…` branch and PR that mirrors the iterate branch tip, polls the release-gate workflow, and forward-fixes any failures on the **iterate branch** (not the mirror) so the human reviews a single PR.

#### 3.10.1 — Create release validation branch and PR

```bash
RELEASE_BRANCH="release/iterate-$(echo "$BRANCH" | sed 's|^[^/]*/||' | cut -c1-40)-$(date +%Y%m%d%H%M)"
git checkout -b "$RELEASE_BRANCH"
git push -u origin HEAD
git checkout "$BRANCH"

RELEASE_PR_URL=$(gh pr create --draft --base main --head "$RELEASE_BRANCH" \
  --title "validate-release: $PR_TITLE" \
  --body "Release-gate validation for #$PR_NUMBER. Close with \`gh pr close … --delete-branch\` after validation completes.")
RELEASE_PR_NUMBER=<parsed from $RELEASE_PR_URL>
```

If `$RELEASE_BRANCH` already exists (e.g., prior skill run crashed), halt the release-gate step as **Done-Blocked** (§4.2) with reason = `release-gate branch already exists — delete it and re-run step 3.10 manually`. Do not overwrite.

Comment on the iterate PR:
```
<!-- iterate-release-gate-start -->
⏳ Release-gate validation started on <RELEASE_PR_URL>
```

#### 3.10.2 — Poll CI + release-gate checks

Spawn `general-purpose` (CI poller) against `$RELEASE_PR_NUMBER`:

```
Poll CI and Release Gate status for PR <RELEASE_PR_NUMBER> every 60 seconds until all checks complete or 60 minutes elapse.
  gh pr checks <RELEASE_PR_NUMBER>
Stop when no check shows "pending" or "in_progress".
Return: PASS (all checks green) or FAIL (list of failed check names with their logs).
```

Release-gate jobs are slower than CI (real installer builds, platform matrix) — use a 60-minute timeout, not 30.

#### 3.10.3 — Forward-fix loop (max 5 attempts)

On FAIL:

1. Spawn `task-implementer` with the failing check names and their logs:
   ```
   Fix the following Release Gate failures. Do not revert — forward fix.
   Failed checks: <names>
   Logs:
   <truncated logs>
   Prior attempts in this loop: <summaries>

   Edit files on the iterate branch (current working tree). Do NOT edit the release-mirror branch. Return Implementation Summary.
   ```
2. Commit + push on the iterate branch:
   ```bash
   git add <specific files>
   git commit -m "fix(iter-release): <one-line summary>"
   git push
   ```
3. Fast-forward the release-mirror branch to the iterate tip, then push it (this re-triggers Release Gate):
   ```bash
   git checkout "$RELEASE_BRANCH"
   git merge --ff-only "$BRANCH"
   git push
   git checkout "$BRANCH"
   ```
4. Re-run 3.10.2.
5. If PASS: proceed to 3.10.4.
6. If still FAIL after attempt 5: halt as **Done-Blocked** (§4.2) with reason = `release-gate failure after 5 forward-fix attempts`. Leave the mirror PR open (draft) and the iterate PR draft so a human can investigate both.

#### 3.10.4 — Close mirror PR on success

```bash
gh pr close "$RELEASE_PR_NUMBER" --delete-branch
```

Append to state file:

```markdown
## Release-gate validation — PASSED
- Mirror PR: <RELEASE_PR_URL>
- Fix attempts: <N>
- Commit validated: <iterate branch HEAD SHA>
```

Comment on the iterate PR:
```
<!-- iterate-release-gate-done -->
🟢 Release gate validated on commit <sha>. Mirror PR closed.
```

Proceed to §4.1 Done-Achieved's "mark ready" step.

---

## 4. Termination

Three specific points inside an iteration can terminate the loop:

1. **Step 3.1 aborts** (all rebase auto-resolution failed) → **Done-Blocked** (§4.2) with reason = merge-conflict. Implementation steps are skipped.
2. **Step 3.2 returns `STATUS=achieved`** → **Done-Achieved** (§4.1). Implementation steps are skipped — no new work this iteration.
3. **Step 3.2 returns `STATUS=blocked`** → **Done-Blocked** (§4.2). Implementation steps are skipped.

In addition, after a completed iteration (end of 3.8), if `iteration + 1 > iteration_cap`, the loop exits via **Done-TimedOut** (§4.3).

`DEGRADED` and `SKIPPED` iterations do NOT terminate. They count against `degraded_count` but the loop continues — the next iteration's assessor re-reads the code and will either fold in the carry-over work or re-flag it as `blocked` if structurally unfixable.

Note: `DEGRADED` iterations do NOT halt. They count against `degraded_count` but the loop continues — the next iteration's assessor re-reads the code and will either fold in the carry-over work or re-flag it as `blocked` if structurally unfixable.

### 4.1 Done-Achieved

**First, run §3.10 Release-gate validation.** If it succeeds, continue; if it halts, you are now in §4.2 (Done-Blocked) instead, not here.

Once the release gate has validated the iterate branch's tip:

```bash
gh pr ready <PR_NUMBER>
```

Refresh PR body: tick every progress item, change summary to "Ready for review — goal achieved, release gate passed". In issue mode, ensure `Closes #<N>` appears.

Print:

```
✅ <mode> — <ref>
   PR: <pr url> (ready for review, release gate passed)
   Branch: <branch>
   Iterations: <passed_count> passed · <degraded_count> degraded
   Release-gate fix attempts: <K>
   Final assessor confidence: <%>
```

### 4.2 Done-Blocked

Leave PR in draft. Comment on PR:

```
<!-- iterate-blocked -->
## ⚠️ Autonomous iteration halted at iteration <N>/<iteration_cap>

**Reason:** <BLOCKING_REASON or rebase-conflict summary>
**Last assessor evidence:** <EVIDENCE>
<If rebase:>
**Conflicted files:** <list>
<End.>

Iterations 1..<N-1> are complete and pushed. This iteration needs human attention. After resolving the blocker, restart with `/iterate <same args>` (the branch must first be deleted) or continue manually on this branch.
```

In issue mode, post the same message (with `<!-- iterate-blocked-issue -->`) on the issue itself.

Print:

```
❌ <mode> — <ref>
   Halted at iteration <N>/<iteration_cap>
   Reason: <short reason>
   PR (draft): <pr url>
   Branch: <branch>
```

### 4.3 Done-TimedOut

Leave PR in draft. Comment on PR:

```
<!-- iterate-timeout -->
## ⏱ Iteration cap reached (<iteration_cap>)

**Progress:** <passed_count> passed · <degraded_count> degraded
**Final assessor confidence:** <%>
**Last NEXT_REQUIREMENTS (work still open):**
<bulleted list>

Review the branch, then either merge what is ready, continue manually, or restart with `/iterate <args>` after adjusting scope.
```

In issue mode, post the same message on the issue.

Print:

```
⏱  <mode> — <ref>
   Cap reached after <iteration_cap> iterations
   PR (draft, partial progress): <pr url>
   Branch: <branch>
```

---

## 5. Halt semantics (summary)

The skill **halts the loop** only on:
- Assessor returns `blocked`
- Rebase aborts after all auto-resolution strategies fail
- Iteration cap reached
- Release-gate validation (§3.10) fails after 5 forward-fix attempts
- Release-gate validation (§3.10) finds a pre-existing mirror branch

The skill **logs `DEGRADED` and continues** on:
- Validate/CI fails after 5 forward-fix attempts
- Expert review blocks after one forward-fix attempt

The skill **logs `SKIPPED` and continues** on:
- `risk=high` plan is rejected by `architect-expert` as fundamentally unsound
- All implementers in an iteration report "no-op"

The skill **halts before starting the loop** on:
- Dirty working tree at setup
- Pre-existing target branch
- Issue mode and issue has no `<!-- mdownreview-spec -->` comment
- Issue mode and auto-pick finds no groomed issues

No other halts.

---

## 6. Failure recovery

If the skill is interrupted mid-loop:

1. Read `.claude/iterate-state.md` for branch, PR, and last iteration.
2. Check out the loop branch: `git checkout <branch>`.
3. If a rebase is in progress (`.git/rebase-merge` or `.git/rebase-apply` exists), complete or abort it before restarting.
4. Ensure rerere is enabled on the branch (idempotent):
   ```bash
   git config rerere.enabled true
   git config rerere.autoupdate true
   ```
5. Restart: `/iterate <same args>`. The skill detects the existing branch via the pre-flight check and halts. To resume the loop work itself, delete the in-flight branch and re-invoke — step 3.1's rebase + step 3.2's assessor will account for all already-committed work.

(Full resume support is a non-goal — see §Non-goals.)

---

## 7. File and directory changes

**Added**:
- `.claude/skills/iterate/SKILL.md` — the new unified skill
- `.claude/iterate-state.md` — runtime state file (gitignored via existing `.claude/` convention if already ignored; otherwise add to `.gitignore`)

**Removed**:
- `.claude/skills/implement-issue/SKILL.md` (plus its directory)
- `.claude/skills/self-improve-loop/SKILL.md` (plus its directory)
- `.claude/skills/start-feature/SKILL.md` (plus its directory)
- `.claude/self-improve-loop-state.md` (last-run artifact; safe to delete)

**Updated**:
- `AGENTS.md` §Skills (or equivalent list) — reference `iterate` instead of the three removed skills.
- `BUILDING.md` §Claude Code Automation — delete the `/start-feature`, `/implement-issue`, and `/self-improve-loop` subsections; add an `/iterate` subsection describing the unified skill.
- Any skill or doc that currently recommends `/implement-issue`, `/self-improve-loop`, or `/start-feature` (check `groom-issues`, CLAUDE.md, README) — replace with `/iterate` or with direct git/gh commands if appropriate.

**Unchanged**:
- All expert subagents in `.claude/agents/`.
- All other skills (`run-tests`, `validate-ci`, `publish-release`, `groom-issues`, `open`, `cleanup`, `read`, `review`).

---

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| 6-expert panel on every iteration of a trivial issue wastes tokens | Cost overrun for small issues | Most small issues terminate in 1–2 iterations because the assessor says `achieved` early; the panel runs once or twice, not 30 times. |
| `DEGRADED` iterations accumulate bad commits on the branch | PR harder to review | Progress comments flag `DEGRADED` explicitly. Assessor re-reads code each iteration and will surface unresolved issues as `blocked` or rework. |
| Intent detection misroutes `/iterate 42 and something else` | User expected issue mode, got goal mode | Error is self-evident (goal mode's banner says "Goal: 42 and something else"). User can Ctrl-C within the first seconds (before branch creation). The first few lines of the banner announce the mode explicitly. |
| Issue-mode assessor contradicts the human-approved spec | Contract broken silently | Assessor prompt in issue mode REQUIRES citing acceptance criteria and evidence; spec comment is passed as the source of truth. Any deviation is visible in the iteration log and progress comments. |
| Expert panel BLOCKs on every iteration forever | Loop runs to cap, no progress | One forward-fix round per iteration, then `DEGRADED`. Assessor's next iteration will either fold the unresolved block into its requirements or return `blocked`. |
| Rebase-with-rerere caches a bad resolution and replays it | Silent corruption | Post-rebase `tsc --noEmit` + `cargo check` gate catches compile-level breakage. Expert panel catches semantic breakage. Rerere scope is per-branch; if a resolution is consistently wrong, the architect-expert escalation path produces a different one that replaces the cache. |
| Release-gate mirror PR is accidentally merged instead of closed | Duplicate commits on main | Mirror PR is draft (cannot be merged without explicit ready-flip), title prefixed `validate-release:`, body explicitly tells the reader to close with `--delete-branch`. Skill closes it automatically on pass. |
| Release-gate validation runs on every Done-Achieved, even for trivial goals | Wall-clock and token cost on small changes | Release gate runs exactly once per skill invocation regardless of iteration count, and only on the success path. For goals that terminate as TimedOut or Blocked, it does not run at all. |

## 9. Open questions (resolved)

- **Halt model**: forward-fix for everything except assessor-`blocked`, rebase-abort, iteration-cap, release-gate failure. ✅
- **Name**: `/iterate`. ✅
- **Intent detection**: deterministic pattern match per §1.2. ✅
- **Cap**: 30 for both modes. ✅
- **Review panel**: 6 experts unconditional, +security-reviewer and +test-gap-reviewer conditional on diff shape. ✅
- **Pre-consult**: demand-driven per §3.3. ✅
- **Phase concept**: dropped. Assessor decides each iteration's scope. ✅
- **Release-gate validation**: final step on Done-Achieved only, via companion `release/iterate-…` mirror branch; forward-fix on iterate branch; mirror PR closed with `--delete-branch` on pass. ✅
