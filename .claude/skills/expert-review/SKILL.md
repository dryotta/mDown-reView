---
name: expert-review
description: Orchestrates all mdownreview expert agents in parallel to review the codebase and open GitHub issues, then synthesizes findings into a prioritized improvement plan.
---

# Expert Review Skill

You are orchestrating a multi-expert review of the mdownreview codebase. Run all experts in parallel, collect their findings, then synthesize a single prioritized improvement plan.

**This skill is RIGID. Follow each step exactly.**

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

# Current file counts by area
find src/ -name "*.tsx" -o -name "*.ts" | grep -v __tests__ | grep -v ".test." | wc -l
find src-tauri/src/ -name "*.rs" | wc -l
```

Save the output — you'll include it in every agent prompt.

---

## Step 2 — Spawn all 6 experts IN PARALLEL (single message, 6 Agent calls)

Send all 6 Agent tool calls in the same message. Each agent prompt must be self-contained.

Remind every agent in the prompt: **"Evidence-based only. Every finding needs file:line. Bugs need a failing test outline. Flag Rust-first migration candidates explicitly."**

### Agent 1: Product Improvement Expert
```
subagent_type: product-improvement-expert
prompt: "Review the mdownreview codebase for product improvement opportunities.

Context from recent work:
[INSERT GIT LOG OUTPUT]

Open GitHub issues:
[INSERT GH ISSUES OUTPUT OR "none"]

Read these files to do your analysis:
- src/App.tsx
- src/store/index.ts  
- src/components/viewers/ViewerRouter.tsx
- src/components/comments/CommentsPanel.tsx
- src/components/comments/CommentInput.tsx
- src/hooks/useFileContent.ts

IMPORTANT: Evidence-based only — cite file:line for every finding. Bugs get a failing test outline. Flag Rust-first candidates.

Then produce your Product Improvement Report."
```

### Agent 2: Performance Expert
```
subagent_type: performance-expert
prompt: "Review the mdownreview codebase for performance issues.

Context from recent work:
[INSERT GIT LOG OUTPUT]

Read these files:
- src-tauri/src/watcher.rs
- src-tauri/src/commands.rs
- src/hooks/useFileContent.ts
- src/hooks/useFileWatcher.ts
- src/store/index.ts
- src/components/viewers/MarkdownViewer.tsx (if it exists, else check ViewerRouter.tsx)

IMPORTANT: No finding without measurement or code-level evidence. Include benchmark stubs for flagged hotspots. Flag Rust migration candidates explicitly.

Then produce your Performance Analysis Report."
```

### Agent 3: Architect Expert
```
subagent_type: architect-expert
prompt: "Review the mdownreview architecture.

Context from recent work:
[INSERT GIT LOG OUTPUT]

Read these files:
- src/store/index.ts
- src/lib/tauri-commands.ts
- src-tauri/src/commands.rs
- src/App.tsx
- src/hooks/ (all files)

IMPORTANT: Evidence-based only — cite file:line. Flag TypeScript logic that should be in Rust with proposed command signatures. Bugs = Priority 1 with test outline.

Then produce your Architecture Review."
```

### Agent 4: React + Tauri Expert
```
subagent_type: react-tauri-expert
prompt: "Review mdownreview for React 19 and Tauri v2 API usage issues.

Context from recent work:
[INSERT GIT LOG OUTPUT]

Read these files:
- src/hooks/ (all files)
- src/lib/tauri-commands.ts
- src-tauri/src/commands.rs
- src-tauri/src/lib.rs

Also search for raw invoke() and listen() calls:
Grep for 'invoke(' in src/
Grep for 'listen(' in src/

IMPORTANT: Evidence-based only. Confirmed bugs get a failing test outline. Flag Rust-first migration candidates with proposed signatures.

Then produce your React 19 + Tauri v2 Expert Review."
```

### Agent 5: UX Expert
```
subagent_type: ux-expert
prompt: "Review mdownreview's user experience.

Context from recent work:
[INSERT GIT LOG OUTPUT]

Open GitHub issues:
[INSERT GH ISSUES OUTPUT OR "none"]

Read these files:
- src/App.tsx
- src/components/comments/CommentsPanel.tsx
- src/components/comments/CommentInput.tsx
- src/components/comments/SelectionToolbar.tsx
- src/components/WelcomeView.tsx

Also grep for 'tabIndex', 'aria-', 'onKeyDown' across src/ to check keyboard accessibility.

IMPORTANT: Evidence-based only — cite file:line. UX bugs get a test outline. Slow UX = flag for Rust-first fix.

Then produce your UX Review."
```

### Agent 6: Bug Hunter
```
subagent_type: bug-hunter
prompt: "Hunt for bugs in the mdownreview codebase.

Context from recent work:
[INSERT GIT LOG OUTPUT]

Read these files:
- src/hooks/ (all files — focus on useEffect cleanup and error handling)
- src/lib/comment-anchors.ts
- src/lib/comment-matching.ts
- src/lib/tauri-commands.ts
- src-tauri/src/commands.rs

Also grep for 'listen(' across src/ to check for missing unlisten() cleanup.

IMPORTANT: Every confirmed bug must include a failing test outline — no exceptions. Flag Rust-first opportunities where moving logic to Rust would eliminate the bug class.

Then produce your Bug Hunt Report."
```

---

## Step 3 — Wait for all 6 agents to complete

Do not proceed until all 6 have returned results.

---

## Step 4 — Cross-reference with GitHub issues

For each open GitHub issue, check which expert's findings address it. Note any issues that no expert found a root cause for — these need manual investigation.

---

## Step 5 — Synthesize the Improvement Plan

Write a consolidated report structured as:

```markdown
# mdownreview Improvement Plan
Generated: [date]

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
