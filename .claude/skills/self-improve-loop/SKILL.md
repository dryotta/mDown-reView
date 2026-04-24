---
name: self-improve-loop
description: Autonomous improvement loop for mdownreview. Takes a user goal, runs up to 10 review→plan→implement→validate iterations on a single branch until the goal is achieved or the limit is reached. All iterations share one branch and one PR. CI and all local tests must be green before each iteration advances.
---

# Self-Improve Loop

**RIGID skill. Follow every step exactly. Do not skip or reorder.**

Accepts one required argument: the improvement **goal** (text after the skill name).  
Example: `/self-improve-loop eliminate all ESLint warnings in the codebase`

---

## Phase 0 — Setup (interactive, runs once)

### 0a. Capture the goal
The goal is the text typed after the skill name. If empty, ask:
> "What improvement goal should I work toward?"
Wait for the user's answer before continuing.

### 0b. Pre-flight
Run in parallel:
```bash
git status --porcelain
git branch --show-current
git rev-parse HEAD
```
- **Dirty working tree**: STOP — "Commit or stash changes first, then retry."
- **Not on `main`**: STOP — "Switch to main before starting the loop."

### 0c. Clarification (max 3 questions, one message)
If any of the following are genuinely unclear, ask them all in one message then wait:
1. **Success criteria** — how will you know the goal is fully achieved?
2. **Scope** — which areas are in bounds? (only if ambiguous)
3. **Constraints** — any files or behaviours that must not change?

If the goal is self-evident, state your assumptions and proceed.

### 0d. Create the loop branch
```bash
SLUG=$(echo "[goal text]" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | cut -c1-40)
DATE=$(date +%Y%m%d)
BRANCH="auto-improve/${SLUG}-${DATE}"
git checkout -b "$BRANCH"
git commit --allow-empty -m "chore: start self-improve loop — [goal]"
git push -u origin HEAD
```

### 0e. Open a single draft PR
```bash
gh pr create \
  --title "auto-improve: [goal]" \
  --body "Autonomous improvement loop. Goal: [goal]

This PR accumulates commits from up to 10 iterations. Each iteration's changes are pushed incrementally. Do not merge until the loop completes and you have reviewed the full diff." \
  --draft
```
Save the PR number and URL.

### 0f. Initialise state file
Write `.claude/self-improve-loop-state.md`:
```markdown
---
goal: "[goal text]"
started_at: [ISO datetime]
branch: [branch name]
pr: [PR URL]
max_iterations: 10
---
# Iteration Log
```

Print:
```
[self-improve-loop] Goal: [goal]
Branch: [branch] | PR: [PR URL]
Starting autonomous loop — max 10 iterations. No further interaction needed.
```

---

## Phase 1 — Iteration Loop (repeat steps A–F up to 10 times)

Track: `iteration=1`, `passed_count=0`. Before each iteration, record:
```bash
ITER_BASE_SHA=$(git rev-parse HEAD)
```
This is the diff baseline for this iteration's expert review.

---

### Step A — Goal Assessment

Spawn **`goal-assessor`**. Pass: goal, iteration number, passed\_count, the Iteration Log from the state file.

Instruction: `"Read the codebase from scratch. Ignore prior specs. Assess whether the goal is fully achieved and, if not, write requirement specs for the next meaningful sprint — a coherent body of work that delivers visible progress toward the goal, not just the smallest possible next step. Group requirements by what can be implemented in parallel."`

Returns:
```
STATUS: achieved | in_progress | blocked
CONFIDENCE: 0–100
NEXT_REQUIREMENTS: [bulleted spec]
EVIDENCE: [file:line citations]
BLOCKING_REASON: [if blocked]
```

- **achieved** → append to state file, jump to **Done — Achieved**
- **blocked** → append to state file, jump to **Done — Blocked**
- **in_progress** → continue to Step B

---

### Step B — Implementation Plan

Spawn **`general-purpose`**. Pass: goal, NEXT\_REQUIREMENTS, EVIDENCE.

Prompt:
```
Produce a comprehensive sprint plan. Identify ALL changes needed to make a meaningful step toward the goal — do not artificially limit scope. Use the group structure from NEXT_REQUIREMENTS to organise the plan: independent groups can be implemented in parallel, dependent groups run after their dependencies.

For each group: files to change · exact changes · tests to write · dependencies on other groups.
Rate overall risk: low | medium | high.

Non-negotiable completeness rules:
- Every UI-visible behaviour change gets a browser e2e test in e2e/browser/ AND a native e2e test in e2e/native/ if the scenario requires real file I/O or IPC
- Every new Tauri command: update commands.rs + tauri-commands.ts + IPC mock in src/__mocks__/@tauri-apps/api/core.ts
- Delete any code made obsolete by this change in the same step
- No TODO comments, no half-wired code, no workarounds
```

Save the plan.

**If risk=high**: spawn `architect-expert` with the full plan and prompt: `"Identify the specific risks in this plan and propose concrete mitigations so it can proceed safely."` Incorporate the architect's mitigations into a revised plan and continue. Only log `SKIPPED — architect rejected: [reason]` and increment `iteration` if the architect judges the approach fundamentally unsound.

---

### Step C — Implement (parallel by plan group)

For each **independent group** in the plan, spawn one **`task-implementer`** — send all independent groups in **one parallel message**. For groups that depend on prior groups, wait for their dependencies to finish first, then spawn them.

Each `task-implementer` prompt:
```
Implement this group of changes for mdownreview:

Goal: [goal]
Group: [group name and dependency note]
Files: [file list for this group]
Changes: [exact changes from plan]
Tests: [tests to write — unit + e2e if UI-visible]

Do not touch files outside this group. Return Implementation Summary: files modified · tests written · decisions · concerns.
```

Wait for each dependency wave before spawning the next. Collect all Implementation Summaries.

**If any implementer reports no changes or failure**: log `FAILED — implementer [group]: [reason]`, increment `iteration`, continue loop (no commits to push).

---

### Step D — Push then Validate (race CI against local tests)

**D1 — Push immediately** to trigger CI:
```bash
git add -A  # implementer already staged only relevant files; verify first
git commit -m "auto-improve: iteration [N] — [one-line summary from plan]"
git push
```

**D2 — Spawn local validation and poll CI in parallel** (one message, two agents):

**Agent 1** — `implementation-validator`:
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

**Agent 2** — `general-purpose` (CI poller):
```
Poll CI status for PR [PR-number] until all checks are complete or 30 minutes elapse.
Poll interval: 30 seconds.
  gh pr checks [PR-number]
Stop when no check shows "pending" or "in_progress".
Return: PASS (all checks green) or FAIL (list of failed check names and their logs).
```

Wait for both agents.

**D3 — Evaluate results:**

| Local | CI | Action |
|---|---|---|
| PASS | PASS | Proceed to Step E |
| FAIL | any | Enter fix loop (Step D-Fix) |
| PASS | FAIL | Enter fix loop (Step D-Fix) |

---

### Step D-Fix — Forward Fix Loop (max 5 attempts)

Repeat until both local and CI pass, or 5 attempts exhausted:

1. Spawn **`task-implementer`** with the combined failure output:
   ```
   Fix the following failures. Do not revert — make a forward fix.
   Local failures: [full local output]
   CI failures: [failed check names and logs]
   Make the minimal change needed to resolve each failure.
   Return Implementation Summary of what you changed.
   ```

2. Commit and push the fix:
   ```bash
   git add <specific files from implementer>
   git commit -m "auto-improve: fix iteration [N] — [one-line fix description]"
   git push
   ```

3. Re-run local validation + CI poll in parallel (same as Step D2).

4. If both pass: exit fix loop, proceed to Step E.

5. If still failing after attempt 5: log `FAILED — could not fix after 5 attempts: [summary]`, increment `iteration`, continue loop. **Do not revert commits** — they stay on the branch for manual review.

---

### Step E — Expert Diff Review (parallel)

Capture only this iteration's changes:
```bash
git diff $ITER_BASE_SHA HEAD --stat
git diff $ITER_BASE_SHA HEAD
```

Spawn **all 6 expert agents in one message**:
- `product-improvement-expert`
- `performance-expert`
- `architect-expert`
- `react-tauri-expert`
- `ux-expert`
- `bug-hunter`

Each receives:
```
Review this iteration's diff for mdownreview.
Goal: [goal] | Iteration: [N]/10

[DIFF STAT]
[FULL DIFF]

BLOCK on any of these — APPROVE otherwise:
1. Does this make progress toward the goal?
2. New bugs, regressions, or architectural problems?
3. UI-visible change without a browser e2e test in e2e/browser/?
4. Dead code, unused import, or replaced pattern not deleted?
5. Technical debt — TODO comments, half-wired code, bypassed checks?

Return: APPROVE or BLOCK with file:line evidence for every BLOCK.
```

Wait for all 6.

**If any BLOCK**: spawn **`task-implementer`** with all blocking issues, commit + push the fix, re-run local validation + CI poll (same parallel pattern as D2), then re-run expert review once. If experts still BLOCK after one fix: log `FAILED — expert review: [issues]`, increment `iteration`, continue loop.

---

### Step F — Record Outcome

Append to `.claude/self-improve-loop-state.md`:
```markdown
## Iteration [N] — PASSED
- Commits: [list of SHAs from ITER_BASE_SHA to HEAD]
- CI: passed
- Local tests: all 6 suites passed
- Expert review: [N/6 approved, suggestions: [list or none]]
- Goal assessor confidence: [%]
- Fix attempts: [N]
- Summary: [one sentence]
```

Increment `passed_count` and `iteration`. Continue loop.

---

## Done — Achieved

```
[self-improve-loop] Goal achieved after [N] iterations ([passed_count] passed).
Goal: [goal]
Evidence: [EVIDENCE from final goal-assessor]

PR ready to review and merge: [PR URL]
All [N] iterations are on branch [branch]. CI is green.
```

---

## Done — Timed Out

```
[self-improve-loop] Limit reached — 10 iterations complete.
Goal: [goal]
Progress: [passed_count] passed, last confidence: [%]

PR (partial progress — review before merging): [PR URL]

Remaining work (from last NEXT_REQUIREMENTS):
[bulleted list]
```

---

## Done — Blocked

```
[self-improve-loop] Blocked at iteration [N].
Goal: [goal]
Reason: [BLOCKING_REASON]

PR so far: [PR URL]
Resolve the blocker then restart: /self-improve-loop [goal]
```

---

## Failure Recovery

If interrupted mid-loop:
1. Read `.claude/self-improve-loop-state.md` for the branch, PR, and last iteration.
2. Check out the loop branch: `git checkout [branch]`
3. Restart: `/self-improve-loop [goal]` — the goal-assessor reads the current code state fresh, so progress already committed is automatically accounted for.
