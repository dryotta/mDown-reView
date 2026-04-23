---
name: expert-review
description: Orchestrates all mdownreview expert agents in parallel to review the codebase, synthesizes findings into a prioritized improvement plan, and writes the backlog for self-improve to consume. Accepts optional user input to focus the review on specific goals, areas, or expected outcomes.
---

# Expert Review Skill

You are orchestrating a multi-expert review of the mdownreview codebase. Run all experts in parallel, collect their findings, synthesize a single prioritized improvement plan, and write a canonical backlog file that the `self-improve` skill can consume.

**This skill is RIGID. Follow each step exactly.**

## Accepting User Input

This skill accepts optional free-form input from the user that shapes the review's focus, goal, and expected outcome. The input is whatever the user typed after the skill invocation (e.g., `/expert-review focus on performance and memory usage`).

### How to detect user input

- The user's message that triggered this skill may contain additional text beyond the skill invocation.
- If the user provided text such as a goal, focus area, specific concern, or expected outcome, capture it as the **Review Directive**.
- If the user provided no additional text (bare `/expert-review`), the Review Directive is **empty** and the skill runs as a full, unfocused review (default behavior).

### How the Review Directive affects the skill

When a Review Directive is present, it modifies the skill at every stage:

1. **Expert prompts (Step 2)**: Each expert receives the directive as an additional instruction:
   > "**Review Directive from the user**: [directive text]. Prioritize findings that are relevant to this directive. Still report other issues you find, but clearly mark which findings directly address the directive."
2. **Synthesis (Step 5)**: The improvement plan includes a **"Directive Alignment"** section at the top showing which findings directly address the user's stated goal.
3. **Backlog prioritization (Step 6)**: Tasks that directly address the directive are **elevated by one priority level** (e.g., P3 → P2) and tagged with `directive: true` in their detail block.
4. **Summary (Done)**: The final summary states the directive and how many findings addressed it.

### Examples of valid directives

- `focus on performance and memory usage` → experts prioritize perf findings, synthesis highlights perf items
- `find bugs in the comment system` → experts focus on comment-related code, bugs in comments elevated
- `review the file watcher for reliability issues` → experts focus on watcher.rs and useFileWatcher
- `prepare the codebase for adding image viewer support` → experts assess readiness, architecture gaps for this feature
- `only look at the Rust layer` → experts focus on src-tauri/src/, skip React-only issues

---

## Engineering principles all experts must apply

Every expert is bound by these rules (already embedded in their agent definitions):
1. **Evidence-based only** — no finding without a file:line citation
2. **Rust-first** — flag any TypeScript logic that belongs in Rust
3. **Zero bug policy** — every bug comes with a failing test outline

The synthesis must reflect these principles: bugs are Priority 1 regardless of severity perception, Rust migration candidates get their own section, and every item in the plan must have code-level evidence.

---

## Step 1 — Gather context (do this BEFORE spawning agents)

Run these in parallel:

```bash
# GitHub issues
gh issue list --limit 30 --json number,title,body,labels,state 2>/dev/null || echo "No GitHub issues available"

# Recent commits (last 2 weeks of work)
git --no-pager log --since="2 weeks ago" --pretty=format:"%h %s" | head -30

# Current HEAD SHA (for cache freshness)
git rev-parse HEAD

# Current file counts by area
find src/ -name "*.tsx" -o -name "*.ts" | grep -v __tests__ | grep -v ".test." | wc -l
find src-tauri/src/ -name "*.rs" | wc -l
```

Also read `.claude/self-improve-log.md` if it exists. Extract already-attempted task IDs and their statuses. You will mark these in the backlog so self-improve doesn't retry them.

Save the output — you'll include it in every agent prompt.

---

## Step 2 — Spawn all 6 experts IN PARALLEL (single message, 6 Agent calls)

Send all 6 Agent tool calls in the same message. Each agent already knows what files to read and what to look for — their agent definitions contain domain knowledge.

Provide each agent with the **context from Step 1** (git log, GitHub issues, HEAD SHA). Do NOT tell agents which files to read — they know their domain.

**If a Review Directive is present**, append the directive block (shown below) to every agent's prompt. If no directive, omit it.

Directive block to append when present:
```
Review Directive from the user: "[INSERT DIRECTIVE TEXT]"
Prioritize findings that are relevant to this directive. Still report other issues you find, but clearly mark which findings DIRECTLY ADDRESS the directive vs. general findings. Tag directive-relevant findings with [DIRECTIVE] at the start of each finding title.
```

### Agent 1: Product Improvement Expert
```
subagent_type: product-improvement-expert
prompt: "Review the mdownreview codebase for product improvement opportunities. Produce your Product Improvement Report.

Context from recent work:
[INSERT GIT LOG OUTPUT]

Open GitHub issues:
[INSERT GH ISSUES OUTPUT OR "none"]

[INSERT DIRECTIVE BLOCK IF PRESENT]"
```

### Agent 2: Performance Expert
```
subagent_type: performance-expert
prompt: "Review the mdownreview codebase for performance issues. Produce your Performance Analysis Report.

Context from recent work:
[INSERT GIT LOG OUTPUT]

[INSERT DIRECTIVE BLOCK IF PRESENT]"
```

### Agent 3: Architect Expert
```
subagent_type: architect-expert
prompt: "Review the mdownreview architecture. Produce your Architecture Review.

Context from recent work:
[INSERT GIT LOG OUTPUT]

[INSERT DIRECTIVE BLOCK IF PRESENT]"
```

### Agent 4: React + Tauri Expert
```
subagent_type: react-tauri-expert
prompt: "Review mdownreview for React and Tauri API usage issues. Produce your React + Tauri Expert Review.

Context from recent work:
[INSERT GIT LOG OUTPUT]

[INSERT DIRECTIVE BLOCK IF PRESENT]"
```

### Agent 5: UX Expert
```
subagent_type: ux-expert
prompt: "Review mdownreview's user experience. Produce your UX Review.

Context from recent work:
[INSERT GIT LOG OUTPUT]

Open GitHub issues:
[INSERT GH ISSUES OUTPUT OR "none"]

[INSERT DIRECTIVE BLOCK IF PRESENT]"
```

### Agent 6: Bug Hunter
```
subagent_type: bug-hunter
prompt: "Hunt for bugs in the mdownreview codebase. Produce your Bug Hunt Report.

Context from recent work:
[INSERT GIT LOG OUTPUT]

[INSERT DIRECTIVE BLOCK IF PRESENT]"
```

---

## Step 3 — Wait for all 6 agents to complete

Do not proceed until all 6 have returned results.

---

## Step 4 — Cross-reference with GitHub issues

For each open GitHub issue, check which expert's findings address it. Note any issues that no expert found a root cause for — these need manual investigation.

---

## Step 5 — Synthesize the Improvement Plan

Write a consolidated **report for the user** structured as:

```markdown
# mdownreview Improvement Plan
Generated: [date]

## Review Directive
[If a directive was provided, state it here verbatim. If no directive: "Full review — no specific focus requested."]

## Directive Alignment
[If a directive was provided, list findings that DIRECTLY address it. Include the finding title, expert, and location. This section helps the user quickly see how the review addressed their specific concern.]

| Finding | Expert | Location | Priority |
|---------|--------|----------|----------|
| [finding tagged [DIRECTIVE] by experts] | [expert] | [file:line] | [P1/P2/P3] |

[If no directive: omit this section entirely.]

## Engineering Principles Applied
This review enforces:
- Evidence-based: every item has a file:line citation
- Rust-first: TypeScript→Rust migration candidates collected
- Zero bug policy: all confirmed bugs are Priority 1 with test outlines

## Executive Summary
[3-4 sentences covering the overall health of the app and top themes]

## GitHub Issues Status
| # | Title | Expert Findings | Status |
|---|-------|-----------------|--------|
| [num] | [title] | [which expert addressed it and how] | Addressed / Needs investigation |

## Priority 1 — Bugs (fix before anything else)
### [Bug title]
- **Found by**: [expert name(s)]
- **Location**: [file:line]
- **Evidence**: [quote or description of the defect code]
- **Failing test outline**:
  ```typescript/rust
  // test that would catch this
  ```
- **Fix**: [specific recommendation]
- **Rust-first?**: [yes — propose Rust command / no — fix in place]

## Priority 2 — Improve Soon (friction and design issues)
### [Issue title]
- **Found by**: [expert name(s)]
- **Location**: [file:line]
- **Evidence**: [code citation]
- **Fix**: [specific recommendation]

## Priority 3 — Invest In (features and architecture)
[Same format — evidence required for inclusion]

## Rust-First Migration Candidates
| Item | Current Location | Proposed Rust Command | Benefit |
|------|-----------------|----------------------|---------|
| [computation] | [file:line] | `pub fn ...() -> Result<T, String>` | [perf/reliability gain] |

## Quick Wins (< 1 hour each, high value, evidence-based)
1. [Action] — [file:line] — [expected improvement] — [test needed: yes/no]

## Expert Consensus (issues flagged by 2+ experts)
[List items multiple experts independently flagged — highest-confidence issues]

## Recommended Sprint Plan
**This week (bugs first)**: [3-5 specific tasks with file:line references]
**Next sprint**: [themes / larger investments]
**Backlog**: [things to keep an eye on]
```

Show the full report to the user. Do not truncate it.

---

## Step 6 — Write the self-improve backlog cache

After showing the report, write `.claude/self-improve-cache.md` with the canonical backlog that the `self-improve` skill consumes. This file is the **single source of truth** for automated improvements.

### Task ID format

Use **stable, content-derived IDs** so IDs survive across review runs without renumbering:
- Format: `[type]-[slug]` where slug is 2-4 hyphenated words from the task
- Examples: `bug-unlisten-cleanup`, `rust-levenshtein-migration`, `feat-keyboard-nav`
- IDs must be deterministic: the same finding should produce the same ID across runs

### Cache file format

```markdown
---
generated_at: [ISO 8601 datetime]
head_sha: [full HEAD SHA from Step 1]
branch: [current branch name]
directive: "[Review Directive text, or empty string if none]"
---

# Expert Review Backlog

## Summary Table

| ID | Task | Priority | Type | Quick Win | Expert | Files | Risk | Has Test Outline | Directive | Status |
|----|------|----------|------|-----------|--------|-------|------|------------------|-----------|--------|
| bug-unlisten-cleanup | Fix missing unlisten in useFileWatcher | P1 | bug | yes | bug-hunter | src/hooks/useFileWatcher.ts | low | yes | no | open |
| rust-levenshtein | Move Levenshtein to Rust command | P2 | rust-migration | yes | performance | src/lib/comment-matching.ts | low | no | yes | open |
| feat-keyboard-nav | Add keyboard nav to CommentsPanel | P3 | feature | yes | ux | src/components/comments/CommentsPanel.tsx | low | no | no | open |
...

<!-- Status values: open, done, failed, skipped -->
<!-- Tasks from self-improve-log.md are pre-marked as done/failed/skipped -->

---

## Task Details

### bug-unlisten-cleanup
- **Priority**: P1
- **Type**: bug
- **Quick win**: yes
- **Risk**: low
- **Found by**: bug-hunter
- **Location**: src/hooks/useFileWatcher.ts:42
- **Evidence**: useEffect cleanup function does not call unlisten() for the file-changed listener, causing listener leak on unmount
- **Fix**: Store the unlisten promise returned by listen() and call it in the useEffect cleanup
- **Rust-first**: no
- **Failing test outline**:
```typescript
it('should unlisten on unmount', () => {
  const { unmount } = renderHook(() => useFileWatcher());
  unmount();
  expect(mockUnlisten).toHaveBeenCalled();
});
```

### rust-levenshtein
- **Priority**: P2
- **Type**: rust-migration
- **Quick win**: yes
- **Risk**: low
- **Found by**: performance
- **Location**: src/lib/comment-matching.ts:80-138
- **Evidence**: Levenshtein distance (O(m×n) per pair) runs in React render path via useMemo. For files with many comments and large content, this blocks the main thread.
- **Fix**: Move to a Rust Tauri command: `pub fn fuzzy_match_comments(content: &str, comments: Vec<CommentAnchor>) -> Vec<MatchResult>`
- **Rust-first**: yes — proposed command signature above
- **Directive**: yes — directly addresses user's performance review directive

### feat-keyboard-nav
...

<!-- Continue for ALL tasks. Every row in the Summary Table MUST have a matching detail block. -->
```

### Rules for writing the cache

1. **Every finding from the synthesis becomes a task** with a detail block — not just quick wins
2. **Pre-mark status** for tasks that appear in `.claude/self-improve-log.md` (done/failed/skipped)
3. **Do not remove** previously-done tasks — keep them with their status for continuity
4. **One canonical record per finding** — a task has one priority, one type, and a quick_win flag. Do not duplicate across sections.
5. **Preserve IDs from prior cache** — if `.claude/self-improve-cache.md` already exists and a finding maps to an existing ID, reuse that ID
6. **Directive elevation** — if a Review Directive was provided, tasks tagged `[DIRECTIVE]` by experts are elevated by one priority level (P3 → P2, P2 → P1; P1 stays P1). Add `directive: true` to their detail block. This ensures the user's stated goal gets prioritized in the self-improve loop.

---

## Step 7 — Create or update GitHub issues for Priority 1 bugs (optional)

If GitHub CLI (`gh`) is available and authenticated, create or update issues for P1 bugs:

1. For each P1 task, search for an existing open issue with the task ID in the title or body:
   ```bash
   gh issue list --search "[task-id]" --json number,title,state --limit 5
   ```
2. **If no matching open issue exists**: create one:
   ```bash
   gh issue create --title "Bug: [task title]" --body "[evidence, location, test outline, task ID: [id]]" --label "bug,auto-review"
   ```
3. **If a matching open issue exists**: skip (do not create duplicates)
4. **If `gh` is not available or not authenticated**: skip this step entirely — it is not required for the backlog to be valid

Print which issues were created/skipped.

---

## Done

Print a summary:
```
[expert-review] ✓ Review complete.
  Directive: [directive text, or "Full review — no specific focus"]
  Tasks found: [N total] ([N] P1 bugs, [N] P2, [N] P3)
  Directive-aligned tasks: [N tasks tagged as addressing the directive, or "N/A"]
  Quick wins: [N] ([N] eligible for auto-improve)
  Backlog written to: .claude/self-improve-cache.md
  GitHub issues: [N created / N skipped / not available]

  Next: run /self-improve to implement the top task automatically.
  [If directive present]: To focus self-improve on directive tasks, run:
    /self-improve [directive text]
```
