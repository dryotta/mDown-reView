---
name: implement-issue
description: Autonomously implements one groomed GitHub issue. Reads the spec comment, plans, implements on a feature branch, validates, code reviews, and creates a PR. Accepts an optional issue number; defaults to the oldest open groomed issue. Run /groom-issues first to attach a spec.
---

# Implement Issue

Implements **one** GitHub issue end-to-end: spec → plan → implement → validate → review → PR.  
**Fully autonomous after the skill starts — no user interaction.**

**RIGID. Follow every step exactly.**

## Product charter (governs every implementation)

Every change must respect the product charter. Read the relevant doc before editing its domain:

- **Charter (always):** [`docs/principles.md`](../../../docs/principles.md) — 5 pillars (Professional, Reliable, Performant, Lean, Architecturally Sound) + 3 meta-principles (Rust-First with MVVM, Never Increase Engineering Debt, Zero Bug Policy).
- [`docs/architecture.md`](../../../docs/architecture.md) — IPC/logger chokepoints, Zustand boundaries, file-size budgets.
- [`docs/performance.md`](../../../docs/performance.md) — numeric budgets, watcher rules, render-cost rules.
- [`docs/security.md`](../../../docs/security.md) — IPC surface, CSP, atomic writes, path canonicalization.
- [`docs/design-patterns.md`](../../../docs/design-patterns.md) — React 19 + Tauri v2 idioms.
- [`docs/test-strategy.md`](../../../docs/test-strategy.md) — three-layer pyramid, coverage floors, mock hygiene.

The plan step, code review step, and validator all cite specific rule numbers. An implementation that violates a rule is not merged, regardless of whether tests pass.

## Input

Optional: one issue number (e.g. `/implement-issue 36`).  
If not provided, the skill picks the oldest open issue labelled `groomed`.

---

## Step 1 — Pre-flight

Run in parallel:
```bash
git status --porcelain
git branch --show-current
```

If dirty: STOP — `[implement-issue] Working tree is dirty. Commit or stash changes first.`  
If not on main: `git checkout main && git pull`

---

## Step 2 — Select issue

**If issue number provided:**
```bash
gh issue view <number> --json number,title,body,labels,comments
```

**If no number provided** — pick the oldest groomed open issue:
```bash
gh issue list --label "groomed" --state open --json number,title,body,labels --limit 100 \
  | jq 'sort_by(.number) | .[0]'
```

If nothing found:
```
[implement-issue] No groomed issues found. Run /groom-issues first.
```
Exit.

Print: `[implement-issue] Implementing #<number>: <title>`

---

## Step 3 — Extract the spec

```bash
gh issue view <number> --json number,title,body,comments
```

Search comments for `<!-- mdownreview-spec -->`. Extract its full content.

**If no spec found:** STOP:
```
[implement-issue] ⚠ #<number> has no spec. Run /groom-issues #<number> first.
```

Parse from the spec:
- **Problem Statement**
- **Proposed Approach**
- **Acceptance Criteria** (the checkbox list)
- **Technical Notes** (files, dependencies)
- **Constraints & Non-Goals**

---

## Step 4 — Create feature branch

```bash
git checkout main && git pull
git checkout -b feature/issue-<number>-<3-5-word-kebab-slug>
```

---

## Step 5 — Consult experts (parallel)

Spawn relevant expert agents in **one message** (all in parallel). Select agents based on what the spec touches:

| Spec mentions | Spawn |
|---|---|
| IPC, Rust commands, store structure | `architect-expert` |
| React components, Tauri events, hooks | `react-tauri-expert` |
| File I/O, IPC commands, markdown rendering | `security-reviewer` |
| Logic on large inputs, render performance | `performance-expert` |

Each expert prompt:
```
I'm implementing GitHub issue #<number>: <title>

Spec:
<full spec>

From your area of expertise:
1. Key considerations for this implementation
2. Risks or pitfalls to watch for
3. Which files to modify and how

Cite file:line for every recommendation. If the spec looks sound, say so in one line.
```

Wait for all experts. Synthesise their guidance into a short advisory summary.

---

## Step 6 — Write implementation plan

Spawn a `general-purpose` agent:
```
Write a step-by-step implementation plan for GitHub issue #<number>: <title>

Spec:
<full spec>

Expert guidance:
<advisory summary from Step 5>

For each step include: file(s) to change · exact changes · tests to write · dependencies on other steps.

Engineering meta-principles — all are non-negotiable (see docs/principles.md):
- **Rust-First with MVVM** (docs/principles.md meta-principle; rules 1-10 in docs/architecture.md): Model = Rust (`src-tauri/src/core/`, `commands.rs`); ViewModel = `src/lib/vm/` + `src/hooks/` + `src/store/`; View = `src/components/`. A component that calls `invoke()` or holds business state is a layering violation. A hook that serializes YAML or computes anchors is a Rust-First violation. Plan accordingly.
- **Never Increase Engineering Debt** (docs/principles.md meta-principle): the plan must hold debt flat or reduce it. Every change deletes dead code in the same PR (replaced functions, obsolete imports, superseded patterns). No TODOs, no half-wired code, no workarounds, no "fix later". Where a Gap from a deep-dive doc touches this area, close it in this PR.
- **Zero Bug Policy** (docs/principles.md meta-principle; rule 9 in docs/test-strategy.md): every bug fix uses the canonical architecture in docs/architecture.md and the canonical patterns in docs/design-patterns.md — not a workaround. Every fix ships with a regression test reproducing the original failure mode (failing → passing).
- **Charter-respecting**: the plan must not violate any rule in docs/architecture.md, docs/performance.md, docs/security.md, docs/design-patterns.md, or docs/test-strategy.md. If it must, propose a rule change as a separate step — do not silently bypass.
- **Full-stack completeness**: UI-visible behaviour changes require a browser e2e test in e2e/browser/ in addition to unit tests (rules 4-5 in docs/test-strategy.md); new Tauri commands require the IPC mock in src/__mocks__/@tauri-apps/api/core.ts to be updated (rule 5 in docs/test-strategy.md).
- **Scope discipline**: implement exactly what the spec says — no extras, no scope creep.
```

Save the returned plan.

---

## Step 7 — Implement

For each task in the plan, spawn a `task-implementer` agent.  
Run independent tasks in **one parallel message**; dependent tasks sequentially.

Each `task-implementer` prompt:
```
Implement this task for mdownreview:

GitHub Issue: #<number> — <title>
Task: <task from plan>
Files: <file list>
Changes: <detailed changes from plan>
Tests: <what to test>
Spec context: <relevant spec excerpt>

Do NOT ask clarifying questions. If ambiguous, make the conservative choice and note it.
Return an Implementation Summary: files modified · tests written · decisions made · concerns.
```

Collect all Implementation Summaries.

---

## Step 8 — Validate

Spawn `implementation-validator`:
```
Validate the implementation of issue #<number> in mdownreview.

Files changed: <list from Step 7>
Tests written: <list from Step 7>

Run in order:
1. npm run lint
2. npx tsc --noEmit
3. cargo test (only if Rust files changed)
4. npm test
5. npm run test:e2e

Return PASS or FAIL with full output for any failures.
```

**If FAIL:** attempt one fix — spawn `task-implementer` with the failure output, then re-validate once.  
If still failing: go to **Abort**.

---

## Step 9 — Code review

Capture the diff:
```bash
git diff main --stat
git diff main
```

Spawn `superpowers:code-reviewer`:
```
Review the implementation of GitHub issue #<number>: <title> for mdownreview.

Spec (source of truth for requirements):
<full spec>

Diff:
<full diff>

Check — flag blocking issues for any of these. Cite rule numbers from docs/*.md where possible. Skip style nits.
1. Does every Acceptance Criterion pass?
2. Are there bugs, regressions, or security issues? (docs/security.md rules)
3. Are tests adequate — unit tests AND e2e browser tests for any UI-visible behaviour change? (docs/test-strategy.md rules 4-5)
4. Does it follow Rust-first? (docs/principles.md meta-principle; docs/architecture.md rules 1-10)
5. Does it violate any architecture rule (docs/architecture.md) — direct invoke outside tauri-commands.ts, direct plugin-log outside logger.ts, cross-slice coupling, file >400 lines?
6. Does it violate any design-pattern rule (docs/design-patterns.md) — missing cancellation, missing unlisten cleanup, non-module-scope components map, useState for UI state that should be Zustand?
7. Does it violate any performance rule (docs/performance.md) — uncapped scan, rebuilt-per-render heavy object, missing debounce?
8. Is there any dead code, unused import, replaced function, or obsolete pattern that was NOT cleaned up?
9. Does any part of this change introduce technical debt — TODO comments, half-implemented wiring, bypassed safety checks, or workarounds intended for later?
10. If a new Tauri command was added, is the IPC mock in src/__mocks__/@tauri-apps/api/core.ts updated? (docs/test-strategy.md rule 5)
```

**If blocking issues:** attempt one fix (same pattern as Step 8), then re-review once.  
If issues persist: go to **Abort**.

---

## Step 10 — Commit and PR

```bash
git add <specific changed files — never git add -A>
git commit -m "feat: implement #<number> — <title>

<2-3 sentence summary of what was implemented>

Closes #<number>

Co-authored-by: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

```bash
git push -u origin HEAD
gh pr create \
  --title "feat: implement #<number> — <title>" \
  --body "$(cat <<'EOF'
## Summary
<bullet list of key changes>

## Tests
<tests added>

## Acceptance Criteria
<paste checklist from spec>

---
Closes #<number>
EOF
)"
```

Print:
```
✅ #<number> — <title>
   PR: <pr-url>
   Branch: <branch-name>
```

---

## Abort

If validation or review fails after one retry:

```bash
git checkout main
git branch -D <branch-name>
```

Post a comment on the issue:
```bash
gh issue comment <number> --body "<!-- mdownreview-impl-attempt -->
## ⚠️ Automated Implementation Attempt Failed

**Reason:** <failure reason>
**What was tried:** <brief approach summary>

The issue remains groomed. Retry with \`/implement-issue <number>\` or implement manually."
```

Print:
```
❌ #<number> — <title>
   Implementation failed. Branch discarded. Comment posted on issue.
   Reason: <failure reason>
```

---

## Notes

- This skill implements exactly one issue. To implement multiple issues, run it once per issue.
- The `<!-- mdownreview-spec -->` comment written by `/groom-issues` is the source of truth — if no spec is present, this skill stops and tells you to groom first.
- One retry is allowed for validation and review failures. After that the issue is skipped and stays labelled `groomed` so it can be retried.
- The `groomed` label stays on the issue until the PR merges and the issue closes.
