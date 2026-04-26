---
name: iterate-one-issue
description: Use when the user asks to fix a specific GitHub issue, references one (`#42`, `issue-42`, an issue URL), or asks to pursue a freeform engineering goal — phrases like "work on issue 42", "implement #87", "fix this bug", "add a CSV export". Fully autonomous single-branch / single-PR loop. Does NOT pick from the backlog — pair with `iterate-loop` for that. Bug-labelled issues run root-cause + test-gap analysis. Charter rules in AGENTS.md govern every iteration.
---

**RIGID. Follow every step exactly.** This skill is **fully autonomous — it never calls `ask_user`.** Assume the user is unavailable. Where a human checkpoint used to exist (clarification, sign-off), the skill now writes the question or status to GitHub (issue comment + label) and either defers the issue (issue mode) or halts gracefully (goal mode). Pre-consult experts and the diff-review panel cite specific rule numbers; rule-violating diffs block at review even if green.

This skill owns **one issue or one goal** end-to-end: branch → plan → implement → test → review → PR → retrospective → terminal Done-X. It never reads the backlog and never picks the next thing. The companion skill **`iterate-loop`** handles backlog selection, claiming (`iterate-in-progress` label), and chaining.

---

## Phase 0 — Setup

### 0a. Parse arg → mode

Let `ARG` = trimmed string after skill name. First match wins:

| Pattern | Result |
|---|---|
| `^--resume-rg\s+(\S+)$` | `MODE=resume-rg`, `BRANCH=$1`. Skips 0b–0h entirely; jumps to Step 9b–d-resume per [references/release-gate.md § 9b–d](references/release-gate.md#9bd--resume-idempotent-re-entry). Pre-conditions (caller's responsibility): cwd is the worktree where `<BRANCH>` is checked out, `git status` is clean, and `.claude/iterate-state-<branch-slug>.md` exists with `release_gate.state ∈ {dispatched, failed, passed}`. Used by `iterate-loop --pipeline` from yield points. |
| `^\d+$` | `MODE=issue`, `ISSUE_NUMBER=ARG` |
| `^#(\d+)$` | `MODE=issue`, group 1 |
| `^[Ii]ssue-(\d+)$` | `MODE=issue`, group 1 |
| `^https?://github\.com/[^/]+/[^/]+/issues/(\d+)([/#?].*)?$` | `MODE=issue`, group 1 |
| empty | STOP `[iterate-one-issue] No issue or goal supplied. Pass an issue ref (#42 / URL) or a freeform goal sentence; for backlog drain use \`/iterate-loop\`.` |
| else | `MODE=goal`, `GOAL_TEXT=ARG` (strip surrounding quotes) |

### 0b. Pre-flight (parallel)

```bash
git status --porcelain
git branch --show-current
git rev-parse HEAD
```

- Dirty tree → STOP `[iterate-one-issue] Working tree is dirty. Commit or stash first.`
- Not on `main` → `git checkout main && git pull --ff-only`.

**Recursion-marker hygiene** (Phase 2e cleanup contract):
```bash
DEPTH_FILE=".claude/iterate-recursion-depth"
if [ -f "$DEPTH_FILE" ]; then
  AGE=$(( $(date +%s) - $(stat -c %Y "$DEPTH_FILE" 2>/dev/null || stat -f %m "$DEPTH_FILE") ))
  [ "$AGE" -gt 86400 ] && rm -f "$DEPTH_FILE"
fi
```

### 0c. Load spec (issue mode)

```bash
gh issue view $ISSUE_NUMBER --json number,title,body,labels,comments
```

Capture `ISSUE_TITLE`, `ISSUE_BODY`, `LABELS`. Resolve `SPEC_MARKDOWN` (first match):

1. Comment starting with `<!-- mdownreview-spec -->` → use verbatim. `SPEC_SOURCE=groomed`.
2. Else derive: `<!-- mdownreview-spec (derived from issue body — not groomed) -->\n\n# $ISSUE_TITLE\n\n$ISSUE_BODY\n\n## Acceptance criteria\n\n<see rules>`. `SPEC_SOURCE=derived`. Do **not** halt or call `/groom-issues`.

Acceptance-criteria derivation (in order):
- Body has `- [ ]` / `- [x]` lines → reuse verbatim.
- Body has `## Acceptance` / `## Success` / `## Done when` → convert that section's bullets to `- [ ]`.
- Free-form → synthesise 1–3 minimal items, e.g. `- [ ] $ISSUE_TITLE — verifiable by <signal>`.

Set `ACCEPTANCE_CRITERIA` from the resolved spec (parsed `- [ ]` / `- [x]` lines). This becomes the assessor's `REQUIREMENTS` (see 0e) — the **only** definition of done for issue mode.

**Bug-mode flag.** `IS_BUG = true` if any:
- `LABELS` ∋ `bug` | `regression` | `defect`.
- Title (case-insensitive) starts with `bug:` | `fix:` | `regression:`, or contains `[bug]` | `[regression]`.
- Body has `## Steps to reproduce` / `## Reproduction` / `## Expected` + `## Actual`.

### 0d. Clarification questions (no user prompt — defer to grooming)

This skill **never calls `ask_user`**. If after reading the issue body, comments, deep-dive docs, and the assessor's view of `REQUIREMENTS` the goal is still genuinely ambiguous (scope boundaries, observable success signal, internal contradictions), do **not** guess and do **not** stop the autonomous run silently. Instead:

1. **Goal mode** — there is no issue to update. Proceed with the most defensible interpretation of `GOAL_TEXT`, capture the ambiguity as a `### Operator clarifications (deferred)` block in the PR description, and continue.

2. **Issue mode** — defer to grooming:
   ```bash
   gh issue comment $ISSUE_NUMBER --body "$(cat <<'EOF'
   <!-- iterate-needs-grooming -->
   ## /iterate-one-issue halted — clarification needed before autonomous work can proceed

   The autonomous iteration loop attempted to pick up this issue but found the goal under-specified for the assessor (scope, success signal, or internal contradictions). The following blocking questions need answers before /iterate-one-issue can implement safely:

   <numbered list of ≤5 questions, each one sentence, each citing the ambiguity in the spec>

   Once answered, remove the `needs-grooming` label (or run `/groom-issues $ISSUE_NUMBER`). The next `/iterate-loop` sweep will pick this issue up automatically.
   EOF
   )"
   gh issue edit $ISSUE_NUMBER --add-label "needs-grooming"
   ```
   Then STOP `[iterate-one-issue] Issue #$ISSUE_NUMBER deferred to grooming. See comment.` Exit cleanly so the calling `iterate-loop` (if any) can move on to the next eligible issue.

**Bias is to skip this branch entirely.** Never defer over: implementation detail, anything answered by deep-dive docs, anything the assessor can discover from the codebase, style/naming/framework choices. Only defer for genuine spec ambiguity.

After 0e, no GitHub-side spec changes; the loop runs purely against the captured `REQUIREMENTS`.

### 0e. Compute branch / PR title / goal

| Var | Issue mode | Goal mode |
|---|---|---|
| `BRANCH` | `feature/issue-$ISSUE_NUMBER-<3–5-word slug>` | `auto-improve/<slug, 40-cap>-$(date +%Y%m%d)` |
| `PR_TITLE` | `feat: implement #$ISSUE_NUMBER — $ISSUE_TITLE` | `auto-improve: $GOAL_TEXT` |
| `GOAL_FOR_ASSESSOR` | `Satisfy all acceptance criteria of #$ISSUE_NUMBER: $ISSUE_TITLE` | `$GOAL_TEXT` |
| `REQUIREMENTS` | `$ACCEPTANCE_CRITERIA` (verbatim `- [ ]` / `- [x]` lines) | synthesise 1–3 `- [ ]` items from `$GOAL_TEXT`, e.g. `- [ ] <one-line restatement> — verifiable by <signal>` |
| `PR_CLOSE_TRAILER` | `Closes #$ISSUE_NUMBER` | (omit) |

Slug: lowercase, non-alphanum → `-`, collapse runs, trim.

### 0f. Branch + draft PR

```bash
git checkout main && git pull --ff-only
git checkout -b "$BRANCH"
```

Pre-existing branch (local OR remote) → STOP `[iterate-one-issue] Branch $BRANCH already exists. Delete or pick a different invocation — resume not supported.` Do **not** delete.

```bash
git commit --allow-empty -m "chore(iterate): start — $GOAL_FOR_ASSESSOR"
git push -u origin HEAD
git config rerere.enabled true
git config rerere.autoupdate true
```

`PR_BODY`:
- Issue mode: links to issue · pastes full `$REQUIREMENTS` checklist (unchecked) · trailer `Closes #$ISSUE_NUMBER`.
- Goal mode: header quotes `$GOAL_TEXT` · pastes `$REQUIREMENTS` checklist (unchecked) under a `## Progress` heading. Step 8 ticks these as the assessor marks them `met`.

```bash
gh pr create --draft --title "$PR_TITLE" --body "$PR_BODY"
```

Capture `PR_NUMBER`, `PR_URL`.

### 0g. State file — `.claude/iterate-state-<branch-slug>.md`

`<branch-slug>` = `BRANCH` with `/` → `-` (e.g. `feature-issue-42-csv-export`). Per-branch path so colocated worktrees never collide on a single state file.

```markdown
---
mode: <issue | goal>
goal: "<GOAL_FOR_ASSESSOR>"
issue_number: <ISSUE_NUMBER or null>
started_at: <ISO datetime>
branch: <BRANCH>
worktree: <absolute path of working tree, or "." if none>
pr: <PR_URL>
pr_number: <PR_NUMBER>
iter_base_sha: <SHA — set/refreshed at every Step 1 "After successful rebase">
iteration_cap: 30
release_gate:
  state: <not-started | dispatched | passed | failed | skipped>
  ref: <BRANCH validated by release-gate.yml — same as `branch` above>
  workflow_run_id: <run ID from `gh workflow run`, or null>
  dispatched_at: <ISO datetime, or null>
  forward_fix_attempts: 0
  step_at_suspend: <9b | 9c | 9d | null>
---
# Iteration Log
```

**Resume contract.** Every field above is the source of truth — Step 9b–d-resume reads cold from this file and may run from a different CLI session than the one that wrote 9a. The companion `iterate-loop` (in pipeline mode) and the `/iterate-resume` entry point both rely on this. Other steps update `iter_base_sha` (Step 1) and `release_gate.*` (Step 9a/c/d); never write through these from anywhere else.

### 0h. Banner

```
[iterate-one-issue] Mode: <MODE> | Goal: <GOAL_FOR_ASSESSOR>
<issue mode:> Issue: #<ISSUE_NUMBER> | Spec source: <SPEC_SOURCE> | Bug-mode: <IS_BUG>
Branch: <BRANCH> | PR: <PR_URL>
Starting autonomous loop — cap 30. Per-iteration retrospectives committed to this branch.
```

---

## Phase 1 — Iteration loop

Counters: `iteration=1`, `passed_count=0`, `degraded_count=0`. Run Steps 1–8 each iteration. Termination fires only at Step 1 (rebase abort) or Step 2 (`achieved`/`blocked`) or end-of-iteration cap.

### Step 1 — Rebase onto `origin/main`

```bash
git fetch origin main
if git merge-base --is-ancestor origin/main HEAD; then
  echo "[sync] already contains origin/main"
else
  git rebase --strategy=recursive --strategy-option=diff3 origin/main
fi
```

Clean exit → skip to "After successful rebase".

**Conflict auto-resolution loop.** Counters: `attempt=0`, `max_attempts_per_commit=3`, `max_total_commits=20`, `commits_replayed=0`.

While `.git/rebase-merge` or `.git/rebase-apply` exists:

1. Detect (parallel):
   ```bash
   CONFLICTED=$(git diff --name-only --diff-filter=U)
   HAS_MARKERS=$(git grep -lE '^<<<<<<< ' -- . 2>/dev/null || true)
   ```
2. Empty/rerere-resolved (`CONFLICTED` empty AND `HAS_MARKERS` empty):
   ```bash
   git add -A
   git -c core.editor=true rebase --continue 2>/dev/null || git rebase --skip
   ```
   `commits_replayed += 1`, `attempt = 0`. Continue.
3. Else dispatch one `exe-task-implementer` per conflicted file in ONE message:
   ```
   Resolve merge conflicts in <FILE> from rebasing iterate branch onto main.
   Goal: <GOAL_FOR_ASSESSOR>  Iteration: <N>  Attempt: <attempt+1>/<max>
   diff3 markers: <<< ours / ||||||| base / === / >>> theirs
   - ours = iterate work · base = ancestor · theirs = incoming main.
   - rerere caches your resolution — prefer principled over one-off.
   - Preserve intent of BOTH sides. If main moved/renamed code ours touched, adapt ours to main's shape — never revert main.
   - Remove ALL markers. Do NOT git add or rebase --continue.
   - If semantically impossible, say so and leave markers — escalation will follow.
   Return: file path, resolution summary, confidence 0–100.
   ```
4. ```bash
   git add -A
   git -c core.editor=true rebase --continue
   RC=$?
   ```
5. Outcome:
   - `RC=0` & rebase ongoing → `commits_replayed += 1`, `attempt = 0`, continue.
   - `RC=0` & rebase done → break.
   - `RC≠0` & `attempt < max` → `attempt += 1`, re-run step 3 with augmented prompt (prior attempt + still-present markers).
   - `RC≠0` & `attempt == max` → escalate ONCE to `architect-expert` with full file + diff-from-main + diff-from-ours + prior implementer summaries. Apply, retry step 4.
   - Still failing OR `commits_replayed > 20` → Abort.
6. **Abort:**
   ```bash
   git rebase --abort
   ```
   State file:
   ```markdown
   ## Iteration <N> — BLOCKED (merge conflict)
   - Conflicted commit: <SHA>
   - Files: <list>
   - Attempts: <implementer retries + 1 architect>
   - Summary: <text>
   ```
   Jump to **Done-Blocked** reason `merge conflict against main at iteration <N>`.

**After successful rebase:**
```bash
git push --force-with-lease
ITER_BASE_SHA=$(git rev-parse HEAD)   # bounds Step 7 review diff
npx tsc --noEmit
(cd src-tauri && cargo check)
```

If sanity gate fails → `exe-task-implementer` fixes as follow-up commit; commit + push; only then proceed.

### Step 2 — Assess

Spawn `exe-goal-assessor` (one call). Pass:
- `goal = $GOAL_FOR_ASSESSOR`
- `requirements = $REQUIREMENTS` (verbatim — the per-item checklist is the **only** source of truth for "done")
- `iteration_number`
- `iteration_log` = full state-file content (outcomes only — never prior specs)
- `context` (optional) = SPEC_MARKDOWN excerpt clarifying what each requirement means; in goal mode, omit or pass a one-paragraph restatement.

Do **not** pass `ISSUE_NUMBER`, `ISSUE_TITLE`, `ISSUE_BODY`, the `<!-- mdownreview-spec -->` marker, or any GitHub-shaped reference. The assessor is intentionally GitHub-agnostic so it cannot lean on issue context to declare done — only the explicit requirements list.

Instruction: read code from scratch, mark every requirement `met` or `unmet` with file:line or command output, and return the exact template (STATUS / CONFIDENCE / REQUIREMENTS / NEXT_REQUIREMENTS / BLOCKING_REASON). `achieved` requires every requirement `met`; even one `unmet` ⇒ `in_progress`. Empty `NEXT_REQUIREMENTS` with ≥1 unmet requirement ⇒ `blocked` pointing at the unreachable requirement.

Routing:
- `achieved` → **Done-Achieved** (no commit).
- `blocked` → **Done-Blocked** (no commit).
- `in_progress` → Step 3.

### Step 3 — Demand-driven pre-consult (parallel)

Scan `NEXT_REQUIREMENTS` for triggers; spawn matched experts in ONE parallel message. If no trigger AND `IS_BUG` false, skip.

| Trigger (keyword/path) | Expert |
|---|---|
| "IPC", "Tauri command", "invoke", `src-tauri/src/commands.rs`, `src/lib/tauri-commands.ts`, `src/store/*` | `architect-expert` |
| "React component", "hook", "Zustand", `src/components/`, `src/hooks/`, `src/store/` | `react-tauri-expert` |
| "file read/write", "path", "markdown render", `src-tauri/src/core/sidecar.rs`, `MarkdownViewer` | `security-expert` |
| "startup", "debounce", "throttle", "watcher", "large file", "render cost" | `performance-expert` |
| any source change (≈ always) | `test-expert` |
| change to `docs/features/`, `AGENTS.md`, `BUILDING.md`, `docs/**/*.md` | `documentation-expert` |
| new `package.json`/`Cargo.toml` dep, large module, budget-relevant LOC | `lean-expert` |
| `IS_BUG=true` AND `iteration==1` (once per loop) | `bug-expert` (Step 3a) |

Each prompt:
```
Iteration <N> for <MODE> <ref>.  Goal: <GOAL_FOR_ASSESSOR>
NEXT_REQUIREMENTS: <…>   REQUIREMENTS (with met/unmet evidence): <…>
From your area: (1) considerations, (2) risks, (3) files to modify and how.
Cite file:line for every recommendation; cite rule numbers from docs/*.md when applicable. If sound, say so in one line.
```

Aggregate to `ADVISORY_SUMMARY`. None → `"none — no expert domains triggered"`.

#### Step 3a — Bug RCA + test-gap (only `IS_BUG && iteration==1`)

Same parallel message. Zero Bug Policy requires the regression test that *would have caught* the bug, so the fix plan must wait for this output.

Spawn `bug-expert`:
```
Root-cause this bug. Output gates iteration-1 plan.
Issue: #<ISSUE_NUMBER> — <ISSUE_TITLE>
Body / repro: <ISSUE_BODY>
Spec: <SPEC_MARKDOWN>

Deliver, with file:line + commit SHAs:
1. Reproduction — minimum sequence. If you cannot repro, say so — don't guess.
2. Root cause — defect in code (not symptom), file:line.
3. Introduction — git log -S '<token>' / log -p --follow / blame to find SHA, author date, PR, original intent, why it failed.
4. Test gap — which existing test should have caught it (wrong oracle? mocked failing layer?) OR which layer is missing. Cite docs/test-strategy.md rule.
5. Regression-test plan — file path, layer (unit/browser-e2e/native-e2e), name, assertion, repro input. MUST fail before fix and pass after.
6. Fix direction — one paragraph, canonical (architecture + design-patterns aligned) shape. Not the diff.
7. Adjacent risk — other call-sites with the same root cause.
```

Capture `BUG_RCA`. Append regression-test plan + fix direction to `ADVISORY_SUMMARY`.

If RCA inconclusive: do NOT halt — log `DEGRADED — bug-mode RCA inconclusive: <summary>` to state file + iter-1 retro and continue. Plan must still include a regression test for the observable failure mode; speculative fixes without a test are forbidden.

### Step 4 — Plan

Spawn `general-purpose`:
```
Comprehensive sprint plan for this iteration. Identify ALL changes — do not artificially narrow scope.

Goal: <GOAL_FOR_ASSESSOR>   Iteration: <N>/30   Mode: <MODE>
<issue mode:>
Spec excerpt: <relevant SPEC_MARKDOWN sections>
Remaining AC: <open bullets>
<end>
NEXT_REQUIREMENTS: <…>
ADVISORY_SUMMARY: <…>
<if IS_BUG && iteration==1:>
BUG_RCA (load-bearing): <verbatim>
The first plan group MUST add the regression test from BUG_RCA §5. Fix MUST follow §6 canonical shape. No fix without a corresponding test = Zero Bug Policy violation.
<end>

Use NEXT_REQUIREMENTS grouping: independent groups parallel; dependents wait.
Per group: files · exact changes · tests · group dependencies · expected local validation · AC items satisfied (issue mode, cite spec).
Rate overall risk: low | medium | high.

Completeness rules (non-negotiable, per docs/test-strategy.md rules 4-5):
- UI-visible change → browser e2e in e2e/browser/ AND native e2e in e2e/native/ if real I/O or IPC.
- New Tauri command → commands.rs + tauri-commands.ts + IPC mock in src/__mocks__/@tauri-apps/api/core.ts.
- Delete code made obsolete in the same step. No TODOs, half-wires, workarounds.
```

Save as `PLAN`. Parse groups · label `independent` or list deps.

**`risk=high`** → spawn `architect-expert`:
```
Identify specific risks in this plan and propose concrete mitigations so it can proceed safely.
<full PLAN>
```
Incorporate into revised `PLAN`. If architect judges fundamentally unsound: log `SKIPPED — architect rejected: <reason>`, jump to Step 8 (skip 5–7), advance iteration.

### Step 5 — Implement (parallel by group)

For each independent group, spawn ONE `exe-task-implementer`. Send all independent groups in ONE message; dependent groups wait their wave.

```
Implement this group for mdownreview.
<issue mode:> Issue: #<ISSUE_NUMBER> — <ISSUE_TITLE>  <or>  Goal: <GOAL_FOR_ASSESSOR>
Iteration: <N>/30
Group: <name + deps>
Files: <list>   Changes: <from PLAN>   Tests: <from PLAN>
Context: <relevant excerpt>
Do NOT touch files outside this group. Do NOT ask questions — if ambiguous, conservative choice + note.
Return Implementation Summary.
```

Wait for each dependency wave. Collect every summary.

Every implementer reports "no changes" → log `SKIPPED — no-op: <reason>` to state file, no commit, advance iteration.

### Step 6 — Push, classify diff, race local + CI + experts

#### 6a. Push
```bash
git add <specific files reported by implementers — NEVER git add -A blindly>
git commit -m "$COMMIT_MESSAGE"
git push
```
Commit messages: see Commit conventions table below.

#### 6b. Classify diff (consumed by 6c, Step 7, Step 9)

```bash
DIFF_FILES=$(git diff --name-only "$ITER_BASE_SHA" HEAD)
if [ -z "$DIFF_FILES" ]; then
  DIFF_CLASS=none
elif echo "$DIFF_FILES" | grep -qvE '^(\.claude/|docs/|[^/]+\.md$)'; then
  DIFF_CLASS=code
elif echo "$DIFF_FILES" | grep -qE '^\.claude/(skills|agents)/'; then
  DIFF_CLASS=prompt-only
else
  DIFF_CLASS=docs-only
fi
echo "[diff-class] $DIFF_CLASS — $(echo "$DIFF_FILES" | wc -l) files"
```

`DIFF_CLASS` rules:
- **`code`** — at least one file outside `.claude/**`, `docs/**`, root `*.md`. Default when in doubt.
- **`prompt-only`** — every changed file is under `.claude/skills/` or `.claude/agents/` (rule contracts, no behavioural code).
- **`docs-only`** — every changed file is under `.claude/**` (non-prompt) or `docs/**` or a root `*.md`.
- **`none`** — empty diff (Step 5 was a no-op; you should not be here).

#### 6c. Local validate ∥ CI poll ∥ Expert diff review (parallel)

ONE message, three agents launched together. The expert panel does NOT wait for local/CI — it runs against the diff that's already on the branch.

**A — `exe-implementation-validator` (diff-scoped):**

| `DIFF_CLASS` | Suite |
|---|---|
| `code` | Full suite: `1) npm run lint  2) npx tsc --noEmit  3) cd src-tauri && cargo test  4) npm test  5) npm run test:e2e  6) npm run test:e2e:native` |
| `prompt-only` | `1) npm run lint:skills` only — every other gate has nothing to lint. |
| `docs-only` | Skip entirely. Return `PASS — docs-only diff, no validators applicable`. |
| `none` | Skip entirely. (Step 5 should have logged SKIPPED already.) |

Prompt:
```
Run the validation suite for DIFF_CLASS=<…>:
<list from table above>
Return PASS|FAIL with full output for every check executed (or "SKIPPED — <reason>" if no checks apply).
```

**B — `general-purpose` (CI poller):**
```
Poll CI for PR <PR_NUMBER> every 30 s, max 30 min.
  gh pr checks <PR_NUMBER>
Stop when no check is "pending"/"in_progress".
Return PASS or FAIL with failed-check names + logs.
```

CI itself is path-filtered (see `.github/workflows/ci.yml`), so on `prompt-only`/`docs-only` diffs every check correctly skips green within ~30 s of dispatch — the poller still runs (cheap), just exits fast.

**C — Expert diff review panel (diff-scoped, see Step 7).** Launched in the SAME parallel message as A and B; details in Step 7.

#### 6d. Forward-fix loop (max 5 attempts) — merges A/B/C failures

Repeat until A, B, AND C are all green/APPROVE, or 5 attempts:

1. Collect every failure: validator failures (A) + CI check failures (B) + every BLOCK from the expert panel (C).
2. ONE `exe-task-implementer`:
   ```
   Fix all of the failures below in one pass. No revert — forward fix.
   Local: <full output>
   CI: <names + logs>
   Expert blocks: <each: expert · file:line · rule · fix direction>
   Prior attempts: <summaries>
   Minimal change per failure. Tighten existing code over new abstractions. Do NOT reopen approved concerns.
   Return Implementation Summary.
   ```
3. ```bash
   git add <specific files>
   git commit -m "fix(iter-<iteration>): <summary>"
   git push
   ```
4. Re-classify diff (6b) — fixes may have flipped `DIFF_CLASS` (e.g. added a code file). Re-run A/B/C against the new tip with the (possibly new) suite. Reuse the SAME expert set unless DIFF_CLASS changed.
5. All three pass → break.
6. After 5 attempts still failing → log `DEGRADED — could not converge validate/CI/experts after 5: <summary>`. Do NOT revert. `degraded_count += 1`. Proceed to Step 8.

### Step 7 — Expert diff review panel (launched in 6c, scoped by `DIFF_CLASS`)

```bash
git diff $ITER_BASE_SHA HEAD --stat
git diff $ITER_BASE_SHA HEAD
```

Spawn the panel in the SAME parallel message as the validators (6c-C). Panel composition is **demand-driven by `DIFF_CLASS` and path triggers** — mirrors Step 3's rule.

**Always included** (every diff): `lean-expert`, `rubber-duck`.

**By `DIFF_CLASS`:**

| `DIFF_CLASS` | Add to panel |
|---|---|
| `code` | `product-expert`, `performance-expert`, `architect-expert`, `react-tauri-expert`, `bug-expert`, `test-expert`, `documentation-expert` (always with code), and **conditionally** `security-expert` when diff touches `src-tauri/src/commands.rs`, `src-tauri/src/core/sidecar.rs`, any `Path`/`canonicalize` use, or any `src/components/viewers/` markdown rendering. |
| `prompt-only` | `documentation-expert` (the prompt itself is documentation), `architect-expert` (skill/agent contracts shape downstream IPC and dispatch). Skip the rest — `react-tauri-expert`/`performance-expert`/`bug-expert`/`security-expert`/`test-expert` have nothing to say about a markdown contract change. |
| `docs-only` | `documentation-expert` only. |
| `none` | Skip Step 7 entirely. |

This implements the diff-scoped tightening called out in retrospective `feature-issue-105-assessor-path-check-iter-1.md`: prompt/docs-only iterations no longer dispatch the full 8-expert panel.

Each prompt:
```
Review this iteration's diff.
<issue mode:> Issue: #<ISSUE_NUMBER> — <ISSUE_TITLE>  <or>  Goal: <GOAL_FOR_ASSESSOR>
Iteration: <N>/30   DIFF_CLASS: <code|prompt-only|docs-only>
Spec/goal context: <excerpt>
Diff stat: <…>   Full diff: <…>

BLOCK on any of these — APPROVE otherwise. Cite specific rule numbers from docs/*.md when blocking.
1. Progress toward the goal / AC it claims?
2. New bugs, regressions, arch problems? (docs/architecture.md)
3. Violates docs/{performance,security,design-patterns,test-strategy}.md?
4. UI-visible change without browser e2e in e2e/browser/? (test-strategy rules 4-5)
5. Dead code · unused imports · replaced patterns not deleted?
6. Debt — TODOs, half-wires, bypassed checks, workarounds?
7. Rust-First with MVVM respected?

Return APPROVE or BLOCK with file:line + "violates rule N in docs/X.md".
```

Findings flow into 6d's single forward-fix wave alongside validator/CI failures. There is no separate "Step 7 forward-fix loop" any more — convergence is owned by 6d.

### Step 8 — Record

Append to state file:
```markdown
## Iteration <N> — <PASSED | DEGRADED | SKIPPED>
- DIFF_CLASS: <code | prompt-only | docs-only | none>
- Commits: <SHAs from ITER_BASE_SHA..HEAD>
- Validate+CI+Experts: <converged in K | degraded after 5>
- Expert review: <A approved / B blocked — list>
- Goal assessor confidence: <%>
- Summary: <one sentence>
<if DEGRADED:>
- Carry-over: <bullets — read by next assessor>
```

Update PR:
- Body: tick the requirement checkboxes the assessor marked `met` in its `REQUIREMENTS:` block — issue mode and goal mode alike. Do not tick a box without an assessor `met` verdict for that exact line. `gh pr edit <PR_NUMBER> --body "<…>"`.
- Comment:
  ```bash
  gh pr comment <PR_NUMBER> --body "$(cat <<'EOF'
  <!-- iterate-iter-<N> -->
  ### <✅ PASSED | ⚠️ DEGRADED | ⏭️ SKIPPED> Iteration <N>/30
  **DIFF_CLASS:** <…>   **Commits:** <short SHAs>   **Files:** <count>   **Tests:** <count>
  <issue: AC satisfied this iter: …  |  goal: requirements done: …>
  <if DEGRADED: Carry-over: …>
  Next: iteration <N+1>
  EOF
  )"
  ```

`iteration += 1`. PASSED → `passed_count += 1`.

### Step 8.5 — Retrospective + concurrent Step 9a dispatch

Follow the unified retrospective contract: [`.claude/shared/retrospective.md`](../../shared/retrospective.md). Skill-specific bindings:

- `SKILL_TAG=iterate-one-issue`
- `RUN_TAG=$(echo "$BRANCH" | tr '/' '-')-iter-$N`
- `RETRO_FILE=".claude/retrospectives/$RUN_TAG.md"`
- `OUTCOME=<PASSED|DEGRADED|SKIPPED>` (per Step 2 + Step 7 result)
- For bug-mode iterations, append a `## BUG_RCA` section (verbatim from Step 3a) after `## Carry-over to the next run`.
- Phase 2 (below) is this skill's binding of **Step R2** — it runs once at terminal Done-X, not per iteration. **Skip the per-iteration R2 call** — only Step 8.5's R1 (write the file) runs inside the loop.

#### 8.5a–b. Generate (parallel with 9a if achieved)

If Step 2 returned `achieved` AND `DIFF_CLASS=code` AND release-gate is applicable (see Step 9), dispatch in **ONE parallel message**:
- **Retro author** (`general-purpose`, R1 prompt below) — writes `$RETRO_FILE`.
- **Step 9a-dispatch** (see Step 9 below) — triggers release-gate workflow on the iterate branch.

Otherwise (still in_progress / non-code diff / Step 9 skipped), run only the retro author. The 9a dispatch path either fires later (next iteration) or is skipped entirely.

Use the R1 prompt from the shared spec, with skill-specific context block:
```
- Mode: <MODE>   Goal: <GOAL_FOR_ASSESSOR>   Issue: #<ISSUE_NUMBER or n/a>
- Bug-mode: <IS_BUG>   Outcome: <PASSED|DEGRADED|SKIPPED>
- DIFF_CLASS: <…>
- Commits ITER_BASE_SHA..HEAD: <SHAs + summaries>
- Files touched: <list>
- Forward-fix attempts: 6d=<K>
- Expert blocks: <expert + rule, or "none">
- Assessor confidence: <prev% → curr%>
- Iteration log entry verbatim: <…>
- BUG_RCA (if applicable): <verbatim>
```

Write output verbatim to `$RETRO_FILE`.

#### 8.5c. Commit + push retro
```bash
git add "$RETRO_FILE"
git commit -m "$(cat <<EOF
chore(iter-$N): retrospective

$(head -n 1 "$RETRO_FILE" | sed 's/^# //')
EOF
)"
git push
```

If Step 9a was dispatched in parallel, the retro commit lands on the iterate tip *after* Step 9a captured `iter_base_sha`. That is intentional — Step 9b polls the workflow run dispatched at the pre-retro tip, which is fine because the retro itself is a `.claude/retrospectives/**` change that release-gate's path filter ignores.

Retrospective is now part of PR diff; merging persists every retro into `main`.

#### 8.5d. Link from progress comment
Append one line to Step 8 comment (or post inline):
```
**Retrospective:** [`$RETRO_FILE`](<repo-blob-url>) — <count> improvement candidate(s)
```

**Termination check after 8.5:** `iteration > 30` → **Done-TimedOut**. Else loop back to Step 1.

### Step 9 — Release-gate validation (Done-Achieved only)

#### Skip rule (no release gate needed)

```
if DIFF_CLASS != code:
  release_gate.state = skipped
  log "[step9] SKIPPED — DIFF_CLASS=<…>; release-gate not applicable to non-buildable diffs"
  jump to Done-Achieved (PR ready immediately, see done-handlers.md)
```

`.claude/**`, `docs/**`, and root `*.md` changes are already path-filtered out of CI. Re-running release-gate's signed-installer build on them produces zero new signal.

#### Two-phase: 9a-dispatch (returns) and 9b–d-resume (called later)

The release-gate poll is ~18 min of pure CI time. Step 9 is therefore split into a fast **dispatch** half that returns immediately with state persisted, and a **resume** half that the caller (`iterate-loop` in pipeline mode, or this same skill in single-issue mode) re-enters once GitHub signals completion.

- **9a-dispatch:** create the workflow_dispatch run on the iterate branch, write `release_gate.state=dispatched` + `workflow_run_id` + `dispatched_at` into the state file, return `Done-Achieved-RG-Pending`.
- **9b–d-resume:** poll the run; on PASS, mark PR ready (9d); on FAIL, forward-fix (9c, max 5) and re-dispatch.

Single-issue mode (no pipelining) still works: the skill calls 9b–d-resume itself, immediately and synchronously, just like today. Pipeline-mode loop calls 9b–d-resume from a yield point in the next round.

Full flow lives in [references/release-gate.md](references/release-gate.md).

---

## Phase 2 — Improvement-spec synthesis (every terminal path)

Runs first on every Done-X — before banner, before exit. Highest signal value comes from Done-Blocked / Done-TimedOut. Full 2a–2e flow (gate, synthesise, decision, create issue+spec, optional auto-recursion) lives in [references/phase-2.md](references/phase-2.md).

## Termination

| Trigger | Path |
|---|---|
| Step 1 abort (rebase) | **Done-Blocked** (skip 2–9) |
| Step 2 `achieved` AND `DIFF_CLASS != code` | **Done-Achieved** (Step 9 skipped) |
| Step 2 `achieved` AND `DIFF_CLASS == code`, single-issue mode | **Done-Achieved** (run 9b–d-resume synchronously after 9a-dispatch) |
| Step 2 `achieved` AND `DIFF_CLASS == code`, pipeline mode (loop signalled it) | **Done-Achieved-RG-Pending** (return after 9a-dispatch; loop calls 9b–d-resume later) |
| Step 2 `blocked` | **Done-Blocked** (skip 3–9) |
| End of Step 8.5 + `iteration+1 > 30` | **Done-TimedOut** |

**Phase 2 runs first on every terminal path.** `DEGRADED`/`SKIPPED` do NOT terminate.

`Done-Achieved-RG-Pending` is terminal **for this skill** (this invocation exits cleanly) but non-terminal **for the loop** (loop will dispatch 9b–d-resume later and may then transition to `Done-Achieved` or `Done-Blocked`). See [references/done-handlers.md](references/done-handlers.md).

### Done-Achieved · Done-Achieved-RG-Pending · Done-Blocked · Done-TimedOut

Each terminal path: post the appropriate PR/issue comment, set the appropriate label (`blocked` for Done-Blocked / Done-TimedOut), print the banner, then **exit cleanly with the outcome on stdout**. The companion `iterate-loop` (if any) parses the outcome to decide whether to chain into the next issue. Full handler scripts in [references/done-handlers.md](references/done-handlers.md).

**Outcome marker (last line printed before exit, machine-parseable for `iterate-loop`):**
```
ITERATE_OUTCOME: <Done-Achieved|Done-Achieved-RG-Pending|Done-Blocked|Done-TimedOut> issue=<N|n/a> branch=<BRANCH> pr=<URL> [worktree=<path>] [rg_run=<ID>]
```

`worktree=` and `rg_run=` are only set on `Done-Achieved-RG-Pending`. `worktree=` is the absolute path the loop must `cd` into to call 9b–d-resume; `rg_run=` is the GitHub Actions run ID the resume call polls.

---

## Halt semantics

See [references/halt-semantics.md](references/halt-semantics.md) for the full enumeration of halt / DEGRADED / SKIPPED / pre-loop-halt triggers.

## Commit conventions

See [references/commit-conventions.md](references/commit-conventions.md) for the per-situation commit-message templates.

## Failure recovery

See [references/failure-recovery.md](references/failure-recovery.md) for the mid-loop interruption checklist (state file, rebase repair, rerere, retro inspection, recursion-marker hygiene, restart policy).
