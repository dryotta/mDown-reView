---
name: self-improve
description: One cycle of the mdownreview self-improvement loop. Reads the expert-review backlog, picks the top unimplemented task, implements it on a feature branch, validates with tests, and commits if clean. Accepts optional user input to target a specific task, focus area, or goal. Run /expert-review first to generate the backlog.
---

# Self-Improve — One Development Cycle

**This skill is RIGID. Follow every step exactly. Do not skip or reorder.**

This skill runs one complete improvement cycle: load backlog → pick task → branch → implement → validate → commit. The backlog is produced by the `expert-review` skill. Run `/expert-review` first if you haven't recently.

## Accepting User Input

This skill accepts optional free-form input from the user that shapes which task is selected and how it is implemented. The input is whatever the user typed after the skill invocation (e.g., `/self-improve fix the scroll restoration bug`).

### How to detect user input

- The user's message that triggered this skill may contain additional text beyond the skill invocation.
- If the user provided text such as a task ID, goal, focus area, or specific concern, capture it as the **Improvement Directive**.
- If the user provided no additional text (bare `/self-improve`), the Improvement Directive is **empty** and the skill uses default task selection (Step 4 priority ordering).

### Directive modes

The Improvement Directive can be used in three ways, detected by pattern matching:

1. **Specific task ID** — user names an exact task ID from the cache (e.g., `/self-improve bug-unlisten-cleanup`).
   - **Effect**: Skip priority ordering. Select that exact task. If the task ID doesn't exist in the cache or is not `open`, print an error and exit.

2. **Focus area / goal** — user describes what they want improved (e.g., `/self-improve improve performance of the comment system`, `/self-improve fix bugs in the file watcher`).
   - **Effect**: In Step 4, filter tasks to those whose description, files, or evidence match the focus area. Among matching tasks, apply the standard priority ordering. If no tasks match, print a message and fall back to default selection.

3. **Custom task** — user describes a task not in the cache (e.g., `/self-improve add debounce to the search input`).
   - **Effect**: If the directive doesn't match any task ID or focus area in the cache, treat it as a **custom task request**. Create a synthetic task entry with:
     - `id`: derived from the directive text (slug format, e.g., `custom-debounce-search`)
     - `priority`: P2
     - `type`: feature (unless user says "fix" or "bug" → bug)
     - `risk`: medium (custom tasks haven't been expert-reviewed)
     - `directive`: true
     - All other fields filled from the user's description
   - Proceed with this synthetic task through Steps 5-11 as normal.
   - **Note**: Custom tasks get extra scrutiny in the expert review step (Step 8) since they weren't pre-vetted by experts.

### How the directive flows through the cycle

- **Step 4 (Select task)**: Directive determines which task is picked (see modes above).
- **Step 6 (Implement)**: The implementer agent receives the directive as additional context:
  > "**User directive**: [directive text]. The user specifically requested this improvement. Ensure the implementation addresses their stated goal."
- **Step 8 (Expert review)**: Experts are told the directive so they can verify the implementation meets the user's intent.
- **Step 9/10 (Commit/Abort)**: The log entry includes the directive for traceability.
- **Step 11 (Retrospective)**: Evaluate whether the directive was well-served by the task selection and implementation.

---

## Engineering principles this loop enforces

Every cycle is bound by three principles that filter what gets implemented:

1. **Evidence-based only** — tasks must cite a specific file:line. Speculative improvements are excluded from auto-mode.
2. **Rust-first** — tasks that move logic from TypeScript to Rust are elevated in priority. A task that adds TypeScript logic that could live in Rust is downgraded.
3. **Zero bug policy** — bug fixes ALWAYS include a failing test written before the fix. No test = not done. Validator rejects untested fixes.

---

## Step 1 — Safety pre-flight

Run in parallel:
```bash
git status --porcelain
git branch --show-current
```

**If working tree is dirty**: STOP. Print:
```
[self-improve] Skipping cycle — working tree is dirty. Commit or stash changes first.
```
Then exit the skill.

**If on a branch that starts with `auto-improve/`**: you are already on an improvement branch from a previous (possibly failed) cycle. Run `git checkout main` before continuing.

---

## Step 2 — Load the improvement log

Read `.claude/self-improve-log.md`. If it does not exist, treat it as empty.

This file tracks every task ever attempted:
- `DONE` — implemented, tested, committed
- `FAILED` — implemented but tests failed (do not retry automatically)
- `SKIPPED` — out of scope or too risky for auto-mode

Extract the list of task IDs already attempted (any status).

---

## Step 3 — Load the backlog cache

Read `.claude/self-improve-cache.md`.

### If the file does not exist:

Print:
```
[self-improve] No backlog found. Running expert-review to generate one...
```

Invoke the `expert-review` skill (call `skill("expert-review")`). After it completes, re-read `.claude/self-improve-cache.md`. If it still doesn't exist, print an error and exit.

### If the file exists, check freshness:

Read the frontmatter fields `generated_at`, `head_sha`, and `branch`.

**Cache is FRESH if BOTH conditions are met:**
1. `head_sha` matches the current `git rev-parse HEAD`
2. `generated_at` is within the last 48 hours

**If cache is STALE (either condition fails):**

Print:
```
[self-improve] Backlog is stale (generated at [date], HEAD was [old_sha], current HEAD is [new_sha]).
Running expert-review to refresh...
```

Invoke the `expert-review` skill (call `skill("expert-review")`). After it completes, re-read `.claude/self-improve-cache.md`.

### If cache is FRESH:

Parse the Summary Table and Task Details sections. Skip to Step 4.

---

## Step 4 — Select the next task

### If an Improvement Directive is present:

**Mode 1 — Specific task ID**: Check if the directive text exactly matches a task ID in the cache (case-insensitive). If found and `status=open`:
- Select it directly, skip priority ordering.
- If found but status is not `open`, print:
  ```
  [self-improve] Task [ID] exists but status is [status]. Cannot implement.
  ```
  Then exit.
- If not found, proceed to Mode 2.

**Mode 2 — Focus area / goal**: Search all `open` tasks in the cache for matches. A task matches if the directive keywords appear in its Task description, Files, Evidence, or Fix recommendation fields. Rank matches by:
1. Number of keyword matches (more = better)
2. Standard priority ordering (P1 > P2 > P3, bug > rust-migration > feature)
3. Tasks with `directive: true` in their detail block are preferred (these were flagged by expert-review as aligned with a prior directive)

If matches are found, select the top-ranked match. Print:
```
[self-improve] Directive: "[directive text]"
  Matched [N] tasks. Selected: [ID] — [task description]
  (Match reason: [which fields matched])
```

If no matches are found, proceed to Mode 3.

**Mode 3 — Custom task**: The directive describes something not in the cache. Create a synthetic task:
```
Task ID: custom-[slug-from-directive]
Priority: P2
Type: [feature, or bug if directive contains "fix"/"bug"/"broken"/"crash"]
Quick win: unknown
Risk: medium
Found by: user-directive
Location: [infer from directive if possible, otherwise "TBD — implementer will locate"]
Evidence: User requested: "[directive text]"
Fix: [directive text]
Directive: true
```

Print:
```
[self-improve] Directive: "[directive text]"
  No matching task in cache. Creating custom task: [ID]
  ⚠ Custom tasks have not been expert-reviewed. Extra scrutiny will be applied in Step 8.
```

Select this synthetic task and proceed.

### If no Improvement Directive (default behavior):

From the cache, find the first eligible task following this priority:

1. Tasks with `type=bug`, `quick_win=yes`, `risk=low`, `has_test_outline=yes`, `status=open`
2. Tasks with `type=rust-migration`, `quick_win=yes`, `risk=low`, `status=open`
3. Tasks with `type=feature`, `quick_win=yes`, `risk=low`, `status=open`
4. Tasks with `priority=P1`, `risk=low`, `status=open`

Task ID must NOT be in the attempted list from the log (Step 2), and must have `status=open` in the cache.

If no eligible tasks remain, print:
```
[self-improve] No eligible auto-implementable tasks remain.
All quick wins have been attempted. Run /expert-review to get a fresh assessment,
or promote a higher-risk task manually.
```
Then exit.

Record the selected task:
- **Task ID**: the stable content-derived ID (e.g., `bug-unlisten-cleanup`)
- **Task**: one-sentence description
- **Type**: bug / rust-migration / feature
- **Expert**: which expert recommended it
- **Files**: which files to read/modify
- **Evidence**: the full evidence from the detail block
- **Test outline**: (if type=bug, include it in the implementer prompt)
- **Fix recommendation**: the specific fix from the detail block

---

## Step 5 — Create a feature branch

```bash
git checkout -b auto-improve/[YYYYMMDD]-[task-id]
```

Example: `auto-improve/20260422-bug-unlisten-cleanup`

---

## Step 6 — Implement the task

Spawn a `task-implementer` agent:

```
subagent_type: task-implementer
prompt: "Implement this task for mdownreview:

**Task ID**: [ID]
**Task type**: [bug/rust-migration/feature]
**Task**: [one-sentence description]
**Expert context**: [the full evidence from the detail block — why this matters, with file:line citations]
**Fix recommendation**: [the specific fix recommendation from the detail block]
**Files to read**: [comma-separated file list]

[IF Improvement Directive is present]:
**User directive**: "[directive text]"
The user specifically requested this improvement. Ensure the implementation addresses their stated goal. If the directive provides additional context beyond what's in the task detail, use it to guide implementation decisions.

[IF type=bug]: **Failing test outline to implement first**:
[INSERT FULL TEST OUTLINE FROM CACHE DETAIL BLOCK]
Write this failing test first. Verify it fails. Then fix the bug. Test must be committed with the fix.

[IF type=rust-migration]: The goal is to move [description] from TypeScript to Rust. Implement in src-tauri/src/commands.rs and expose via src/lib/tauri-commands.ts. Minimize the TypeScript surface.

[IF custom task (Mode 3)]: This is a user-requested task that was NOT in the expert-review backlog. You must:
1. First locate the relevant code and understand the current behavior
2. Plan the minimal change needed
3. Write tests for the new behavior
4. Implement the change
Be conservative — this task hasn't been pre-vetted by experts.

Implement the task, then return your Implementation Summary."
```

Wait for the implementer to complete. Save its Implementation Summary.

---

## Step 7 — Validate

Spawn an `implementation-validator` agent:

```
subagent_type: implementation-validator
prompt: "Validate the implementation of task [ID] (type: [bug/rust-migration/feature]) in mdownreview.

The implementer changed: [list of files from Implementation Summary]
Tests written: [list of tests from Implementation Summary]

Run the full validation sequence (TypeScript, Rust tests if applicable, unit tests, lint, test coverage check) and return your Validation Report.

IMPORTANT: For type=bug, verify a failing test was written for the bug before the fix. If no test file was modified, verdict is DO NOT COMMIT."
```

Wait for the result. **If verdict is DO NOT COMMIT, skip to Step 10 (abort path).**

---

## Step 8 — Expert review of changes

Before committing, get independent expert review of the implementation. Spawn ALL 6 experts IN PARALLEL to review the diff:

First, capture the diff:
```bash
git diff main --stat
git diff main
```

Then spawn all 6 agents in a single message. Each agent already knows their domain — just provide the diff context:

```
For each of the 6 agents (product-improvement-expert, performance-expert, architect-expert,
react-tauri-expert, ux-expert, bug-hunter):

subagent_type: [agent-type]
prompt: "Review this change to mdownreview. This is an auto-improvement implementing task [ID]: [task description].

Type: [bug-fix/rust-migration/feature]
Original expert: [expert name]
[IF Improvement Directive is present]:
User directive: "[directive text]"
Verify this implementation addresses the user's stated goal.
[IF custom task]:
⚠ This is a user-requested custom task that was NOT in the expert-review backlog. Apply extra scrutiny — check for regressions, missing edge cases, and architectural fit.

Diff:
[INSERT FULL DIFF OUTPUT]

Files changed:
[INSERT DIFF STAT OUTPUT]

Review this change from your area of expertise. Report:
1. Does this change introduce any new issues in your domain?
2. Are there any regressions or side effects?
3. Is the implementation sound from your perspective?
[IF directive present]: 4. Does this implementation adequately address the user's directive?

Be concise. Only flag real issues with evidence. If the change looks good from your perspective, say so in one line."
```

Wait for all 6 to return.

### Evaluating expert feedback

- **If any expert flags a blocking issue** (bug introduced, regression, security concern): treat as DO NOT COMMIT. Skip to Step 10.
- **If experts only flag minor suggestions**: note them but proceed to commit. Record suggestions in the retrospective.
- **If all experts approve**: proceed to commit.

---

## Step 9 — Commit

```bash
git add [changed files from implementer summary — specific files only, never git add -A]
git commit -m "auto-improve: [task one-liner]

Type: [bug-fix/rust-migration/feature]
Expert: [expert name]
Task ID: [ID]

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Then update `.claude/self-improve-log.md` by appending:

```markdown
## [ID] — DONE
- **Date**: [ISO date]
- **Branch**: [branch name]
- **Type**: [bug-fix/rust-migration/feature]
- **Task**: [task description]
- **Expert**: [expert name]
- **Directive**: [directive text, or "none"]
- **Commit**: [git commit hash]
- **Validation**: All checks passed
- **Tests written**: [list of test names]
- **Expert review**: [summary — e.g., "All 6 approved" or "5 approved, architect noted minor suggestion X"]
```

Also update `.claude/self-improve-cache.md`: find the task's row in the Summary Table and change its Status from `open` to `done`.

Print:
```
[self-improve] ✓ Cycle complete.
  Task: [ID] — [task description]
  Type: [bug-fix/rust-migration/feature]
  Branch: [branch name]
  Commit: [hash]
  
  To review and merge: git checkout main && git merge [branch]
  To discard: git checkout main && git branch -D [branch]
```

Proceed to Step 11 (retrospective).

---

## Step 10 — Abort (validation or expert review failed)

Do NOT commit. Run:
```bash
git checkout main
git branch -D [branch name]
```

Update `.claude/self-improve-log.md` by appending:

```markdown
## [ID] — FAILED
- **Date**: [ISO date]
- **Task**: [task description]
- **Directive**: [directive text, or "none"]
- **Failure reason**: [from Validation Report or expert review]
- **Expert review findings**: [summary of blocking issues found]
- **Note**: Branch discarded. Fix manually or skip.
```

Also update `.claude/self-improve-cache.md`: find the task's row in the Summary Table and change its Status from `open` to `failed`.

Print:
```
[self-improve] ✗ Cycle ended without commit.
  Task: [ID] — [task description]
  Reason: [validation/expert review failure reason]
  
  The branch was discarded. To implement manually, pick up task [ID] from the cache.
```

Proceed to Step 11 (retrospective).

---

## Step 11 — Retrospective

After every cycle (pass or fail), run a retrospective to improve the self-improve process and update the backlog.

### 11a — Assess this cycle

Reflect on:
1. **Was the task well-scoped?** Did the implementer finish cleanly, or was the task too vague / too large?
2. **Was the evidence accurate?** Did the expert's original finding match reality, or was it stale/wrong?
3. **Were the tests adequate?** Did the validator and expert reviewers find gaps?
4. **What would make the next cycle better?** (e.g., task needed more context, file list was wrong, risk was underestimated)

### 11b — Update the backlog

Read `.claude/self-improve-cache.md` and make these updates:

1. **Promote or demote tasks** based on what was learned:
   - If this fix revealed a related task is now higher priority, update its priority
   - If this fix resolved a task that was listed separately, mark it `done`
   - If an expert reviewer flagged a new issue during Step 8, **add it as a new task** to the cache with a proper detail block

2. **Adjust risk ratings** if this cycle revealed that a "low" risk task was actually harder than expected, update similar tasks

3. **Record cycle learnings** — append to a `## Retrospective Notes` section at the bottom of the cache:
   ```markdown
   ## Retrospective Notes
   
   ### [date] — [task ID] — [DONE/FAILED]
   - **Lesson**: [one-sentence takeaway]
   - **New tasks added**: [IDs or "none"]
   - **Tasks re-prioritized**: [IDs or "none"]
   - **Process improvement**: [suggestion or "none"]
   ```

---

## Cycle summary table

At the end of every cycle (pass or fail), print a one-line status table:

```
┌─────────────────────────────────────────────────────────────────┐
│ SELF-IMPROVE CYCLE COMPLETE                                     │
│ Task: [ID] [task]                        Status: DONE/FAILED   │
│ Type: [bug-fix/rust-migration/feature]   Cache age: [Xh]       │
│ Directive: [directive text, or "none"]                           │
│ Expert review: [N approved / N flagged]                         │
│ Bugs remaining in cache: [N]             Rust migrations: [N]  │
│ Retro: [one-sentence lesson learned]                            │
│ Next cycle: run /self-improve again or /loop Xh /self-improve  │
└─────────────────────────────────────────────────────────────────┘
```
