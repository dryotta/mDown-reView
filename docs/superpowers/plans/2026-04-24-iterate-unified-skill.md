# `/iterate` Unified Skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse `implement-issue`, `self-improve-loop`, and `start-feature` into a single `/iterate` skill that runs an autonomous iteration loop on one branch and one PR, validates via the full Release Gate before marking ready.

**Architecture:** One skill file (`.claude/skills/iterate/SKILL.md`) plus deletions of the three superseded skill directories. The new skill transcribes from the approved spec (`docs/superpowers/specs/2026-04-24-iterate-unified-skill-design.md`), lightly reshaped from descriptive prose to prescriptive steps. Updates to `AGENTS.md`, `BUILDING.md`, and any stray references bring the rest of the repo in sync. The state file `.claude/iterate-state.md` is added to `.gitignore`.

**Tech Stack:** Markdown skill files, bash + GitHub CLI (`gh`), git + rerere, Claude Code agent dispatch via Task/Skill tools. No JS/TS/Rust code changes.

---

## File Structure

**Created:**
- `.claude/skills/iterate/SKILL.md` — the new runtime skill (~500–700 lines of prescriptive prose)

**Deleted (directory + all contents):**
- `.claude/skills/implement-issue/`
- `.claude/skills/self-improve-loop/`
- `.claude/skills/start-feature/`

**Deleted (file):**
- `.claude/self-improve-loop-state.md` (last-run artifact from previous skill)

**Modified:**
- `AGENTS.md` — `/start-feature`, `/implement-issue`, `/self-improve-loop` references → `/iterate`
- `BUILDING.md` — replace three skill subsections with one `/iterate` subsection
- `.gitignore` — add `.claude/iterate-state.md`
- CLAUDE.md / README.md — grep-audit and swap references
- Any other skill that mentions a removed skill name

---

## Task 1: Set up working branch

**Files:** git state only.

- [ ] **Step 1: Confirm a clean tree and capture current branch**

Run:
```bash
git status --porcelain
git branch --show-current
```
Expected: no output from `status --porcelain`; the branch name is whatever the previous brainstorming session left us on. If the tree is dirty, stop and surface this to the user — the plan assumes a clean tree.

- [ ] **Step 2: Sync main**

Run:
```bash
git fetch origin main
git checkout main
git pull --ff-only
```
Expected: `main` now at `origin/main`.

- [ ] **Step 3: Create the feature branch for this work**

Run:
```bash
git checkout -b feature/unify-iterate-skill
```
Expected: `git branch --show-current` prints `feature/unify-iterate-skill`.

- [ ] **Step 4: Stage and commit the already-written spec doc**

The spec (`docs/superpowers/specs/2026-04-24-iterate-unified-skill-design.md`) was written during the brainstorming phase. It is currently untracked. Stage and commit it first so the implementation commits can reference a landed spec.

Run:
```bash
git add docs/superpowers/specs/2026-04-24-iterate-unified-skill-design.md
git commit -m "docs: /iterate unified-skill design spec

Supersedes implement-issue, self-improve-loop, and start-feature.
Single skill, assessor-driven iterations, 6-expert review per iter,
release-gate validation on Done-Achieved."
```
Expected: one new commit on `feature/unify-iterate-skill`.

- [ ] **Step 5: Also stage and commit this plan**

Run:
```bash
git add docs/superpowers/plans/2026-04-24-iterate-unified-skill.md
git commit -m "docs: /iterate implementation plan"
```
Expected: two commits ahead of `main`.

---

## Task 2: Scaffold the new skill directory and SKILL.md frontmatter

**Files:**
- Create: `.claude/skills/iterate/SKILL.md`

- [ ] **Step 1: Create the directory and empty file**

Run:
```bash
mkdir -p .claude/skills/iterate
```
Expected: `.claude/skills/iterate/` exists, empty.

- [ ] **Step 2: Write the frontmatter, title, and product-charter reference block**

Create `.claude/skills/iterate/SKILL.md` with EXACTLY this content:

```markdown
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
```

- [ ] **Step 3: Verify the scaffold**

Run:
```bash
cat .claude/skills/iterate/SKILL.md | head -60
```
Expected: frontmatter block + `# Iterate` header + RIGID notice + Product charter block + Input table.

- [ ] **Step 4: Commit**

Run:
```bash
git add .claude/skills/iterate/SKILL.md
git commit -m "feat(skills/iterate): scaffold with frontmatter, charter, and input table"
```

---

## Task 3: Write Phase 0 — Setup

**Files:**
- Modify: `.claude/skills/iterate/SKILL.md` (append)

- [ ] **Step 1: Append Phase 0 (setup) block**

Append to `.claude/skills/iterate/SKILL.md`:

````markdown

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
````

- [ ] **Step 2: Verify the addition — spec coverage for §1 and §2 of the design doc**

Read back the file and confirm 0a–0h correspond 1:1 to spec §1.2–§2.6. Any divergence is a mistake — fix it now.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/iterate/SKILL.md
git commit -m "feat(skills/iterate): Phase 0 setup (pre-flight, branch, draft PR, state file)"
```

---

## Task 4: Write Step 1 — Rebase sync with rerere + auto-resolution

**Files:**
- Modify: `.claude/skills/iterate/SKILL.md` (append)

- [ ] **Step 1: Append Step 1 block**

Append:

````markdown

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
````

- [ ] **Step 2: Verify §3.1 coverage — rerere enabled, diff3 markers, 3 attempts + 1 architect, post-rebase sanity gate**

Skim the appended section; it must mention rerere, diff3, `max_attempts_per_commit=3`, the architect-expert escalation, and the `tsc --noEmit` + `cargo check` gate.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/iterate/SKILL.md
git commit -m "feat(skills/iterate): Step 1 rebase sync with rerere + auto-resolution"
```

---

## Task 5: Write Steps 2 + 3 + 4 — Assess, Pre-consult, Plan

**Files:**
- Modify: `.claude/skills/iterate/SKILL.md` (append)

- [ ] **Step 1: Append Step 2 (Assess)**

Append:

````markdown

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
````

- [ ] **Step 2: Append Step 3 (Demand-driven pre-consult)**

Append:

````markdown

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
````

- [ ] **Step 3: Append Step 4 (Plan)**

Append:

````markdown

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
````

- [ ] **Step 4: Verify spec §3.2, §3.3, §3.4 are covered. Check that the goal-assessor returns the four STATUS/CONFIDENCE/NEXT_REQUIREMENTS/EVIDENCE fields.**

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/iterate/SKILL.md
git commit -m "feat(skills/iterate): Steps 2-4 assess, pre-consult, plan"
```

---

## Task 6: Write Steps 5 + 6 — Implement, Push+Validate, Fix-loop

**Files:**
- Modify: `.claude/skills/iterate/SKILL.md` (append)

- [ ] **Step 1: Append Step 5 (Implement)**

Append:

````markdown

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
````

- [ ] **Step 2: Append Step 6 (Push + race validate + forward-fix)**

Append:

````markdown

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
````

- [ ] **Step 3: Verify §3.5 and §3.6 spec coverage**

Confirm: parallel independent groups, 6 local suites, 5-attempt fix loop, never abort/revert.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/iterate/SKILL.md
git commit -m "feat(skills/iterate): Steps 5-6 implement, push, race-validate, fix-loop"
```

---

## Task 7: Write Step 7 — Expert review (6-panel + conditional)

**Files:**
- Modify: `.claude/skills/iterate/SKILL.md` (append)

- [ ] **Step 1: Append Step 7**

Append:

````markdown

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
````

- [ ] **Step 2: Verify §3.7 — 6 unconditional + 2 conditional, one fix round, no revert**

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/iterate/SKILL.md
git commit -m "feat(skills/iterate): Step 7 expert diff review (6-panel + conditional)"
```

---

## Task 8: Write Step 8 — Record iteration

**Files:**
- Modify: `.claude/skills/iterate/SKILL.md` (append)

- [ ] **Step 1: Append Step 8**

Append:

````markdown

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
````

- [ ] **Step 2: Verify §3.8 coverage + mode-specific PR-body tick behaviour**

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/iterate/SKILL.md
git commit -m "feat(skills/iterate): Step 8 record iteration + PR progress update"
```

---

## Task 9: Write Step 9 — Release-gate validation (final step on Done-Achieved)

**Files:**
- Modify: `.claude/skills/iterate/SKILL.md` (append)

- [ ] **Step 1: Append Step 9 block**

Append:

````markdown

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
````

- [ ] **Step 2: Verify §3.10 coverage — mirror branch naming, 60 min timeout, fast-forward, 5-attempt fix, --delete-branch on success**

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/iterate/SKILL.md
git commit -m "feat(skills/iterate): Step 9 release-gate validation (mirror branch + Release Gate)"
```

---

## Task 10: Write Termination paths, halt semantics, failure recovery

**Files:**
- Modify: `.claude/skills/iterate/SKILL.md` (append)

- [ ] **Step 1: Append Termination section**

Append:

````markdown

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
````

- [ ] **Step 2: Verify spec §4, §5, §6 are all covered in the appended block. Also confirm the commit-conventions table includes the `fix(iter-release):` row added for Step 9.**

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/iterate/SKILL.md
git commit -m "feat(skills/iterate): termination, halt semantics, commit conventions, failure recovery"
```

---

## Task 11: Read-through self-review of the complete SKILL.md

**Files:**
- Read: `.claude/skills/iterate/SKILL.md`
- Read: `docs/superpowers/specs/2026-04-24-iterate-unified-skill-design.md`

- [ ] **Step 1: Read the full SKILL.md top-to-bottom**

Run:
```bash
wc -l .claude/skills/iterate/SKILL.md
```
Expected: 500–900 lines. If under 400, something is missing.

Open the file and read all of it without stopping. Look for:
- **Placeholders**: `TBD`, `TODO`, `...`, `<fill in>`, `XXX`.
- **Dangling references**: an agent name, file path, or variable (`$BRANCH`, `$PR_NUMBER`, etc.) used but never introduced.
- **Internal contradictions**: e.g. one step says "max 3 attempts" and another says "max 5 attempts" for the same loop.
- **Spec drift**: a step that silently changes behaviour from the spec.

- [ ] **Step 2: Spec coverage checklist**

For each subsection of the design spec, confirm the SKILL.md has a corresponding concrete step:

| Spec section | SKILL.md step |
|---|---|
| §1.1 Invocation | Input table |
| §1.2 Intent detection | Phase 0a |
| §1.3 Auto-pick | Phase 0c |
| §1.4 Mode-specific parameters | Phase 0e table |
| §2.2 Pre-flight | Phase 0b |
| §2.3 Spec load | Phase 0d |
| §2.4 Branch + draft PR | Phase 0f |
| §2.5 State file init | Phase 0g |
| §2.6 Banner | Phase 0h |
| §3.1 Rebase with rerere + sanity gate | Step 1 |
| §3.2 Assess | Step 2 |
| §3.3 Pre-consult | Step 3 |
| §3.4 Plan | Step 4 |
| §3.5 Implement | Step 5 |
| §3.6 Push + race validate + fix-loop | Step 6 |
| §3.7 Expert review | Step 7 |
| §3.8 Record | Step 8 |
| §3.9 Commit conventions | Commit conventions table |
| §3.10 Release-gate validation | Step 9 |
| §4.1 Done-Achieved | Termination block |
| §4.2 Done-Blocked | Termination block |
| §4.3 Done-TimedOut | Termination block |
| §5 Halt semantics | Halt semantics summary |
| §6 Failure recovery | Failure recovery block |

If any row has no corresponding step, STOP and write the missing step.

- [ ] **Step 3: Fix any issues inline**

No additional review loop — edit the file in place for any problems found.

- [ ] **Step 4: Commit (only if edits were needed)**

```bash
git add .claude/skills/iterate/SKILL.md
git commit -m "fix(skills/iterate): address self-review findings"
```

If no edits were needed, skip this step — do not make an empty commit.

---

## Task 12: Delete the three superseded skill directories and the stale state file

**Files:**
- Delete: `.claude/skills/implement-issue/` (entire directory)
- Delete: `.claude/skills/self-improve-loop/` (entire directory)
- Delete: `.claude/skills/start-feature/` (entire directory)
- Delete: `.claude/self-improve-loop-state.md`

- [ ] **Step 1: Verify targets exist**

Run:
```bash
ls -la .claude/skills/implement-issue/ .claude/skills/self-improve-loop/ .claude/skills/start-feature/
ls -la .claude/self-improve-loop-state.md
```
Expected: all exist.

- [ ] **Step 2: Remove them**

Run:
```bash
git rm -r .claude/skills/implement-issue
git rm -r .claude/skills/self-improve-loop
git rm -r .claude/skills/start-feature
git rm .claude/self-improve-loop-state.md
```

If `.claude/self-improve-loop-state.md` is not tracked by git (possible — it's a runtime artifact), replace the last line with `rm -f .claude/self-improve-loop-state.md`.

- [ ] **Step 3: Verify the delete is staged**

Run:
```bash
git status
```
Expected: three deleted directories' SKILL.md files and the state file shown as `deleted:`. No unexpected files.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(skills): remove implement-issue, self-improve-loop, start-feature (superseded by /iterate)"
```

---

## Task 13: Add `.claude/iterate-state.md` to `.gitignore`

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Read the current .gitignore**

Run:
```bash
cat .gitignore
```
Note the section that contains `.claude/settings.local.json` — that's where `.claude/iterate-state.md` belongs (same rationale: per-user runtime state).

- [ ] **Step 2: Add the line**

Locate this existing line:
```
.claude/settings.local.json
```

Insert immediately AFTER it:
```
.claude/iterate-state.md
```

- [ ] **Step 3: Verify**

Run:
```bash
grep iterate-state .gitignore
```
Expected: one hit: `.claude/iterate-state.md`.

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore .claude/iterate-state.md (runtime state for /iterate)"
```

---

## Task 14: Update `AGENTS.md` skill references

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Find references**

Run:
```bash
grep -n -E "start-feature|implement-issue|self-improve-loop" AGENTS.md
```
Record every line and column.

- [ ] **Step 2: Inspect each hit and replace**

For each line from Step 1, open `AGENTS.md` and replace the reference with `/iterate`, adjusting surrounding prose so it still makes sense. Examples:

- "Use `/start-feature` before starting a task" → "Use `/iterate` for autonomous issue/goal work; for hand-coded changes, `git checkout -b feature/<slug>` from main is sufficient."
- "`/implement-issue` autonomously implements a groomed issue" → "`/iterate <issue-number>` autonomously implements a groomed issue end-to-end on one branch, one PR."
- "`/self-improve-loop <goal>` runs iterations toward a goal" → "`/iterate <goal text>` runs iterations toward a goal."
- If the section lists skills in a table: replace all three rows with a single `/iterate` row.

- [ ] **Step 3: Verify no stale references remain**

Run:
```bash
grep -n -E "start-feature|implement-issue|self-improve-loop" AGENTS.md
```
Expected: no output (empty result).

- [ ] **Step 4: Read through the edited sections**

Read the modified sections of `AGENTS.md` to confirm the prose is coherent.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md
git commit -m "docs(AGENTS): replace start-feature/implement-issue/self-improve-loop with /iterate"
```

---

## Task 15: Update `BUILDING.md` skill sections

**Files:**
- Modify: `BUILDING.md`

- [ ] **Step 1: Locate the three subsections**

Run:
```bash
grep -n -E "^#### \`?/(start-feature|implement-issue|self-improve-loop)" BUILDING.md
```
Record the line range for each of the three subsections (each runs from its `####` heading until the next `####` or `###` heading).

- [ ] **Step 2: Remove the three subsections**

Open `BUILDING.md` in an editor and delete the three complete subsections (heading + body + trailing `---` separator).

- [ ] **Step 3: Insert a single `/iterate` subsection**

At the position where `/start-feature` used to be (alphabetically earliest or by logical order — pick whichever the surrounding list uses), insert:

```markdown
#### `/iterate`

Autonomously implements a GitHub issue or drives improvement toward a free-text goal, end-to-end, on a single branch and single PR. Replaces `/start-feature`, `/implement-issue`, and `/self-improve-loop`.

**What it does:**
1. Picks the mode from the argument shape — bare number / `#N` / `issue-N` / issue URL is issue mode; empty is auto-pick oldest groomed issue; anything else is goal mode with that text as the goal.
2. Creates a feature branch (`feature/issue-<N>-<slug>` or `auto-improve/<slug>-<date>`) and opens a draft PR.
3. Runs up to 30 iterations of: rebase-with-rerere → goal-assessor → demand-driven pre-consult experts → plan → parallel implement → push + race local validation against CI → 6-expert diff review → record.
4. Forward-fixes every failure instead of aborting (validate/CI up to 5 attempts, expert review one round).
5. On success, mirrors the branch tip to `release/iterate-<slug>-<timestamp>`, opens a draft mirror PR to trigger the Release Gate workflow, forward-fixes any platform-matrix failures (5 attempts), then closes the mirror PR and marks the iterate PR ready.

**When to use:**
- Any groomed GitHub issue: `/iterate 42` (or `/iterate` to auto-pick the oldest groomed issue)
- Any free-text improvement goal: `/iterate eliminate all ESLint warnings in the codebase`

Do NOT use for: manual spike work (a plain `git checkout -b feature/<slug>` is faster), reviews (use `/review`), releases (use `/publish-release`).
```

- [ ] **Step 4: Verify no stale references remain**

Run:
```bash
grep -n -E "start-feature|implement-issue|self-improve-loop" BUILDING.md
```
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add BUILDING.md
git commit -m "docs(BUILDING): replace three skill subsections with /iterate"
```

---

## Task 16: Grep-audit for any remaining references

**Files:**
- Potentially: `CLAUDE.md`, `README.md`, any file under `docs/`, any file under `.claude/`

- [ ] **Step 1: Find all remaining references**

Run:
```bash
grep -rn -E "start-feature|implement-issue|self-improve-loop" \
  --include='*.md' \
  --exclude-dir=node_modules \
  --exclude-dir=.git \
  --exclude-dir=dist \
  --exclude-dir=target \
  .
```

Hits to IGNORE (these are historical and correct):
- Anything inside `docs/superpowers/specs/` (spec archive — historical)
- Anything inside `docs/superpowers/plans/` older than today's date
- Our own spec and plan written today (they intentionally mention the skills they replace)
- Anything inside `.git/`

Hits to FIX:
- Any active skill file at `.claude/skills/<other>/SKILL.md`
- `CLAUDE.md` if it references the removed skills
- `README.md`
- Any other live documentation

- [ ] **Step 2: Fix each active reference**

For each hit that should be fixed:
- If it mentions `/start-feature`: rewrite to "use `/iterate` for autonomous work; for hand-coded changes, `git checkout -b feature/<slug>` from main suffices".
- If it mentions `/implement-issue`: rewrite to `/iterate <issue-number>`.
- If it mentions `/self-improve-loop`: rewrite to `/iterate <goal text>`.
- If the hit is a cross-skill recommendation inside another SKILL.md, keep the semantics but update the name.

- [ ] **Step 3: Re-grep to confirm**

Run the same grep as Step 1. Remaining hits must all be in the IGNORE list above.

- [ ] **Step 4: Commit (only if edits were needed)**

```bash
git add <files>
git commit -m "docs: sweep stray references to removed skills"
```

If there were no edits (everything was in the IGNORE list), skip this step.

---

## Task 17: Smoke test the new skill's halt path

**Files:** none (verification only).

The skill can't be fully exercised without running a real iteration loop, but the halt paths are fast, cheap, and deterministic. Exercise them to confirm the skill file parses and the early-exit branches work.

- [ ] **Step 1: Verify the skill is discoverable**

Run:
```bash
ls .claude/skills/iterate/SKILL.md
head -6 .claude/skills/iterate/SKILL.md
```
Expected: the file exists and starts with frontmatter (`---` line, then `name: iterate`, `description: …`, closing `---`).

- [ ] **Step 2: Verify no syntax issues in frontmatter**

The frontmatter's `name:` field must be `iterate` (lowercase) and the `description:` field must be one line. If the description wraps, re-fold it.

- [ ] **Step 3: Dry-run the pre-flight halt path mentally**

Walk through Phase 0b manually from a dirty tree. Confirm the skill prints the exact string:
```
[iterate] Working tree is dirty. Commit or stash changes first.
```
and does NOT attempt any git operations beyond `git status --porcelain` and `git branch --show-current`.

- [ ] **Step 4: Dry-run the auto-pick "no groomed issues" halt path**

Walk through Phase 0a → 0c with empty `ARG`. Confirm the skill prints:
```
[iterate] No groomed issues found. Run /groom-issues first, or call /iterate with a goal.
```

- [ ] **Step 5: Dry-run the intent-detection table**

Trace these inputs through Phase 0a's rule table; each should resolve to the listed mode:

| Input | Expected mode / number |
|---|---|
| (empty) | issue, auto-pick |
| `42` | issue, #42 |
| `#42` | issue, #42 |
| `issue-42` | issue, #42 |
| `Issue-42` | issue, #42 |
| `https://github.com/foo/bar/issues/7` | issue, #7 |
| `https://github.com/foo/bar/issues/7#issuecomment-123` | issue, #7 |
| `eliminate all ESLint warnings` | goal, that text |
| `"quoted free text"` | goal, `quoted free text` (quotes stripped) |
| `fix issue 42 differently` | goal, that text (falls through to rule 6) |

If any row misroutes, FIX the rule table in Phase 0a and re-run this step.

- [ ] **Step 6: Commit (only if edits were needed)**

```bash
git add .claude/skills/iterate/SKILL.md
git commit -m "fix(skills/iterate): correct intent detection rules found in smoke test"
```

If no edits: skip.

---

## Task 18: Push branch, open PR, link to spec

**Files:** git state only.

- [ ] **Step 1: Sanity check the commit history**

Run:
```bash
git log --oneline main..HEAD
```
Expected: roughly these commits in order (titles may vary slightly):
1. `docs: /iterate unified-skill design spec`
2. `docs: /iterate implementation plan`
3. `feat(skills/iterate): scaffold with frontmatter, charter, and input table`
4. `feat(skills/iterate): Phase 0 setup (…)`
5. `feat(skills/iterate): Step 1 rebase sync with rerere + auto-resolution`
6. `feat(skills/iterate): Steps 2-4 assess, pre-consult, plan`
7. `feat(skills/iterate): Steps 5-6 implement, push, race-validate, fix-loop`
8. `feat(skills/iterate): Step 7 expert diff review (6-panel + conditional)`
9. `feat(skills/iterate): Step 8 record iteration + PR progress update`
10. `feat(skills/iterate): Step 9 release-gate validation (mirror branch + Release Gate)`
11. `feat(skills/iterate): termination, halt semantics, commit conventions, failure recovery`
12. (optional) `fix(skills/iterate): address self-review findings`
13. `chore(skills): remove implement-issue, self-improve-loop, start-feature (superseded by /iterate)`
14. `chore: gitignore .claude/iterate-state.md (runtime state for /iterate)`
15. `docs(AGENTS): replace start-feature/implement-issue/self-improve-loop with /iterate`
16. `docs(BUILDING): replace three skill subsections with /iterate`
17. (optional) `docs: sweep stray references to removed skills`
18. (optional) `fix(skills/iterate): correct intent detection rules found in smoke test`

- [ ] **Step 2: Push**

```bash
git push -u origin HEAD
```
Expected: branch `feature/unify-iterate-skill` created on origin.

- [ ] **Step 3: Open the PR**

```bash
gh pr create --title "feat(skills): unify /iterate — supersedes implement-issue, self-improve-loop, start-feature" \
  --body "$(cat <<'EOF'
## Summary

Collapses three overlapping skills into a single `/iterate` skill that runs an autonomous iteration loop on one branch and one PR.

**Supersedes and deletes:**
- `.claude/skills/implement-issue/`
- `.claude/skills/self-improve-loop/`
- `.claude/skills/start-feature/`

**Adds:**
- `.claude/skills/iterate/` — unified skill
- `.gitignore` entry for the runtime state file `.claude/iterate-state.md`

## What's new vs. what got deleted

| Old | Replaced by |
|---|---|
| `/implement-issue <N>` | `/iterate <N>` (also `/iterate #N`, `/iterate issue-N`, `/iterate <issue URL>`) |
| `/implement-issue` (no args) | `/iterate` (no args — auto-picks oldest groomed) |
| `/self-improve-loop "<goal>"` | `/iterate <goal text>` |
| `/start-feature` | `git checkout -b feature/<slug>` (the skill added no machinery beyond what a developer types) |

## Quality improvements over the old skills

- 6-expert review panel per iteration (vs 1 reviewer in `implement-issue`)
- Conditional `security-reviewer` + `test-gap-reviewer` when diff shape warrants
- Rebase-with-rerere + post-rebase `tsc --noEmit` + `cargo check` gate
- Validate + CI run in parallel (push-first) rather than serial
- Forward-fix all failures instead of phase-abort
- Adaptive scope — `goal-assessor` regenerates requirements each iteration instead of rigid pre-parsed phases
- Release Gate validation on the success path before marking PR ready

## Docs

- Design spec: `docs/superpowers/specs/2026-04-24-iterate-unified-skill-design.md`
- Implementation plan: `docs/superpowers/plans/2026-04-24-iterate-unified-skill.md`

## Test plan

- [ ] /iterate (no args, clean tree, no groomed issues) prints the expected "No groomed issues found" halt message
- [ ] /iterate (dirty tree) prints the expected "Working tree is dirty" halt message
- [ ] /iterate 42 correctly parses to issue mode (manually trace the detection table)
- [ ] /iterate "some goal" correctly parses to goal mode
- [ ] BUILDING.md renders correctly — no orphan dividers, no broken anchors
- [ ] `grep -rn "start-feature\|implement-issue\|self-improve-loop" --include='*.md'` returns only historical spec/plan hits
EOF
)"
```

- [ ] **Step 4: Print the PR URL for the user**

Capture the URL from `gh pr create` output and surface it in the final response.

---

## Self-Review (this plan)

**Spec coverage:**
- §1 Skill surface → Tasks 2, 3
- §2 Phase 0 Setup → Task 3
- §3 Iteration loop (Steps 1–8) → Tasks 4, 5, 6, 7, 8
- §3.10 Release-gate validation → Task 9
- §4 Termination → Task 10
- §5 Halt semantics → Task 10
- §6 Failure recovery → Task 10
- §7 File and directory changes → Tasks 12 (deletes), 13 (.gitignore), 14 (AGENTS.md), 15 (BUILDING.md), 16 (sweep)
- §8 Risks → informational; no task required
- §9 Open questions (resolved) → informational; no task required

No spec section is unaddressed.

**Placeholder scan:** No TBDs. No "handle X" or "similar to Task N" stubs. Every step contains the actual bash command, agent prompt, or file content it needs.

**Type consistency:** Variable names used consistently across tasks (`BRANCH`, `PR_NUMBER`, `PR_URL`, `RELEASE_BRANCH`, `RELEASE_PR_NUMBER`, `RELEASE_PR_URL`, `ITER_BASE_SHA`, `GOAL_FOR_ASSESSOR`, `GOAL_TEXT`, `ISSUE_NUMBER`, `ISSUE_TITLE`, `ISSUE_BODY`, `SPEC_MARKDOWN`, `ACCEPTANCE_CRITERIA`, `NEXT_REQUIREMENTS`, `EVIDENCE`, `ADVISORY_SUMMARY`, `PLAN`). Agent names (`task-implementer`, `goal-assessor`, `architect-expert`, etc.) match `.claude/agents/`. Step numbering is stable: Phase 0 (0a–0h) then Step 1–9 plus Termination.
