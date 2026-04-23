---
name: implement-issues
description: Autonomously implements groomed GitHub issues. Reads the spec from the issue, plans, implements on a feature branch, validates, and creates a PR. No user interaction required. Accepts optional issue numbers to target specific issues.
---

# Implement Issues Skill

Autonomously implements GitHub issues that have been groomed (have a spec attached). Runs the full cycle: read spec → plan → implement → validate → code review → PR. Does NOT ask the user clarifying questions — consults expert agents instead.

**This skill is RIGID. Follow each step exactly. Do not skip or reorder.**

## Accepting User Input

This skill accepts optional issue numbers from the user to target specific issues.

### How to detect user input

- If the user provided issue numbers (e.g., `/implement-issues #36 #42` or `/implement-issues 36 42`), extract them as the **Target Issues** list.
- If the user provided no issue numbers (bare `/implement-issues`), the Target Issues list is **empty** and the skill uses label-based discovery (default behavior).

## Engineering Principles

Every implementation is bound by the project's three core principles:

1. **Evidence-based only** — implementations follow the spec. No speculative additions.
2. **Rust-first** — logic that can live in Rust goes in Rust, exposed via typed Tauri commands.
3. **Zero bug policy** — every change includes tests. No untested code.

---

## Step 1 — Safety pre-flight

Run in parallel:
```bash
git status --porcelain
git branch --show-current
```

**If working tree is dirty**: STOP. Print:
```
[implement-issues] Working tree is dirty. Commit or stash changes first.
```
Then exit.

**If not on main**: Run `git checkout main && git pull` to start from a clean main.

---

## Step 2 — Collect issues to implement

**If Target Issues were provided:**

Fetch each specified issue:
```bash
gh issue view <number> --json number,title,body,labels,comments
```
Process these regardless of labels (but warn if no spec comment is found).

**If no Target Issues (default):**

Fetch all open issues with the `groomed` label:
```bash
gh issue list --label "groomed" --state open --json number,title,body,labels --limit 100
```

If no issues found, print:
```
[implement-issues] No groomed issues found. Run /groom-issues first to groom open issues.
```
Then exit.

Sort by issue number ascending (oldest first).

---

## Step 3 — Display queue and confirm

Print the list of issues to be implemented:

```
📋 Issues to implement:
  #36 — CLI improvements
  #42 — Add export feature

Starting with #36...
```

---

## Step 4 — Process one issue

For the current issue, run Steps 4a through 4h. Each issue gets its own feature branch and PR.

### Step 4a — Extract the spec

Fetch the issue with comments:
```bash
gh issue view <number> --json number,title,body,comments
```

Search comments for the `<!-- mdownreview-spec -->` HTML marker. Extract the spec content.

**If no spec found**: Print a warning and skip this issue:
```
[implement-issues] ⚠ #<number> has no spec comment. Skipping. Run /groom-issues #<number> first.
```
Move to the next issue.

Parse the spec to extract:
- **Problem Statement**
- **Proposed Approach**
- **Acceptance Criteria**
- **Technical Notes** (key files, dependencies)
- **Constraints & Non-Goals**

### Step 4b — Create a feature branch

```bash
git checkout main && git pull
git checkout -b feature/issue-<number>-<slug>
```

Where `<slug>` is a 3-5 word kebab-case summary derived from the issue title (e.g., `feature/issue-36-cli-improvements`).

### Step 4c — Explore codebase and consult experts

Before planning, gather deep context. Spawn **explore agents** in parallel to investigate the files and modules mentioned in the spec's Technical Notes section.

Then spawn relevant **expert agents** in parallel to get architectural guidance:

```
For each relevant expert (select based on what the issue touches):

agent_type: [architect-expert | react-tauri-expert | performance-expert | security-reviewer]
mode: background
prompt: "I'm about to implement GitHub issue #<number>: <title>

Spec:
<full spec text>

Issue body:
<full issue body>

Based on your expertise, provide:
1. Key architectural considerations for this implementation
2. Any risks or pitfalls to watch for
3. Recommended implementation approach from your domain perspective
4. Which files should be modified, and how they interact

Be specific — cite files and line numbers. If the spec's approach looks sound from your perspective, say so briefly."
```

Wait for expert responses. Synthesize their guidance into implementation context.

### Step 4d — Write implementation plan

Invoke the **writing-plans** pattern. Create a detailed plan in the session workspace:

Using a `general-purpose` agent:

```
agent_type: general-purpose
mode: background
prompt: "Create a detailed implementation plan for GitHub issue #<number>: <title>

## Context

Issue body:
<issue body>

Spec:
<full spec text>

Expert guidance:
<synthesized expert feedback from Step 4c>

Codebase context:
<relevant file contents from exploration>

## Requirements

Write a step-by-step implementation plan. For each step:
1. What file(s) to create or modify
2. What specific changes to make (enough detail that a developer can implement without further questions)
3. What tests to write
4. Dependencies on other steps

Follow the project's engineering principles:
- Rust-first: put logic in Rust where possible, expose via typed Tauri commands
- Zero bug policy: every change gets tests
- Evidence-based: implement exactly what the spec says, no speculative additions

Save the plan to: C:\Users\davzh\.copilot\session-state\<session-id>\plan.md

The plan should have TODO items that can be tracked."
```

Wait for the plan. Review it briefly for completeness.

### Step 4e — Execute the plan

Use the **subagent-driven-development** pattern to execute the plan. For independent tasks, spawn subagents in parallel. For dependent tasks, execute sequentially.

For each task in the plan, spawn a `task-implementer` agent:

```
agent_type: task-implementer
mode: background
prompt: "Implement this task for mdownreview:

**GitHub Issue**: #<number> — <title>
**Task**: <task description from plan>
**Files to modify**: <file list>
**Changes needed**: <detailed changes from plan>
**Tests to write**: <test descriptions from plan>

Context:
<relevant file contents>
<spec excerpt relevant to this task>

Engineering principles:
- Put logic in Rust where it can live there (file I/O, text processing, validation)
- Write tests for every change
- Follow existing patterns in the codebase
- All Tauri IPC calls go through src/lib/tauri-commands.ts
- All logging goes through src/logger.ts

Do NOT ask clarifying questions. If something is ambiguous, make the most conservative choice and note it in your Implementation Summary.

Implement the task and return your Implementation Summary listing:
- Files modified
- Tests written
- Key decisions made
- Any concerns or ambiguities noted"
```

### Step 4f — Validate

Spawn an `implementation-validator` agent:

```
agent_type: implementation-validator
mode: background
prompt: "Validate the implementation of GitHub issue #<number>: <title> in mdownreview.

Files changed: <list from implementer summaries>
Tests written: <list from implementer summaries>

Run the full validation sequence:
1. npm run lint
2. cargo test (from src-tauri/)
3. npm test (Vitest)
4. npm run test:e2e (Playwright browser tests)

Return your Validation Report with pass/fail for each check and full output for any failures."
```

**If validation fails**: Attempt ONE fix cycle:
1. Read the failure output
2. Spawn a `task-implementer` to fix the specific failures
3. Re-run validation

If validation fails a second time, skip to Step 4h (abort path).

### Step 4g — Code review

Spawn a `code-review` agent to review the complete diff:

```
agent_type: code-review
mode: background
prompt: "Review the changes on branch <branch-name> for GitHub issue #<number>: <title>.

Spec:
<full spec text>

Review criteria:
1. Does the implementation match the spec's acceptance criteria?
2. Are there bugs, security issues, or logic errors?
3. Are tests adequate — do they cover the acceptance criteria?
4. Does it follow the project's Rust-first principle?
5. Any regressions or side effects?

Only flag real issues with evidence. Minor style suggestions are not needed."
```

**If code review flags blocking issues**: Attempt one fix cycle (same as validation). If issues persist after the fix, proceed to Step 4h (abort).

**If code review passes** (no blocking issues): Proceed to commit.

### Step 4g-commit — Commit and create PR

```bash
git add <specific changed files — never git add -A>
git commit -m "feat: implement #<number> — <title summary>

<brief description of what was implemented>

Closes #<number>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Push and create PR:
```bash
git push -u origin HEAD
gh pr create --title "feat: implement #<number> — <title>" --body "## Summary

Implements the spec from #<number>.

### Changes
<list of key changes>

### Tests
<list of tests added>

### Acceptance Criteria
<checklist from spec>

---
Closes #<number>
Spec: <link to spec comment>"
```

Add the `groomed` label to the PR for traceability:
```bash
gh pr edit --add-label "groomed"
```

Print:
```
✅ #<number> implemented and PR created: <pr-url>
   Branch: <branch-name>
   Commit: <hash>
```

### Step 4h — Abort path

If validation or code review failed after retry:

```bash
git checkout main
git branch -D <branch-name>
```

Post a comment on the issue explaining the failure:
```bash
gh issue comment <number> --body "<!-- mdownreview-impl-attempt -->
## ⚠️ Automated Implementation Attempt

An autonomous implementation attempt was made but failed validation.

**Failure reason:** <reason from validator or code reviewer>

**What was tried:** <brief summary of approach>

This issue remains groomed and can be retried with \`/implement-issues #<number>\` or implemented manually."
```

Print:
```
❌ #<number> — implementation failed. Branch discarded. Failure comment posted on issue.
   Reason: <failure reason>
```

---

## Step 5 — Continue to next issue

If there are more issues in the queue:

Return to main:
```bash
git checkout main
```

Then go back to Step 4 with the next issue.

---

## Step 6 — Summary

After all issues are processed, print:

```
📊 Implementation session complete:
  ✅ #36 — CLI improvements → PR #51
  ❌ #42 — Add export feature → validation failed
  ⏭️ #50 — No spec found, skipped
```

---

## Notes

- This skill is fully autonomous. It does NOT ask the user questions during implementation. All ambiguities are resolved by consulting expert agents or making conservative choices.
- Each issue gets its own feature branch and PR. Issues are independent.
- The spec comment on the issue is the source of truth for requirements.
- Failed implementations post a comment on the issue for transparency.
- The `groomed` label stays on the issue until the PR is merged and the issue is closed.
- Expert agents are consulted before planning to catch architectural issues early.
- One retry is allowed for validation/review failures. After that, the issue is skipped.
