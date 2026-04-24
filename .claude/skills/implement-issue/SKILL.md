---
name: implement-issue
description: Autonomously implements a groomed GitHub issue end-to-end on a single branch and single PR. Handles multi-phase specs by iterating phases on the same branch, posting a progress comment after each phase, and watching and fixing CI failures between phases. Accepts an optional issue number; defaults to the oldest open groomed issue.
---

# Implement Issue

Implements **one** GitHub issue end-to-end on **one branch and one PR**:
spec → plan → for each phase [implement → validate → review → commit → push → PR-open-or-comment → watch-CI → auto-fix] → mark PR ready.

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

## Step 3 — Extract the spec and detect phases

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
- **Phases** — if the spec has a "Phasing" / "Phases" section listing numbered items (e.g. `PR 1 — …`, `Phase 1: …`), parse into an ordered list of phase labels. If absent, treat the entire spec as a single phase labelled `Implementation`.

Phases are **internal milestones on one branch** — not separate PRs. The phase count controls the number of progress comments on the single PR.

---

## Step 4 — Create feature branch

```bash
git checkout main && git pull
BRANCH="feature/issue-<number>-<3-5-word-kebab-slug>"
git checkout -b "$BRANCH"
```

If the branch already exists (previous partial run): STOP with
`[implement-issue] Branch $BRANCH exists — resume is not supported. Delete the branch and PR, or implement remaining phases manually.`
(Do not delete either — they may contain user work.)

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

## Step 6 — Write implementation plan (covers EVERY phase)

Spawn a `general-purpose` agent:
```
Write a step-by-step implementation plan for GitHub issue #<number>: <title>.
The plan covers EVERY phase and is executed on a single branch and one PR — phases are internal milestones, not separate PRs.

Spec:
<full spec>

Detected phases:
<ordered list of phase labels, or "Single phase: Implementation" if none>

Expert guidance:
<advisory summary from Step 5>

For each phase, include:
- Files to change · exact changes · tests to write · dependencies on other phases
- Local validation expected to pass (lint, tsc, cargo test if Rust, npm test, e2e if UI-visible)
- Acceptance-criteria checkboxes satisfied by this phase (cite spec text)

Engineering meta-principles — all are non-negotiable (see docs/principles.md):
- **Rust-First with MVVM** (docs/principles.md; docs/architecture.md rules 1-10): Model = Rust (`src-tauri/src/core/`, `commands.rs`); ViewModel = `src/lib/vm/` + `src/hooks/` + `src/store/`; View = `src/components/`. A component that calls `invoke()` or holds business state is a layering violation. A hook that serializes YAML or computes anchors is a Rust-First violation.
- **Never Increase Engineering Debt**: every phase deletes dead code in the same phase (replaced functions, obsolete imports, superseded patterns). No TODOs, no half-wired code, no workarounds, no "fix later". Where a Gap from a deep-dive doc touches this area, close it.
- **Zero Bug Policy** (docs/test-strategy.md rule 9): every bug fix uses canonical architecture + patterns — not a workaround. Every fix ships with a regression test reproducing the original failure mode.
- **Charter-respecting**: no rule-violation in docs/architecture.md, docs/performance.md, docs/security.md, docs/design-patterns.md, docs/test-strategy.md. If a rule must change, propose it as a separate step — never silently bypass.
- **Full-stack completeness**: UI-visible behaviour → browser e2e in e2e/browser/ (rules 4-5 in docs/test-strategy.md); new Tauri commands → IPC mock update in src/__mocks__/@tauri-apps/api/core.ts.
- **Scope discipline**: implement exactly what the spec says — no extras, no scope creep.
```

Save the plan and parse into per-phase task groups.

---

## Step 7 — Phase loop

For **each phase in order** (1 to N), do 7a through 7g. State across phases: the branch, the PR number (once opened), and an accumulating progress checklist.

### 7a. Implement the phase

For each task in the current phase, spawn a `task-implementer` agent.
Run independent tasks in **one parallel message**; dependent tasks sequentially.

Each `task-implementer` prompt:
```
Implement this task for mdownreview:

GitHub Issue: #<number> — <title>
Phase: <phase N/M> — <phase label>
Task: <task from plan>
Files: <file list>
Changes: <detailed changes from plan>
Tests: <what to test>
Spec context: <relevant spec excerpt>

Do NOT ask clarifying questions. If ambiguous, make the conservative choice and note it.
Return an Implementation Summary: files modified · tests written · decisions made · concerns.
```

Collect all Implementation Summaries for this phase.

### 7b. Validate locally

Spawn `implementation-validator`:
```
Validate phase <N>/<M> (<label>) of issue #<number> in mdownreview.

Files changed in this phase: <list>
Tests written in this phase: <list>

Run in order:
1. npm run lint
2. npx tsc --noEmit
3. cargo test (only if Rust files changed)
4. npm test
5. npm run test:e2e (only if UI-visible behaviour changed)

Return PASS or FAIL with full output for any failures.
```

**If FAIL:** attempt one fix — spawn `task-implementer` with the failure output, then re-validate once.
If still failing: go to **Phase abort**.

### 7c. Code review

Capture the phase's diff:
```bash
git diff main --stat
git diff main
```

Spawn `superpowers:code-reviewer`:
```
Review phase <N>/<M> (<label>) of GitHub issue #<number>: <title>.
The review covers the cumulative diff on the branch, since phases share one PR.

Spec (source of truth for requirements):
<full spec>

Cumulative diff vs main:
<full diff>

Phase acceptance criteria (subset of spec):
<bullet list>

Check — flag blocking issues. Cite rule numbers from docs/*.md. Skip style nits.
1. Does every phase-scoped acceptance criterion pass?
2. Bugs, regressions, security issues (docs/security.md)?
3. Tests adequate — unit AND e2e browser for UI-visible changes (docs/test-strategy.md rules 4-5)?
4. Rust-first respected (docs/principles.md; docs/architecture.md rules 1-10)?
5. Architecture rules (docs/architecture.md) — direct invoke outside tauri-commands.ts, direct plugin-log outside logger.ts, cross-slice coupling, file >400 lines?
6. Design-pattern rules (docs/design-patterns.md) — missing cancellation, missing unlisten cleanup, non-module-scope components map, useState that should be Zustand?
7. Performance rules (docs/performance.md) — uncapped scan, rebuilt-per-render heavy object, missing debounce?
8. Dead code, unused imports, replaced functions, obsolete patterns NOT cleaned up?
9. Technical debt introduced — TODO comments, half-implemented wiring, bypassed safety checks, workarounds intended for later?
10. If a new Tauri command was added, is the IPC mock in src/__mocks__/@tauri-apps/api/core.ts updated (docs/test-strategy.md rule 5)?
```

**If blocking issues:** one fix attempt (same retry pattern as 7b), then re-review once.
If issues persist: go to **Phase abort**.

### 7d. Commit

```bash
git add <specific changed files — never git add -A>
```

Final phase:
```bash
git commit -m "$(cat <<'EOF'
feat(#<number>): <phase label>

<2-3 sentence summary of what this phase implemented>

Closes #<number>

Co-authored-by: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

Non-final phases: same message structure but with `Refs #<number>` instead of `Closes`.

### 7e. Push and open-or-comment on PR

```bash
git push -u origin HEAD
```

**First phase only** — open a DRAFT PR:
```bash
gh pr create --draft \
  --title "feat: implement #<number> — <title>" \
  --body "$(cat <<'EOF'
## Summary

Implements #<number> in <M> phases on one branch. PR stays draft until every phase passes local validation, code review, and CI.

## Progress

- [x] Phase 1/<M> — <phase 1 label> (<short-sha>)
- [ ] Phase 2/<M> — <phase 2 label>
- [ ] ... (remaining phases)

## Acceptance Criteria

<paste full checklist from spec>

---
Closes #<number>
EOF
)"
```

Capture the PR number.

**Subsequent phases** — post a progress comment and update the PR body checklist:
```bash
gh pr comment <pr-number> --body "$(cat <<'EOF'
<!-- mdownreview-impl-phase-<N> -->
### ✅ Phase <N>/<M> — <phase label>

**Commit:** <short-sha>
**Files changed:** <count>
**Tests added/updated:** <count>
**Acceptance criteria satisfied:**
<bullet list of checkbox items this phase finished>

Next: Phase <N+1>/<M> — <next phase label>
EOF
)"

# Then refresh the PR body's progress checklist (tick the just-finished phase):
gh pr edit <pr-number> --body "$(cat <<'EOF'
...updated body with one more [x]...
EOF
)"
```

### 7f. Watch CI and auto-fix failures

After each push, wait for the run to register, then watch it. Up to **2 fix attempts per phase**.

```bash
# Give the run ~10s to appear
for i in 1 2 3 4 5; do
  RUN_ID=$(gh run list --branch "$BRANCH" --limit 1 --json databaseId --jq '.[0].databaseId')
  [ -n "$RUN_ID" ] && break
  sleep 2
done
[ -z "$RUN_ID" ] && { echo "::warning::No CI run detected for $BRANCH"; } || \
  gh run watch "$RUN_ID" --exit-status
```

If `gh run watch` exits non-zero:
1. Pull failing logs: `gh run view "$RUN_ID" --log-failed`
2. Spawn a `task-implementer` with the truncated failure output, the phase label, and the spec context. Instruct: "Fix the CI failure without changing the spec's intent. Prefer tightening existing code over adding new abstractions."
3. Commit the fix: `git add <files> && git commit -m "fix(ci): <summary of the CI fix>"`
4. Push: `git push`
5. Re-watch CI. Repeat up to 2 times total per phase.

If CI is still red after 2 fix attempts: go to **Phase abort**.

On CI recovery (was red, now green), post a short comment on the PR:
```bash
gh pr comment <pr-number> --body "<!-- mdownreview-impl-ci-recover-<N> -->
🟢 CI recovered on phase <N>/<M> after <K> fix attempt(s). Latest run: <run-url>"
```

### 7g. Advance

If this is the final phase: go to Step 8.
Otherwise: continue to the next phase at 7a.

---

## Step 8 — Mark PR ready

After the final phase's CI is green:
```bash
gh pr ready <pr-number>
```

Refresh the PR body so every phase checkbox is ticked and the summary states "Ready for review — all phases complete."

Print:
```
✅ #<number> — <title>
   PR: <pr-url> (ready for review)
   Branch: <branch-name>
   Phases completed: <M>/<M>
```

---

## Phase abort

When a phase fails local validation, code review, or CI after the allowed retries:

1. **Do NOT delete the branch or close the PR.** Partial progress must stay available for human pickup.
2. Ensure the PR is in draft state:
   ```bash
   gh pr ready <pr-number> --undo 2>/dev/null || true
   ```
3. Comment on the PR:
   ```bash
   gh pr comment <pr-number> --body "$(cat <<'EOF'
   <!-- mdownreview-impl-abort -->
   ## ⚠️ Autonomous implementation halted at Phase <N>/<M>: <phase label>

   **Stage that failed:** <local validation | code review | CI>
   **Reason:** <short human-readable reason>
   **Log excerpt (truncated):**
   ```
   <last ~40 lines of the relevant output>
   ```

   Phases 1..<N-1> are complete and pushed. Phase <N> needs human attention. Retry the whole issue after fixing the blocker with `/implement-issue <number>` (the branch must first be deleted) or continue manually on this branch.
   EOF
   )"
   ```
4. Comment on the issue with the same message (replace `<!-- mdownreview-impl-abort -->` with `<!-- mdownreview-impl-abort-issue -->`):
   ```bash
   gh issue comment <number> --body "..."
   ```
5. Print:
   ```
   ❌ #<number> — <title>
      Halted at phase <N>/<M> (<stage>): <reason>
      PR (draft): <pr-url>
      Branch: <branch-name>
   ```

Exit.

---

## Notes

- **One issue = one branch = one PR** — regardless of phase count. Phases are internal milestones communicated via commit messages, per-phase PR comments, and the PR body's progress checklist.
- The `<!-- mdownreview-spec -->` comment from `/groom-issues` is the source of truth — if no spec is present, this skill stops and tells you to groom first.
- **Retries per phase:** 1 for local validation, 1 for code review, 2 for CI. Exceeding any limit triggers **Phase abort**, which preserves the branch and PR in draft.
- The `groomed` label stays on the issue until the PR merges and the issue closes.
- Resume is not supported — if the branch already exists from a prior run, the skill stops so a human can decide whether to discard or continue manually.
