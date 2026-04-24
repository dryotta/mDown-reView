---
name: self-improve-loop
description: Autonomous improvement loop for mdownreview. Takes a user goal, runs up to 10 review→plan→implement→validate iterations until the goal is achieved or the limit is reached. Experts re-assess from scratch each iteration to avoid anchoring bias.
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
Wait for the user to provide it before continuing.

### 0b. Pre-flight checks
Run in parallel:
```bash
git status --porcelain
git branch --show-current
git rev-parse HEAD
cat .claude/self-improve-loop-state.md 2>/dev/null || echo "no prior state"
```

- **If dirty working tree**: stop — "Commit or stash changes first, then retry."
- **If not on `main`**: stop — "Switch to main before starting the loop."

### 0c. Clarification (max 3 questions, one message)
Read the goal. If any of the following are genuinely unclear, ask them all in one message — then wait for answers before proceeding:
1. **Success criteria** — how will you know the goal is fully achieved?
2. **Scope** — which areas of the codebase are in bounds? (ask only if ambiguous)
3. **Constraints** — any files or behaviours that must not change?

If the goal is self-evident (e.g., "fix TypeScript errors", "move X to Rust"), state your assumptions and proceed without asking.

### 0d. Initialise state file
Write `.claude/self-improve-loop-state.md`:
```markdown
---
goal: "[goal text]"
started_at: [ISO datetime]
head_sha: [HEAD SHA]
max_iterations: 10
---
# Iteration Log
```

Print:
```
[self-improve-loop] Goal: [goal]
Starting autonomous loop — max 10 iterations. No further interaction needed.
```

---

## Phase 1 — Iteration Loop (repeat steps A–G up to 10 times)

Track: `iteration=1`, `passed_count=0`. Loop while `iteration ≤ 10`.

---

### Step A — Goal Assessment

Spawn a **`goal-assessor`** agent. Pass:
- The goal verbatim
- Current iteration number and `passed_count`
- The Iteration Log section from `.claude/self-improve-loop-state.md`
- `"Read the codebase from scratch. Ignore any prior requirement specs. Assess whether the goal is fully achieved and, if not, write the requirement spec for the next implementation step."`

The agent returns a structured block:
```
STATUS: achieved | in_progress | blocked
CONFIDENCE: 0–100
NEXT_REQUIREMENTS: [bulleted spec — omit if achieved or blocked]
EVIDENCE: [file:line citations showing current state vs. goal]
BLOCKING_REASON: [if blocked only]
```

- **STATUS=achieved**: append final iteration to state file, jump to **Done — Achieved**.
- **STATUS=blocked**: append to state file, jump to **Done — Blocked**.
- **STATUS=in_progress**: continue to Step B.

---

### Step B — Implementation Plan

Spawn a **`general-purpose`** agent. Pass:
- The goal
- NEXT_REQUIREMENTS from Step A
- EVIDENCE from Step A
- `"Produce a focused implementation plan: specific files to change, what to add/remove/modify in each, which tests to write. Rate overall risk: low | medium | high. Be concise — one plan section per changed file.

Non-negotiable completeness rules for the plan:
- Every unit-level change gets a unit test. Every UI-visible behaviour change also gets a browser e2e test in e2e/browser/.
- Every new Tauri command must update: commands.rs + tauri-commands.ts + the IPC mock in src/__mocks__/@tauri-apps/api/core.ts.
- Any code made obsolete by this change (replaced functions, dead imports, superseded patterns) must be deleted in the same plan step — not left as cleanup for later.
- No TODO comments, no half-wired code, no workarounds. If the complete solution requires touching something risky, rate the plan high risk instead of cutting corners."`

Save the plan output.

**If risk=high**: log `SKIPPED — high risk: [reason]`, increment `iteration`, continue loop.

---

### Step C — Branch + Implement

Create a branch:
```bash
git checkout -b auto-improve/loop-[N]-[3-word-slug-from-plan]
```

Spawn a **`task-implementer`** agent. Pass:
- The implementation plan from Step B
- The goal
- `"Write tests for every behavioural change before implementing it. Return an Implementation Summary listing all changed files and test names."`

**If implementer reports no changes or failure**: log `FAILED — implementer: [reason]`, clean up branch:
```bash
git checkout main && git branch -D [branch]
```
Increment `iteration`, continue loop.

---

### Step D — Local Validation

Spawn an **`implementation-validator`** agent. Pass:
- The list of changed files from Step C
- `"Run: lint, TypeScript type-check, Rust cargo test (if Rust files changed), Vitest unit tests, Playwright browser e2e tests. Return PASS or FAIL with full output."`

**If FAIL**: log `FAILED — local validation: [summary]`, clean up:
```bash
git checkout main && git branch -D [branch]
```
Increment `iteration`, continue loop.

---

### Step E — CI Validation

Push the branch and open a draft PR:
```bash
git push -u origin HEAD
gh pr create \
  --title "auto-improve: [goal slug] — iteration [N]" \
  --body "Autonomous improvement iteration [N]/10. Goal: [goal]" \
  --draft
```
Save the PR number.

Poll CI until all checks complete or 20 minutes elapse (poll every 30 s):
```bash
gh pr checks [PR-number]
```
Stop polling when output contains no `pending` or `in_progress` lines.

**If any check failed or timed out**: log `FAILED — CI: [failed check names]`, close and clean up:
```bash
gh pr close [PR-number] --delete-branch
git checkout main
```
Increment `iteration`, continue loop.

---

### Step F — Expert Diff Review (parallel)

Capture the diff:
```bash
git diff main --stat
git diff main
```

Spawn **all 6 expert agents in a single message** (one Agent call each, all in parallel):
- `product-improvement-expert`
- `performance-expert`
- `architect-expert`
- `react-tauri-expert`
- `ux-expert`
- `bug-hunter`

Each agent receives the same prompt:
```
Review this diff for mdownreview.
Goal: [goal]
Iteration: [N]/10

[DIFF STAT]

[FULL DIFF]

From your area of expertise, answer all of these — BLOCK on any "no":
1. Does this change make progress toward the goal?
2. Does it introduce any new bugs, regressions, or architectural problems?
3. Is every UI-visible behaviour change covered by a browser e2e test in e2e/browser/ (not just unit tests)?
4. Is there any dead code, unused import, replaced function, or obsolete pattern that was NOT deleted?
5. Does this change introduce technical debt — TODO comments, half-wired code, bypassed safety checks, or workarounds?

Return: APPROVE or BLOCK, then a one-paragraph explanation with file:line evidence for any BLOCK.
```

Wait for all 6.

**If any agent returns BLOCK**: log `FAILED — expert review blocked by [agents]: [reasons]`, close PR:
```bash
gh pr close [PR-number] --delete-branch
git checkout main
```
Increment `iteration`, continue loop.

**If all 6 return APPROVE (or only flag minor suggestions)**: record suggestions, continue to Step G.

---

### Step G — Record Outcome

Append to `.claude/self-improve-loop-state.md`:
```markdown
## Iteration [N] — PASSED
- Branch: [branch]
- PR: [URL]
- CI: passed
- Expert review: [N/6 approved, suggestions: [list or none]]
- Goal assessor confidence: [%]
- Summary: [one sentence from expert consensus]
```

Increment `passed_count` and `iteration`. Continue loop.

---

## Done — Achieved

```
[self-improve-loop] Goal achieved after [N] iterations ([passed_count] passed).
Goal: [goal]
Evidence: [EVIDENCE from final goal-assessor]

Open PRs ready to review and merge:
[list of PR URLs from all PASSED iterations]
```

---

## Done — Timed Out (iteration 10 complete, goal not yet achieved)

```
[self-improve-loop] Limit reached — 10 iterations complete.
Goal: [goal]
Progress: [passed_count] iterations passed, [goal-assessor confidence]% of goal achieved.

Open PRs (partial progress — review before merging):
[list of PR URLs]

Remaining work (from last goal-assessor NEXT_REQUIREMENTS):
[bulleted list]
```

---

## Done — Blocked

```
[self-improve-loop] Loop blocked at iteration [N].
Goal: [goal]
Reason: [BLOCKING_REASON from goal-assessor]

Resolve the blocker manually, then restart: /self-improve-loop [goal]
```

---

## Failure Recovery

If interrupted mid-loop:
1. Read `.claude/self-improve-loop-state.md` for the last iteration in progress.
2. If on an `auto-improve/loop-*` branch, clean up:
   ```bash
   gh pr close --delete-branch 2>/dev/null || true
   git checkout main
   ```
3. Restart: `/self-improve-loop [goal]` — the state file lets the goal-assessor pick up where progress left off.
