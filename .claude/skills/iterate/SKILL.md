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
