---
name: self-improve
description: One cycle of the mdownreview self-improvement loop. Reviews the codebase (or uses a cached review), picks the top unimplemented quick win, implements it on a feature branch, validates with tests, and commits if clean. Run via /loop to make the app self-improving.
---

# Self-Improve — One Development Cycle

**This skill is RIGID. Follow every step exactly. Do not skip or reorder.**

This skill runs one complete improvement cycle: review → pick task → branch → implement → validate → commit. Pair with `/loop 2h /self-improve` for continuous autonomous improvement.

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

## Step 2 — Load the improvement backlog

Read `.claude/self-improve-log.md`. If it does not exist, treat it as empty.

This file tracks every task ever attempted:
- `DONE` — implemented, tested, committed
- `FAILED` — implemented but tests failed (do not retry automatically)
- `SKIPPED` — out of scope or too risky for auto-mode

Extract the list of task IDs already attempted (any status).

---

## Step 3 — Get the task list (use cache if fresh)

Check if `.claude/self-improve-cache.md` exists and read its `generated_at` frontmatter field.

**Cache is FRESH** if generated within the last 24 hours (compare to current date/time).

### If cache is FRESH:
Read `.claude/self-improve-cache.md` and extract the Quick Wins list and Priority 1 list. Skip to Step 4.

### If cache is STALE or missing:
Run a fresh expert review. Spawn ALL 6 agents in parallel (single message, 6 Agent tool calls):

**Agent 1 — product-improvement-expert:**
```
subagent_type: product-improvement-expert
prompt: "Review mdownreview for product improvement opportunities. Read src/App.tsx, src/store/index.ts, src/components/viewers/ViewerRouter.tsx, src/components/comments/CommentsPanel.tsx, src/hooks/useFileContent.ts. Produce your Product Improvement Report. Evidence-based only — cite file:line. Flag Rust-first candidates. Bugs get failing test outlines. Focus especially on Quick Wins implementable in under an hour."
```

**Agent 2 — performance-expert:**
```
subagent_type: performance-expert
prompt: "Review mdownreview for performance issues. Read src-tauri/src/watcher.rs, src-tauri/src/commands.rs, src/hooks/useFileContent.ts, src/hooks/useFileWatcher.ts, src/store/index.ts. Produce your Performance Analysis Report. Evidence-based only — no finding without measurement or code proof. Include benchmark stubs. Flag Rust migration candidates. Mark issues fixable in under 1 hour as Quick Wins."
```

**Agent 3 — architect-expert:**
```
subagent_type: architect-expert
prompt: "Review mdownreview architecture. Read src/store/index.ts, src/lib/tauri-commands.ts, src-tauri/src/commands.rs, src/App.tsx, and all files in src/hooks/. Produce your Architecture Review. Evidence-based only — cite file:line. Flag TypeScript logic that belongs in Rust with proposed command signatures. Bugs = Priority 1 with test outline. Flag Quick Wins (safe, self-contained, under 1 hour)."
```

**Agent 4 — react-tauri-expert:**
```
subagent_type: react-tauri-expert
prompt: "Review mdownreview for React 19 and Tauri v2 API issues. Read all files in src/hooks/, src/lib/tauri-commands.ts, src-tauri/src/commands.rs, src-tauri/src/lib.rs. Also grep for invoke( and listen( in src/. Evidence-based only. Confirmed bugs get failing test outlines. Flag Rust-first migration candidates with proposed signatures. Mark Quick Wins clearly."
```

**Agent 5 — ux-expert:**
```
subagent_type: ux-expert
prompt: "Review mdownreview UX. Read src/App.tsx, src/components/comments/CommentsPanel.tsx, src/components/comments/CommentInput.tsx, src/components/comments/SelectionToolbar.tsx, src/components/WelcomeView.tsx. Grep for tabIndex and aria- across src/. Evidence-based only — cite file:line. UX bugs get test outlines. Slow UX = flag for Rust-first fix. Produce your UX Review with Top 3 Quick Wins."
```

**Agent 6 — bug-hunter:**
```
subagent_type: bug-hunter
prompt: "Hunt for bugs in mdownreview. Read all files in src/hooks/, src/lib/comment-anchors.ts, src/lib/comment-matching.ts, src/lib/tauri-commands.ts, src-tauri/src/commands.rs. Grep for listen( in src/ and check for missing unlisten() cleanup. Evidence-based only. Every confirmed bug must include a failing test outline. Flag Rust-first opportunities where moving logic to Rust eliminates the bug class. Produce your Bug Hunt Report."
```

After all 6 return, synthesize the consolidated task list and write `.claude/self-improve-cache.md`:

```markdown
---
generated_at: [ISO 8601 datetime]
---

# Expert Review Cache

## Quick Wins (auto-implementable, < 1 hour each)
<!-- Format: QW-001, QW-002, etc. -->
<!-- Priority ordering: bugs first, then Rust migrations, then feature improvements -->

| ID | Task | Type | Expert | Files | Risk | Has test outline? |
|----|------|------|--------|-------|------|-------------------|
| QW-001 | [one-sentence task] | bug/rust-migration/feature | [expert name] | [file1, file2] | low/medium | yes/no |
...

## Priority 1 — Bugs & Critical Gaps
| ID | Task | Type | Expert | Files | Risk | Has test outline? |
...

## Priority 2 — Friction & Design
| ID | Task | Type | Expert | Files | Risk | Has test outline? |
...

## Rust-First Migration Candidates
| ID | Current TypeScript | Proposed Rust command | Expert | Risk |
...

## Expert Consensus (flagged by 2+ experts)
[List of IDs]
```

**Auto-mode task priority order:**
1. Bugs with test outlines (zero bug policy — bugs always first)
2. Rust-first migrations (performance and reliability wins)
3. Feature quick wins

**Auto-mode scope rules** — only Quick Wins with risk=`low` are eligible. Never auto-implement:
- Anything touching `src-tauri/tauri.conf.json` or capability/permissions config
- Anything touching `.claude/` directory
- Anything described as "refactor" without a clear atomic change
- Any task requiring new dependencies (`npm install`, `cargo add`)
- Any task touching auth, file deletion, or process execution
- Any bug fix task that has `Has test outline? = no` (violates zero bug policy — needs manual attention)

---

## Step 4 — Select the next task

From the cache, find the first eligible task following this priority:
1. Quick Wins with `type=bug` and `risk=low` and `Has test outline? = yes`
2. Quick Wins with `type=rust-migration` and `risk=low`
3. Quick Wins with `type=feature` and `risk=low`
4. Priority 1 items with `risk=low`

ID must NOT be in the attempted list from the log (Step 2).

If no eligible tasks remain, print:
```
[self-improve] No eligible auto-implementable tasks remain.
All quick wins have been attempted. Run /expert-review to get a fresh plan,
or promote a Priority 2 task manually.
```
Then exit.

Record the selected task:
- **Task ID**: e.g., `QW-003`
- **Task**: one-sentence description
- **Type**: bug / rust-migration / feature
- **Expert**: which expert recommended it
- **Files**: which files to read/modify
- **Test outline**: (if type=bug, include it in the implementer prompt)

---

## Step 5 — Create a feature branch

```bash
git checkout -b auto-improve/[YYYYMMDD]-[short-slug]
```

Where `short-slug` is 3-4 words from the task, hyphenated, lowercase. Example:
`auto-improve/20260422-fix-unlisten-cleanup`

---

## Step 6 — Implement the task

Spawn a `task-implementer` agent:

```
subagent_type: task-implementer
prompt: "Implement this task for mdownreview:

**Task ID**: [ID]
**Task type**: [bug/rust-migration/feature]
**Task**: [one-sentence description]
**Expert context**: [the expert's original finding — why this matters, with file:line evidence]
**Files to read**: [comma-separated file list]

[IF type=bug]: **Failing test outline to implement first**:
[INSERT TEST OUTLINE FROM CACHE]
Write this failing test first. Verify it fails. Then fix the bug. Test must be committed with the fix.

[IF type=rust-migration]: The goal is to move [description] from TypeScript to Rust. Implement in src-tauri/src/commands.rs and expose via src/lib/tauri-commands.ts. Minimize the TypeScript surface.

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

Wait for the result.

---

## Step 8 — Commit or abort

### If Validation Report says COMMIT:

```bash
git add [changed files from implementer summary — specific files only, never git add -A]
git commit -m "auto-improve: [task one-liner]

Type: [bug-fix/rust-migration/feature]
Expert: [expert name]
Task ID: [ID]

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

Then update `.claude/self-improve-log.md` by appending:

```markdown
## [ID] — DONE
- **Date**: [ISO date]
- **Branch**: [branch name]
- **Type**: [bug-fix/rust-migration/feature]
- **Task**: [task description]
- **Expert**: [expert name]
- **Commit**: [git commit hash]
- **Validation**: All checks passed
- **Tests written**: [list of test names]
```

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

### If Validation Report says DO NOT COMMIT:

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
- **Failure reason**: [from Validation Report]
- **Note**: Branch discarded. Fix manually or skip.
```

Print:
```
[self-improve] ✗ Cycle ended without commit.
  Task: [ID] — [task description]
  Reason: [validation failure reason]
  
  The branch was discarded. To implement manually, pick up task [ID] from the cache.
```

---

## Cycle summary table

At the end of every cycle (pass or fail), print a one-line status table:

```
┌─────────────────────────────────────────────────────────────────┐
│ SELF-IMPROVE CYCLE COMPLETE                                     │
│ Task: [ID] [task]                        Status: DONE/FAILED   │
│ Type: [bug-fix/rust-migration/feature]   Cache age: [Xh]       │
│ Bugs remaining in cache: [N]             Rust migrations: [N]  │
│ Next cycle: run /self-improve again or /loop Xh /self-improve  │
└─────────────────────────────────────────────────────────────────┘
```
