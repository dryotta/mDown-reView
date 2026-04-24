---
name: iterate
description: Autonomous iteration loop on a single branch and single PR. Accepts a GitHub issue number (or #N / issue-N / issue URL) for issue mode, no-args to auto-pick the oldest groomed issue, or free text for goal mode. Runs up to 30 rebase → assess → plan → implement → validate → 6-expert review iterations, forward-fixing all failures. On success, validates via Release Gate before marking the PR ready. Supersedes implement-issue, self-improve-loop, and start-feature.
---

# Iterate

Runs **one** autonomous iteration loop against **one branch and one PR** until the goal is achieved, the iteration cap is hit, or a terminal block is reached:
pre-flight → branch → draft PR → for each iteration { rebase → assess → pre-consult → plan → implement → validate (push + CI + local, forward-fix) → expert review → record } → on Done-Achieved, release-gate validation → mark PR ready.

**Fully autonomous after the skill starts — no user interaction.**

**RIGID. Follow every step exactly.**

## Product charter (governs every iteration)

Every change must respect the product charter. Before editing a domain, skim the relevant deep-dive:

- **Charter (always):** [`docs/principles.md`](../../../docs/principles.md) — 5 pillars (Professional, Reliable, Performant, Lean, Architecturally Sound) + 3 meta-principles (Rust-First with MVVM, Never Increase Engineering Debt, Zero Bug Policy).
- [`docs/architecture.md`](../../../docs/architecture.md) — IPC/logger chokepoints, Zustand boundaries, file-size budgets.
- [`docs/performance.md`](../../../docs/performance.md) — numeric budgets, watcher rules, render-cost rules.
- [`docs/security.md`](../../../docs/security.md) — IPC surface, CSP, atomic writes, path canonicalization.
- [`docs/design-patterns.md`](../../../docs/design-patterns.md) — React 19 + Tauri v2 idioms.
- [`docs/test-strategy.md`](../../../docs/test-strategy.md) — three-layer pyramid, coverage floors, mock hygiene.

The assessor, the pre-consult experts, and the 6-expert diff review all cite specific rule numbers. An iteration that violates a rule from a deep-dive is blocked at review even if all tests are green.

## Input

One optional argument. The skill detects mode deterministically:

| Argument | Mode |
|---|---|
| (empty) | Issue mode — auto-pick oldest open `groomed` issue |
| `42` | Issue mode, issue #42 |
| `#42` | Issue mode, issue #42 |
| `issue-42` (case-insensitive) | Issue mode, issue #42 |
| `https://github.com/<owner>/<repo>/issues/42[…]` | Issue mode, issue #42 |
| anything else | Goal mode, argument used verbatim as the goal text (outer quotes stripped) |

---

## Phase 0 — Setup (runs once per invocation)

### 0a. Parse the argument and decide mode

Let `ARG` be the entire string after the skill name, trimmed.

Apply these rules in order; the first match wins:

1. `ARG` empty → `MODE=issue`, auto-pick (see 0c).
2. `ARG` matches `^\d+$` → `MODE=issue`, `ISSUE_NUMBER=$ARG`.
3. `ARG` matches `^#(\d+)$` → `MODE=issue`, `ISSUE_NUMBER=<group 1>`.
4. `ARG` matches `^[Ii]ssue-(\d+)$` → `MODE=issue`, `ISSUE_NUMBER=<group 1>`.
5. `ARG` matches `^https?://github\.com/[^/]+/[^/]+/issues/(\d+)([/#?].*)?$` → `MODE=issue`, `ISSUE_NUMBER=<group 1>`.
6. Otherwise → `MODE=goal`, `GOAL_TEXT=<ARG with surrounding quotes stripped>`.

### 0b. Pre-flight (parallel)

Run in parallel:
```bash
git status --porcelain
git branch --show-current
git rev-parse HEAD
```

- **Dirty working tree** → STOP: `[iterate] Working tree is dirty. Commit or stash changes first.`
- **Not on `main`** → `git checkout main && git pull --ff-only` (no halt).

### 0c. Issue-mode auto-pick (only when 0a rule 1 matched)

```bash
gh issue list --label "groomed" --state open --json number,title,body,labels --limit 100 \
  | jq 'sort_by(.number) | .[0]'
```

If nothing returned, STOP: `[iterate] No groomed issues found. Run /groom-issues first, or call /iterate with a goal.`
Otherwise, set `ISSUE_NUMBER=<number from JSON>`.

### 0d. Issue-mode-only: load the spec

```bash
gh issue view $ISSUE_NUMBER --json number,title,body,labels,comments
```

Find the comment whose body begins with `<!-- mdownreview-spec -->` and capture its full body as `SPEC_MARKDOWN`. If no such comment, STOP:
`[iterate] #$ISSUE_NUMBER has no spec. Run /groom-issues $ISSUE_NUMBER first.`

Capture: `ISSUE_TITLE`, `ISSUE_BODY`, `SPEC_MARKDOWN`, `ACCEPTANCE_CRITERIA` (parsed `- [ ]` / `- [x]` checklist items from the spec).

### 0e. Compute branch, PR title, and goal-for-assessor

| Variable | Issue mode | Goal mode |
|---|---|---|
| `BRANCH` | `feature/issue-$ISSUE_NUMBER-<3–5-word kebab slug of $ISSUE_TITLE>` | `auto-improve/<slug of $GOAL_TEXT, 40-char cap>-$(date +%Y%m%d)` |
| `PR_TITLE` | `feat: implement #$ISSUE_NUMBER — $ISSUE_TITLE` | `auto-improve: $GOAL_TEXT` |
| `GOAL_FOR_ASSESSOR` | `Satisfy all acceptance criteria of #$ISSUE_NUMBER: $ISSUE_TITLE` | `$GOAL_TEXT` |
| `PR_CLOSE_TRAILER` | `Closes #$ISSUE_NUMBER` | (omit) |

Slug rules: lowercase, non-alphanumerics → `-`, collapse runs of `-`, trim leading/trailing `-`.

### 0f. Create branch and draft PR

```bash
git checkout main && git pull --ff-only
git checkout -b "$BRANCH"
```

If `$BRANCH` already exists (local OR remote), STOP:
`[iterate] Branch $BRANCH already exists. Delete it or pick a different invocation — resume is not supported.`
Do NOT delete it — a pre-existing branch may hold human work.

```bash
git commit --allow-empty -m "chore(iterate): start — $GOAL_FOR_ASSESSOR"
git push -u origin HEAD

# rerere caches conflict resolutions across future rebases
git config rerere.enabled true
git config rerere.autoupdate true
```

Build `PR_BODY`:
- Issue mode: header links to the issue, full `ACCEPTANCE_CRITERIA` checklist is pasted (unchecked initially; assessor ticks as it satisfies items), trailer line is `Closes #$ISSUE_NUMBER`.
- Goal mode: header quotes the goal text; empty progress list.

```bash
gh pr create --draft --title "$PR_TITLE" --body "$PR_BODY"
```

Capture `PR_NUMBER` and `PR_URL` from the output.

### 0g. Initialise the state file

Write `.claude/iterate-state.md`:

```markdown
---
mode: <issue | goal>
goal: "<GOAL_FOR_ASSESSOR>"
issue_number: <ISSUE_NUMBER or null>
started_at: <ISO datetime>
branch: <BRANCH>
pr: <PR_URL>
pr_number: <PR_NUMBER>
iteration_cap: 30
---
# Iteration Log
```

### 0h. Print start banner

```
[iterate] Mode: <MODE> | Goal: <GOAL_FOR_ASSESSOR>
Branch: <BRANCH> | PR: <PR_URL>
Starting autonomous loop — cap 30 iterations. No further interaction needed.
```

---

## Phase 1 — Iteration loop

Track counters: `iteration=1`, `passed_count=0`, `degraded_count=0`. Execute Steps 1 → 8 each iteration. Termination can fire only at Step 1 (rebase abort) or Step 2 (assessor `achieved` / `blocked`) or end-of-iteration (cap reached); see §Termination.

---

### Step 1 — Rebase onto `origin/main`

Rebase BEFORE Step 2 so the assessor reads a tree that reflects current main.

```bash
git fetch origin main

if git merge-base --is-ancestor origin/main HEAD; then
  echo "[sync] branch already contains origin/main — no rebase needed"
else
  git rebase --strategy=recursive --strategy-option=diff3 origin/main
fi
```

If the rebase completes cleanly (exit 0, working tree clean): skip to the "After successful rebase" block.

If the rebase pauses with conflicts, run the auto-resolution loop. Each loop iteration is one paused rebase commit. `rerere` auto-replays any conflict whose hunks were resolved before on this branch.

Counters:
```
attempt = 0                        # retries for the CURRENT paused commit
max_attempts_per_commit = 3
max_total_commits = 20
commits_replayed = 0
```

While a rebase is in progress (`.git/rebase-merge` or `.git/rebase-apply` exists):

1. **Detect state** (parallel):
   ```bash
   CONFLICTED=$(git diff --name-only --diff-filter=U)
   HAS_MARKERS=$(git grep -lE '^<<<<<<< ' -- . 2>/dev/null || true)
   ```

2. **Empty-commit skip** — if `CONFLICTED` empty AND `HAS_MARKERS` empty (rerere fully resolved OR commit became empty after rebase):
   ```bash
   git add -A
   git -c core.editor=true rebase --continue 2>/dev/null || git rebase --skip
   ```
   `commits_replayed += 1`, `attempt = 0`. Continue loop.

3. **Auto-resolve in parallel** — one `task-implementer` per conflicted file, dispatched in ONE message:
   ```
   Resolve merge conflicts in <FILE> from rebasing the iterate branch onto main.

   Context:
   - Goal: <GOAL_FOR_ASSESSOR>
   - Iteration: <N> | Attempt: <attempt+1>/<max_attempts_per_commit>
   - Conflict markers use diff3: <<< ours === ||||||| base === >>> theirs
     * ours = iterate-branch work
     * base = common ancestor
     * theirs = incoming main
   - git rerere is enabled — your resolution will be cached and auto-replayed on future rebases. Prefer consistent, principled resolutions over one-off hacks.

   Rules:
   - Preserve the intent of BOTH sides. If main refactored/renamed/moved code that ours also touched, adapt ours to main's new shape — do NOT revert main.
   - Remove ALL conflict markers.
   - Do NOT run `git add` or `git rebase --continue`. Just write the resolved file.
   - If the conflict is semantically impossible (e.g. main deleted a feature ours extended), state so explicitly and leave the markers in place — the loop will escalate.

   Return: file path, one-paragraph resolution summary, confidence 0–100.
   ```

4. **Stage and continue**:
   ```bash
   git add -A
   git -c core.editor=true rebase --continue
   RC=$?
   ```

5. **Outcome**:
   - `RC=0` and rebase still in progress → `commits_replayed += 1`, `attempt = 0`. Continue loop.
   - `RC=0` and rebase complete → break out of loop.
   - `RC≠0` (still conflicts on same commit):
     - `attempt += 1`
     - If `attempt < max_attempts_per_commit`: re-run step 3 with an augmented prompt that includes the prior attempt's resolution and the still-present markers.
     - If `attempt == max_attempts_per_commit`: escalate ONCE — spawn `architect-expert` with the full file contents, the diff from main, the diff from ours, and all prior implementer summaries. Apply its output, re-run step 4.
     - If still conflicting after the architect escalation, OR if `commits_replayed > max_total_commits`: go to Abort.

6. **Abort** (all auto-resolution failed):
   ```bash
   git rebase --abort
   ```
   Append to state file:
   ```markdown
   ## Iteration <N> — BLOCKED (merge conflict)
   - Conflicted commit: <current HEAD of paused rebase>
   - Files: <list>
   - Attempts: <implementer retries + 1 architect>
   - Summary: <text>
   ```
   Jump to **Done-Blocked** with reason = `merge conflict against main at iteration <N> — human resolution required`.

**After a successful rebase**, sync the remote and capture the iteration baseline:

```bash
git push --force-with-lease
ITER_BASE_SHA=$(git rev-parse HEAD)
```

`ITER_BASE_SHA` bounds Step 6's review diff to THIS iteration's NEW work.

**Post-rebase sanity gate** (catches subtle resolution errors before the full suite):
```bash
npx tsc --noEmit
(cd src-tauri && cargo check)
```

If either fails, spawn `task-implementer` with the compile/type errors and instruction to fix as a follow-up commit. Commit + push. Only proceed to Step 2 once the tree compiles.

---

### Step 2 — Assess

Spawn `goal-assessor` in ONE call. Inputs:

```
Goal: <GOAL_FOR_ASSESSOR>
Iteration: <N>/30
Passed so far: <passed_count>
Degraded so far: <degraded_count>
Iteration log (prior): <full content of .claude/iterate-state.md>

<Issue mode only — append this block:>
Issue #<ISSUE_NUMBER>: <ISSUE_TITLE>
Issue body:
<ISSUE_BODY>

Spec (source of truth — the contract with the human reviewer):
<SPEC_MARKDOWN>

Acceptance criteria (remaining open items — the skill has been ticking these off in the PR body as iterations satisfy them; derive current state from the iteration log):
<open AC bullets>
<End issue-mode block.>

Instruction:
Read the codebase from scratch. Ignore prior iteration specs. Assess whether the goal is fully achieved and, if not, write requirement specs for the next meaningful sprint — a coherent body of work that delivers visible progress, not just the smallest next step. Group requirements by what can be implemented in parallel.

In issue mode: for each remaining AC checkbox, determine whether it is currently satisfied by the code and say so with file:line evidence. If NEXT_REQUIREMENTS is empty but some AC is still open, mark STATUS=blocked with BLOCKING_REASON pointing at the unreachable AC.
```

The agent returns:
```
STATUS: achieved | in_progress | blocked
CONFIDENCE: 0–100
NEXT_REQUIREMENTS: <bulleted spec, grouped for parallelism>
EVIDENCE: <file:line citations>
BLOCKING_REASON: <only when STATUS=blocked>
```

Routing:
- `achieved` → skip Steps 3–8, jump straight to **Done-Achieved**. No new commit this iteration.
- `blocked` → skip Steps 3–8, jump straight to **Done-Blocked**. No new commit.
- `in_progress` → continue to Step 3.

---

### Step 3 — Demand-driven pre-consult (parallel)

Scan `NEXT_REQUIREMENTS` text for domain triggers. For each triggered expert, spawn it **in one parallel message** alongside the others. If no trigger matches, skip Step 3 entirely.

| Trigger (keyword or path pattern in NEXT_REQUIREMENTS) | Expert |
|---|---|
| "IPC", "Tauri command", "invoke", `src-tauri/src/commands.rs`, `src/lib/tauri-commands.ts`, `src/store/*` | `architect-expert` |
| "React component", "hook", "Zustand", `src/components/`, `src/hooks/`, `src/store/` | `react-tauri-expert` |
| "file read", "file write", "path", "markdown render", `src-tauri/src/core/sidecar.rs`, `MarkdownViewer` | `security-reviewer` |
| "startup", "debounce", "throttle", "watcher", "large file", "render cost" | `performance-expert` |

Each expert prompt:

```
I'm about to plan iteration <N> for <MODE> <ref>.

Goal: <GOAL_FOR_ASSESSOR>
Next requirements (assessor output):
<NEXT_REQUIREMENTS>
Evidence:
<EVIDENCE>

From your area of expertise:
1. Key considerations for this iteration.
2. Risks or pitfalls to watch for.
3. Which files to modify and how.

Cite file:line for every recommendation. Cite rule numbers from docs/*.md when a rule applies. If the plan looks sound, say so in one line.
```

Collect any guidance into a short `ADVISORY_SUMMARY`. If no expert was spawned, `ADVISORY_SUMMARY = "none — no expert domains triggered"`.

---

### Step 4 — Plan

Spawn `general-purpose`:

```
Produce a comprehensive sprint plan for this iteration. Identify ALL changes needed to make the requested progress — do not artificially limit scope.

Goal: <GOAL_FOR_ASSESSOR>
Iteration: <N>/30
Mode: <MODE>
<Issue mode only:>
Spec excerpt (the contract):
<relevant sections of SPEC_MARKDOWN>
Remaining acceptance criteria:
<open AC bullets>
<End.>
Next requirements (assessor):
<NEXT_REQUIREMENTS>
Expert guidance:
<ADVISORY_SUMMARY>

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

Save the plan text as `PLAN`. Parse each group; label them `independent` or with their dependencies.

**If `risk=high`**: spawn `architect-expert`:
```
Identify the specific risks in this plan and propose concrete mitigations so it can proceed safely.
<Paste full PLAN here.>
```
Incorporate mitigations into a revised `PLAN` and continue. If the architect judges the approach fundamentally unsound, log `SKIPPED — architect rejected: <reason>` to the state file, go to Step 8 (skip 5–7), then advance iteration.

---

### Step 5 — Implement (parallel by plan group)

For each **independent group** in `PLAN`, spawn ONE `task-implementer`. Send ALL independent groups in one parallel message. Dependent groups wait for their dependency waves.

Each `task-implementer` prompt:

```
Implement this group of changes for mdownreview.

<Mode-specific header:>
Issue: #<ISSUE_NUMBER> — <ISSUE_TITLE>
OR
Goal: <GOAL_FOR_ASSESSOR>
<End.>

Iteration: <N>/30
Group: <group name and dependency note>
Files: <file list for this group>
Changes: <exact changes from PLAN>
Tests: <tests to write — unit + e2e if UI-visible>
Context: <relevant spec/goal excerpt>

Do NOT touch files outside this group. Do NOT ask clarifying questions — if ambiguous, make the conservative choice and note it.
Return Implementation Summary: files modified · tests written · decisions made · concerns.
```

Wait for each dependency wave before spawning the next. Collect every Implementation Summary.

If every implementer in this iteration reports "no changes made or needed": log `SKIPPED — no-op: <reason>` to the state file, do NOT commit or push, advance iteration.

---

### Step 6 — Push + race validate

#### 6a. Push immediately

```bash
git add <specific files reported by implementers — never git add -A blindly>
git commit -m "$COMMIT_MESSAGE"
git push
```

Commit message (see §Commit conventions for the full table):
- Issue mode: `feat(#<N>): iter <iteration> — <one-line summary>` with a 2-3 sentence body and `Refs #<N>` trailer.
- Goal mode: `auto-improve: iter <iteration> — <one-line summary>` with a 2-3 sentence body.
Both include `Co-authored-by: Claude Opus 4.7 <noreply@anthropic.com>`.

#### 6b. Local validation and CI poll (parallel)

Spawn both in ONE message:

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

**Agent B** — `general-purpose` (CI poller):
```
Poll CI status for PR <PR_NUMBER> every 30 seconds until all checks complete or 30 minutes elapse.
  gh pr checks <PR_NUMBER>
Stop when no check shows "pending" or "in_progress".
Return: PASS (all checks green) or FAIL (list of failed check names with their logs).
```

Wait for both.

#### 6c. Forward-fix loop (max 5 attempts)

Repeat until both PASS or 5 attempts exhausted:

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
   git commit -m "fix(iter-<iteration>): <one-line summary>"
   git push
   ```
3. Re-run 6b (local + CI in parallel).
4. If both PASS: break, proceed to Step 7.
5. If still failing after attempt 5: log `DEGRADED — could not fix validate/CI after 5 attempts: <summary>`. Do NOT revert commits — leave them for the next iteration's assessor. `degraded_count += 1`. Proceed to Step 7 anyway (expert review still runs).

---

### Step 7 — Expert diff review

Capture only THIS iteration's NEW diff:

```bash
git diff $ITER_BASE_SHA HEAD --stat
git diff $ITER_BASE_SHA HEAD
```

Spawn the **6-expert panel** in ONE parallel message:

- `product-improvement-expert`
- `performance-expert`
- `architect-expert`
- `react-tauri-expert`
- `ux-expert`
- `bug-hunter`

**Conditional experts** — include in the same parallel message when the diff matches:

| Condition (match ANY) | Also spawn |
|---|---|
| Diff touches `src-tauri/src/commands.rs`, `src-tauri/src/core/sidecar.rs`, any `Path`/`canonicalize` usage, or any markdown-rendering code under `src/components/viewers/` | `security-reviewer` |
| Diff changes test files, introduces a new UI-visible behaviour without a matching `e2e/browser/` addition, or adds a new Tauri command whose mock in `src/__mocks__/@tauri-apps/api/core.ts` is not updated in the same diff | `test-gap-reviewer` |

Each expert prompt:

```
Review this iteration's diff for mdownreview.

<Mode-specific header:>
Issue: #<ISSUE_NUMBER> — <ISSUE_TITLE>
OR
Goal: <GOAL_FOR_ASSESSOR>
<End.>

Iteration: <N>/30
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

Wait for ALL experts.

**If any BLOCK**: spawn `task-implementer` with the union of blocking issues:

```
Fix the following blocking review issues. Do not revert — forward fix.
<For each blocking issue: expert name, file:line, rule citation, fix direction>

Make the minimal change that satisfies each blocker. Do NOT reopen approved concerns.
Return Implementation Summary.
```

Commit + push (`fix(iter-<iteration>): <summary>`), then re-run Step 6b (local validation + CI poll). Then re-run the SAME expert panel on the updated iteration diff (re-capture `git diff $ITER_BASE_SHA HEAD`).

If experts still BLOCK after ONE fix round: log `DEGRADED — expert review: <issue summaries>`. `degraded_count += 1`. Do NOT revert. Proceed to Step 8.

---

### Step 8 — Record iteration

Append to `.claude/iterate-state.md`:

```markdown
## Iteration <N> — <PASSED | DEGRADED | SKIPPED>
- Commits: <list of SHAs from ITER_BASE_SHA to HEAD>
- Validate+CI: <passed | fixed in K attempts | degraded after 5>
- Expert review: <A approved / B blocked — list>
- Goal assessor confidence: <%>
- Summary: <one sentence>
<if DEGRADED:>
- Carry-over issues: <bullet list — read by next iteration's assessor>
```

**Update PR body and progress**:

- Refresh the PR body's progress list:
  - Issue mode: tick any AC checkbox that this iteration's assessor confirmed or this iteration's implementers clearly satisfied (cross-reference their Implementation Summaries).
  - Goal mode: append the iteration's completed requirement groups as ticked items.
  - Use `gh pr edit <PR_NUMBER> --body "<updated body>"`.

- Post a progress comment:
  ```bash
  gh pr comment <PR_NUMBER> --body "$(cat <<'EOF'
  <!-- iterate-iter-<N> -->
  ### <✅ PASSED | ⚠️ DEGRADED | ⏭️ SKIPPED> Iteration <N>/30

  **Commits:** <short SHAs>
  **Files changed:** <count>
  **Tests added/updated:** <count>
  <Issue mode: **AC satisfied this iteration:** <bullet list>>
  <Goal mode: **Requirements completed:** <bullet list>>
  <If DEGRADED: **Carry-over:** <summary>>

  Next: iteration <N+1> (assessor will re-scan on rebase)
  EOF
  )"
  ```

`iteration += 1`. If `PASSED`, `passed_count += 1`.

**Termination check** (after 8):
- If `iteration > 30`: go to **Done-TimedOut**.
- Otherwise: return to Step 1 of the next iteration.

---

### Step 9 — Release-gate validation (FINAL step — runs ONLY on Done-Achieved path)

Triggered from **Done-Achieved** before the iterate PR is marked ready. Purpose: run the full Windows + macOS **Release Gate** workflow (real installers, signed builds, platform matrix) against the accumulated work. Release Gate only triggers on PRs whose branch starts with `release/`, so this step creates a companion mirror branch+PR at the iterate branch tip, validates there, and forward-fixes any failures on the **iterate branch** (not the mirror) so humans review a single PR.

#### 9a. Create release-validation branch and mirror PR

```bash
RELEASE_BRANCH="release/iterate-$(echo "$BRANCH" | sed 's|^[^/]*/||' | cut -c1-40)-$(date +%Y%m%d%H%M)"
git checkout -b "$RELEASE_BRANCH"
git push -u origin HEAD
git checkout "$BRANCH"

RELEASE_PR_URL=$(gh pr create --draft --base main --head "$RELEASE_BRANCH" \
  --title "validate-release: $PR_TITLE" \
  --body "$(cat <<'EOF'
Release-gate validation for #<PR_NUMBER>. Close with `gh pr close --delete-branch` after validation completes.
EOF
)")
RELEASE_PR_NUMBER=<parse the number from $RELEASE_PR_URL>
```

If `$RELEASE_BRANCH` already exists (e.g., a previous skill run crashed mid-step-9), halt as **Done-Blocked** with reason = `release-gate branch <RELEASE_BRANCH> already exists — delete it and re-run step 9 manually`. Do NOT overwrite.

Comment on the iterate PR:
```bash
gh pr comment <PR_NUMBER> --body "<!-- iterate-release-gate-start -->
⏳ Release-gate validation started on $RELEASE_PR_URL"
```

#### 9b. Poll CI + Release Gate on the mirror PR

Spawn `general-purpose`:
```
Poll CI and Release Gate status for PR <RELEASE_PR_NUMBER> every 60 seconds until all checks complete or 60 minutes elapse.
  gh pr checks <RELEASE_PR_NUMBER>
Stop when no check shows "pending" or "in_progress".
Return: PASS (all checks green) or FAIL (list of failed check names with their logs).
```

Release-gate jobs are slower than CI — use 60 min timeout (not 30) and 60 s poll interval (not 30).

#### 9c. Forward-fix loop (max 5 attempts)

On FAIL:

1. Spawn `task-implementer`:
   ```
   Fix the following Release Gate failures. Do not revert — forward fix.
   Failed checks: <names>
   Logs:
   <truncated logs>
   Prior attempts in this loop: <summaries>

   Edit files on the iterate branch (current working tree). Do NOT edit the release-mirror branch. Return Implementation Summary.
   ```
2. Commit + push on the **iterate branch**:
   ```bash
   git add <specific files>
   git commit -m "fix(iter-release): <one-line summary>"
   git push
   ```
3. Fast-forward the mirror branch to the iterate tip, then push (re-triggers Release Gate):
   ```bash
   git checkout "$RELEASE_BRANCH"
   git merge --ff-only "$BRANCH"
   git push
   git checkout "$BRANCH"
   ```
4. Re-run 9b.
5. PASS → proceed to 9d.
6. Still FAIL after attempt 5: halt as **Done-Blocked** with reason = `release-gate failure after 5 forward-fix attempts`. Leave mirror PR draft. Leave iterate PR draft.

#### 9d. Close the mirror PR on success

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
```bash
gh pr comment <PR_NUMBER> --body "<!-- iterate-release-gate-done -->
🟢 Release gate validated on commit <sha>. Mirror PR closed."
```

Proceed to Done-Achieved's "mark ready" step.

---

## Termination

Three specific points inside an iteration can terminate the loop:

1. **Step 1 aborts** (all rebase auto-resolution failed) → **Done-Blocked** with reason = merge-conflict. Steps 2–9 skipped.
2. **Step 2 returns `STATUS=achieved`** → **Done-Achieved** (runs Step 9 first). Steps 3–8 skipped this iteration.
3. **Step 2 returns `STATUS=blocked`** → **Done-Blocked**. Steps 3–9 skipped.

After a completed iteration (end of Step 8), if `iteration + 1 > 30`, exit via **Done-TimedOut**.

`DEGRADED` and `SKIPPED` iterations do NOT terminate. They count against `degraded_count` and the loop continues — the next iteration's assessor re-reads the code and will fold the carry-over in, OR re-flag it as `blocked` if structurally unfixable.

### Done-Achieved

**First, run Step 9 Release-gate validation.** If it halts, you are in Done-Blocked — do not continue here.

Once release gate passes:

```bash
gh pr ready <PR_NUMBER>
```

Refresh the PR body: tick every progress item, change summary to "Ready for review — goal achieved, release gate passed". In issue mode, ensure `Closes #<ISSUE_NUMBER>` remains in the body trailer.

Print:
```
✅ <MODE> — <ref>
   PR: <PR_URL> (ready for review, release gate passed)
   Branch: <BRANCH>
   Iterations: <passed_count> passed · <degraded_count> degraded
   Release-gate fix attempts: <K>
   Final assessor confidence: <%>
```

Exit.

### Done-Blocked

Leave PR in draft. Comment on the iterate PR:
```bash
gh pr comment <PR_NUMBER> --body "$(cat <<'EOF'
<!-- iterate-blocked -->
## ⚠️ Autonomous iteration halted at iteration <N>/30

**Reason:** <BLOCKING_REASON or rebase-conflict summary or release-gate reason>
**Last assessor evidence:** <EVIDENCE, if any>
<If rebase-conflict:>
**Conflicted files:** <list>
<End.>

Iterations 1..<N-1> are complete and pushed. This iteration needs human attention. After resolving the blocker, restart with `/iterate <same args>` (the branch must first be deleted) or continue manually on this branch.
EOF
)"
```

In issue mode, post the same message on the issue (use `<!-- iterate-blocked-issue -->`).

Print:
```
❌ <MODE> — <ref>
   Halted at iteration <N>/30
   Reason: <short>
   PR (draft): <PR_URL>
   Branch: <BRANCH>
```

Exit.

### Done-TimedOut

Leave PR in draft. Comment on the iterate PR:
```bash
gh pr comment <PR_NUMBER> --body "$(cat <<'EOF'
<!-- iterate-timeout -->
## ⏱ Iteration cap reached (30)

**Progress:** <passed_count> passed · <degraded_count> degraded
**Final assessor confidence:** <%>
**Last NEXT_REQUIREMENTS (work still open):**
<bulleted list>

Review the branch, then either merge what is ready, continue manually, or restart with `/iterate <args>` after adjusting scope.
EOF
)"
```

In issue mode, post the same message on the issue.

Print:
```
⏱  <MODE> — <ref>
   Cap reached after 30 iterations
   PR (draft, partial progress): <PR_URL>
   Branch: <BRANCH>
```

Exit.

---

## Halt semantics (summary)

The skill **halts the loop** only on:
- Step 2 returns `STATUS=blocked`
- Step 1 aborts after all auto-resolution strategies fail
- Iteration cap reached (30)
- Step 9 (Release Gate) fails after 5 forward-fix attempts
- Step 9 finds a pre-existing release-mirror branch

The skill **logs `DEGRADED` and continues** on:
- Validate/CI fails after 5 forward-fix attempts (Step 6)
- Expert review blocks after one forward-fix attempt (Step 7)

The skill **logs `SKIPPED` and continues** on:
- `risk=high` plan is rejected by `architect-expert` as fundamentally unsound (Step 4)
- Every implementer in an iteration reports "no-op" (Step 5)

The skill **halts before starting the loop** on:
- Dirty working tree at setup
- Pre-existing target branch
- Issue mode and issue has no `<!-- mdownreview-spec -->` comment
- Issue mode auto-pick finds no groomed issues

No other halts.

---

## Commit conventions

| Situation | Mode | Message |
|---|---|---|
| Iteration implementation commit | Issue | `feat(#<N>): iter <iteration> — <summary>\n\n<2-3 sentence body>\n\nRefs #<N>\n\nCo-authored-by: Claude Opus 4.7 <noreply@anthropic.com>` |
| Iteration implementation commit | Goal | `auto-improve: iter <iteration> — <summary>\n\n<2-3 sentence body>\n\nCo-authored-by: Claude Opus 4.7 <noreply@anthropic.com>` |
| Forward-fix commit inside an iteration | Either | `fix(iter-<iteration>): <summary>` |
| Rebase-repair commit | Either | `fix(rebase): <summary>` |
| Release-gate forward-fix | Either | `fix(iter-release): <summary>` |

There is no "final-iteration" commit. When Step 2 returns `achieved`, Steps 3–8 are skipped, so no new commit is produced. Issue closure on merge is driven by the `Closes #<N>` trailer in the PR body (set in Phase 0f), not by commit messages.

---

## Failure recovery

If the skill is interrupted mid-loop:

1. Read `.claude/iterate-state.md` for branch, PR, and last iteration.
2. Check out the loop branch: `git checkout <BRANCH>`.
3. If a rebase is in progress (`.git/rebase-merge` or `.git/rebase-apply` exists), complete or abort it before restarting.
4. Ensure rerere is enabled on the branch (idempotent):
   ```bash
   git config rerere.enabled true
   git config rerere.autoupdate true
   ```
5. Restart is NOT supported — the pre-flight check in Phase 0 halts on the existing branch. To resume the work itself, delete the in-flight branch and re-invoke `/iterate <same args>` — Step 1's rebase + Step 2's assessor will account for the already-committed work on the deleted branch's remote tip if it has been pushed.
