---
name: iterate
description: Autonomous single-branch/single-PR iteration loop. Args - empty (auto-pick oldest open issue, prefer `groomed`), `42`/`#42`/`issue-42`/issue URL (issue mode), or free text (goal mode). Bug-labelled issues run root-cause + test-gap analysis. Commits a retrospective per iteration; on Done-Achieved synthesises retrospectives into a follow-up issue. Charter rules in AGENTS.md govern every iteration.
---

**RIGID. Follow every step exactly.** User interaction is allowed ONLY in Step 0e. After 0f, fully autonomous through 30 iterations, CI forward-fixes, expert review, and release-gate validation. Pre-consult experts and the diff-review panel cite specific rule numbers; rule-violating diffs block at review even if green.

---

## Phase 0 — Setup

### 0a. Parse arg → mode

Let `ARG` = trimmed string after skill name. First match wins:

| Pattern | Result |
|---|---|
| empty | `MODE=issue`, auto-pick (0c) |
| `^\d+$` | `MODE=issue`, `ISSUE_NUMBER=ARG` |
| `^#(\d+)$` | `MODE=issue`, group 1 |
| `^[Ii]ssue-(\d+)$` | `MODE=issue`, group 1 |
| `^https?://github\.com/[^/]+/[^/]+/issues/(\d+)([/#?].*)?$` | `MODE=issue`, group 1 |
| else | `MODE=goal`, `GOAL_TEXT=ARG` (strip surrounding quotes) |

### 0b. Pre-flight (parallel)

```bash
git status --porcelain
git branch --show-current
git rev-parse HEAD
```

- Dirty tree → STOP `[iterate] Working tree is dirty. Commit or stash first.`
- Not on `main` → `git checkout main && git pull --ff-only`.

**Recursion-marker hygiene** (Phase 2e cleanup contract):
```bash
DEPTH_FILE=".claude/iterate-recursion-depth"
if [ -f "$DEPTH_FILE" ]; then
  AGE=$(( $(date +%s) - $(stat -c %Y "$DEPTH_FILE" 2>/dev/null || stat -f %m "$DEPTH_FILE") ))
  [ "$AGE" -gt 86400 ] && rm -f "$DEPTH_FILE"
fi
```

### 0c. Auto-pick (only when 0a empty)

```bash
PICK=$(gh issue list --label "groomed" --state open --json number --limit 100 \
  | jq 'sort_by(.number) | .[0].number // empty')
if [ -z "$PICK" ]; then
  PICK=$(gh issue list --state open --json number,labels --limit 200 \
    | jq '[.[] | select(.labels | map(.name) | index("iterate-in-progress") | not)] | sort_by(.number) | .[0].number // empty')
fi
```

Empty → STOP `[iterate] No open issues found.` Otherwise `ISSUE_NUMBER=$PICK`.

### 0d. Load spec (issue mode)

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

Set `ACCEPTANCE_CRITERIA` from the resolved spec (parsed `- [ ]` / `- [x]` lines).

**Bug-mode flag.** `IS_BUG = true` if any:
- `LABELS` ∋ `bug` | `regression` | `defect`.
- Title (case-insensitive) starts with `bug:` | `fix:` | `regression:`, or contains `[bug]` | `[regression]`.
- Body has `## Steps to reproduce` / `## Reproduction` / `## Expected` + `## Actual`.

### 0e. Clarification questions (last user touch-point)

Bias is to **skip**. Bundle ≤3 blocking questions into ONE `ask_user` call only when the goal is genuinely ambiguous (scope boundaries, observable success signal, internal contradictions). **Never** ask about: implementation detail, anything answered by deep-dive docs, anything the assessor can discover, style/naming/framework.

Fold answers into the goal:
- Goal mode: append `  (clarifications: <summary>)` to `GOAL_FOR_ASSESSOR`.
- Issue mode: append `### Operator clarifications (captured <ISO date>)` section with verbatim Q&A to `SPEC_MARKDOWN`.

After 0f, no further user interaction.

### 0f. Compute branch / PR title / goal

| Var | Issue mode | Goal mode |
|---|---|---|
| `BRANCH` | `feature/issue-$ISSUE_NUMBER-<3–5-word slug>` | `auto-improve/<slug, 40-cap>-$(date +%Y%m%d)` |
| `PR_TITLE` | `feat: implement #$ISSUE_NUMBER — $ISSUE_TITLE` | `auto-improve: $GOAL_TEXT` |
| `GOAL_FOR_ASSESSOR` | `Satisfy all acceptance criteria of #$ISSUE_NUMBER: $ISSUE_TITLE` | `$GOAL_TEXT` |
| `PR_CLOSE_TRAILER` | `Closes #$ISSUE_NUMBER` | (omit) |

Slug: lowercase, non-alphanum → `-`, collapse runs, trim.

### 0g. Branch + draft PR

```bash
git checkout main && git pull --ff-only
git checkout -b "$BRANCH"
```

Pre-existing branch (local OR remote) → STOP `[iterate] Branch $BRANCH already exists. Delete or pick a different invocation — resume not supported.` Do **not** delete.

```bash
git commit --allow-empty -m "chore(iterate): start — $GOAL_FOR_ASSESSOR"
git push -u origin HEAD
git config rerere.enabled true
git config rerere.autoupdate true
```

`PR_BODY`:
- Issue mode: links to issue · pastes full `ACCEPTANCE_CRITERIA` checklist (unchecked) · trailer `Closes #$ISSUE_NUMBER`.
- Goal mode: header quotes goal · empty progress list.

```bash
gh pr create --draft --title "$PR_TITLE" --body "$PR_BODY"
```

Capture `PR_NUMBER`, `PR_URL`.

### 0h. State file — `.claude/iterate-state.md`

```markdown
---
mode: <issue | goal>
goal: "<GOAL_FOR_ASSESSOR>"
issue_number: <ISSUE_NUMBER or null>
started_at: <ISO datetime>
branch: <BRANCH>
pr: <PR_URL>
pr_number: <PR_NUMBER>
iteration_cap: 30
---
# Iteration Log
```

### 0i. Banner

```
[iterate] Mode: <MODE> | Goal: <GOAL_FOR_ASSESSOR>
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

Spawn `exe-goal-assessor` (one call). Inputs: goal, iteration counters, full state-file content. Issue mode also pass: title, body, `SPEC_MARKDOWN`, open AC bullets. Instruction: read code from scratch, ignore prior specs, return STATUS / CONFIDENCE / NEXT_REQUIREMENTS / EVIDENCE / BLOCKING_REASON. Issue mode: per-AC verdict with file:line evidence; empty `NEXT_REQUIREMENTS` + open AC ⇒ `blocked` pointing at unreachable AC.

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
NEXT_REQUIREMENTS: <…>   EVIDENCE: <…>
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

### Step 6 — Push + race validate

#### 6a. Push
```bash
git add <specific files reported by implementers — NEVER git add -A blindly>
git commit -m "$COMMIT_MESSAGE"
git push
```
Commit messages: see Commit conventions table below.

#### 6b. Local validation + CI poll (parallel)

ONE message, both agents:

**A — `exe-implementation-validator`:**
```
Run the full local suite in order:
1. npm run lint
2. npx tsc --noEmit
3. cd src-tauri && cargo test
4. npm test
5. npm run test:e2e
6. npm run test:e2e:native
Return PASS|FAIL with full output for every check.
```

**B — `general-purpose` (CI poller):**
```
Poll CI for PR <PR_NUMBER> every 30 s, max 30 min.
  gh pr checks <PR_NUMBER>
Stop when no check is "pending"/"in_progress".
Return PASS or FAIL with failed-check names + logs.
```

#### 6c. Forward-fix loop (max 5 attempts)

Repeat until both PASS or 5 attempts:

1. `exe-task-implementer`:
   ```
   Fix the failures. No revert — forward fix.
   Local: <full output>   CI: <names + logs>   Prior attempts: <summaries>
   Minimal change per failure. Tighten existing code over new abstractions.
   Return Implementation Summary.
   ```
2. ```bash
   git add <specific files>
   git commit -m "fix(iter-<iteration>): <summary>"
   git push
   ```
3. Re-run 6b.
4. Both PASS → break.
5. After 5 attempts still failing → log `DEGRADED — could not fix validate/CI after 5: <summary>`. Do NOT revert. `degraded_count += 1`. Proceed to Step 7.

### Step 7 — Expert diff review

```bash
git diff $ITER_BASE_SHA HEAD --stat
git diff $ITER_BASE_SHA HEAD
```

Spawn the **8-expert panel** in ONE parallel message: `product-expert`, `performance-expert`, `architect-expert`, `react-tauri-expert`, `bug-expert`, `test-expert`, `documentation-expert`, `lean-expert`.

**Conditional** (same parallel message): include `security-expert` when diff touches `src-tauri/src/commands.rs`, `src-tauri/src/core/sidecar.rs`, any `Path`/`canonicalize` use, or any `src/components/viewers/` markdown rendering.

Each prompt:
```
Review this iteration's diff.
<issue mode:> Issue: #<ISSUE_NUMBER> — <ISSUE_TITLE>  <or>  Goal: <GOAL_FOR_ASSESSOR>
Iteration: <N>/30
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

**Any BLOCK** → `exe-task-implementer` with union of blocks:
```
Forward-fix the blocking issues. No revert.
<each: expert · file:line · rule · fix direction>
Minimal change per blocker. Do NOT reopen approved concerns.
Return Implementation Summary.
```

Commit + push (`fix(iter-<iteration>): <summary>`). Re-run 6b. Re-run the SAME panel on the new diff (`git diff $ITER_BASE_SHA HEAD`).

Still BLOCK after one fix round → log `DEGRADED — expert review: <summaries>`. `degraded_count += 1`. Do NOT revert. Proceed to Step 8.

### Step 8 — Record

Append to state file:
```markdown
## Iteration <N> — <PASSED | DEGRADED | SKIPPED>
- Commits: <SHAs from ITER_BASE_SHA..HEAD>
- Validate+CI: <passed | fixed in K | degraded after 5>
- Expert review: <A approved / B blocked — list>
- Goal assessor confidence: <%>
- Summary: <one sentence>
<if DEGRADED:>
- Carry-over: <bullets — read by next assessor>
```

Update PR:
- Body: tick AC checkboxes confirmed by assessor or implementers (issue mode); append completed requirement groups (goal mode). `gh pr edit <PR_NUMBER> --body "<…>"`.
- Comment:
  ```bash
  gh pr comment <PR_NUMBER> --body "$(cat <<'EOF'
  <!-- iterate-iter-<N> -->
  ### <✅ PASSED | ⚠️ DEGRADED | ⏭️ SKIPPED> Iteration <N>/30
  **Commits:** <short SHAs>   **Files:** <count>   **Tests:** <count>
  <issue: AC satisfied this iter: …  |  goal: requirements done: …>
  <if DEGRADED: Carry-over: …>
  Next: iteration <N+1>
  EOF
  )"
  ```

`iteration += 1`. PASSED → `passed_count += 1`.

### Step 8.5 — Retrospective (committed every iteration)

Phase 2 reads these. Vague retros are useless — every point cites file:line, agent name, commit SHA, rule, or quoted error.

#### 8.5a. Paths
```bash
SAFE_BRANCH=$(echo "$BRANCH" | tr '/' '-')
RETRO_DIR=".claude/retrospectives"
RETRO_FILE="$RETRO_DIR/$SAFE_BRANCH-iter-$N.md"
mkdir -p "$RETRO_DIR"
```

#### 8.5b. Generate

`general-purpose`:
```
Retrospective for iteration <N>/30 on mdownreview.

Context (load-bearing — committed to PR, synthesised by Phase 2):
- Mode: <MODE>   Goal: <GOAL_FOR_ASSESSOR>   Issue: #<ISSUE_NUMBER or n/a>
- Bug-mode: <IS_BUG>   Outcome: <PASSED|DEGRADED|SKIPPED>
- Commits ITER_BASE_SHA..HEAD: <SHAs + summaries>
- Files touched: <list>
- Forward-fix attempts: Step 6 = <K>, Step 7 = <0|1>
- Expert blocks: <expert + rule, or "none">
- Assessor confidence: <prev% → curr%>
- Iteration log entry verbatim: <…>
- BUG_RCA (if applicable): <verbatim>

Output ONE markdown file with this exact structure. Concrete only — no platitudes. Every point cites file:line / agent / SHA / rule / quoted error.

# Retrospective — iteration <N>/30 (<PASSED|DEGRADED|SKIPPED>)

## Goal of this iteration
<one sentence — verbatim NEXT_REQUIREMENTS or AC>

## What went well
- <concrete bullet>

## What did not go well
- <concrete: which agent, which rule, which file, which assertion>

## Root causes of friction
For each problem above, the underlying cause. Cite docs/X.md rules where one could be tightened.

## Improvement candidates (each must be specifiable)
For each candidate use this template — Phase 2 must lift directly into a `<!-- mdownreview-spec -->` body without re-investigation:

### <short imperative title>
- **Category:** process | tooling | test-strategy | architecture | docs | skill | agent
- **Problem (with evidence):** <2–3 sentences citing file:line, agent, log, SHA>
- **Proposed change:** <concrete diff sketch — paths, what to add/remove, what to assert>
- **Acceptance signal:** <measurable, observable>
- **Estimated size:** xs|s|m|l
- **Confidence this matters:** low|medium|high (one-line justification)

If no candidate, write literally: `_None — iteration was clean and adds no signal for Phase 2._`

## Carry-over to next iteration
<bullets; empty if none>
```

Write output verbatim to `$RETRO_FILE`.

#### 8.5c. Commit + push
```bash
git add "$RETRO_FILE"
git commit -m "$(cat <<EOF
chore(iter-$N): retrospective

$(head -n 1 "$RETRO_FILE" | sed 's/^# //')
EOF
)"
git push
```

Retrospective is now part of PR diff; merging persists every retro into `main`.

#### 8.5d. Link from progress comment
Append one line to Step 8 comment (or post inline):
```
**Retrospective:** [`$RETRO_FILE`](<repo-blob-url>) — <count> improvement candidate(s)
```

**Termination check after 8.5:** `iteration > 30` → **Done-TimedOut**. Else loop back to Step 1.

### Step 9 — Release-gate validation (Done-Achieved only)

Runs the Windows + macOS Release Gate (real installers, signed builds) against accumulated work. Release Gate triggers on `release/*` branches; this step creates a mirror branch+PR at the iterate tip, validates there, forward-fixes on the **iterate branch** so humans review one PR.

#### 9a. Mirror branch + PR
```bash
RELEASE_BRANCH="release/iterate-$(echo "$BRANCH" | sed 's|^[^/]*/||' | cut -c1-40)-$(date +%Y%m%d%H%M)"
git checkout -b "$RELEASE_BRANCH"
git push -u origin HEAD
git checkout "$BRANCH"

RELEASE_PR_URL=$(gh pr create --draft --base main --head "$RELEASE_BRANCH" \
  --title "validate-release: $PR_TITLE" \
  --body "Release-gate validation for #<PR_NUMBER>. Close with --delete-branch after validation.")
RELEASE_PR_NUMBER=<parse>
```

Pre-existing `$RELEASE_BRANCH` → halt **Done-Blocked** reason `release-gate branch <…> already exists — delete and re-run step 9 manually`. Do NOT overwrite.

```bash
gh pr comment <PR_NUMBER> --body "<!-- iterate-release-gate-start -->
⏳ Release-gate validation started on $RELEASE_PR_URL"
```

#### 9b. Poll
`general-purpose`:
```
Poll CI + Release Gate on PR <RELEASE_PR_NUMBER> every 60 s, max 60 min.
  gh pr checks <RELEASE_PR_NUMBER>
Stop when no check is pending/in_progress. Return PASS or FAIL + logs.
```

#### 9c. Forward-fix loop (max 5)

On FAIL:
1. `exe-task-implementer`:
   ```
   Fix Release Gate failures. No revert — forward fix.
   Failed: <names>   Logs: <truncated>   Prior: <summaries>
   Edit on iterate branch (current tree). Do NOT edit the release-mirror branch.
   Return Implementation Summary.
   ```
2. Commit + push on iterate branch:
   ```bash
   git add <files>
   git commit -m "fix(iter-release): <summary>"
   git push
   ```
3. Fast-forward mirror to iterate tip:
   ```bash
   git checkout "$RELEASE_BRANCH"
   git merge --ff-only "$BRANCH"
   git push
   git checkout "$BRANCH"
   ```
4. Re-run 9b.
5. PASS → 9d. After 5 attempts still FAIL → halt **Done-Blocked** reason `release-gate failure after 5 forward-fix attempts`. Mirror PR stays draft; iterate PR stays draft.

#### 9d. Close mirror, mark iterate ready

Execute ALL in order:
1. `gh pr close "$RELEASE_PR_NUMBER" --delete-branch`
2. Refresh iterate PR body — tick all progress, summary "Ready for review — goal achieved, release gate passed". Issue mode: keep `Closes #<ISSUE_NUMBER>` trailer. `gh pr edit <PR_NUMBER> --body "<final>"`.
3. `gh pr ready <PR_NUMBER>` (only place this skill flips iterate PR out of draft).
4. State file:
   ```markdown
   ## Release-gate validation — PASSED
   - Mirror PR: <URL> (closed --delete-branch)
   - Fix attempts: <N>
   - Commit validated: <iterate HEAD SHA>
   - Iterate PR: <URL> (ready for review)
   ```
5. Comment on iterate PR:
   ```bash
   gh pr comment <PR_NUMBER> --body "<!-- iterate-release-gate-done -->
   🟢 Release gate validated on commit <sha>. Mirror PR closed. PR ready for review."
   ```

Proceed to **Done-Achieved** banner.

---

## Phase 2 — Improvement-spec synthesis (every terminal path)

Runs first on every Done-X — before banner, before exit. Highest signal value comes from Done-Blocked / Done-TimedOut.

### 2a. Gate
```bash
SAFE_BRANCH=$(echo "$BRANCH" | tr '/' '-')
RETRO_FILES=$(ls -1 ".claude/retrospectives/$SAFE_BRANCH-iter-"*.md 2>/dev/null || true)
RETRO_COUNT=$(echo "$RETRO_FILES" | grep -c . || true)
```

Skip Phase 2 (go to terminal banner) if:
- `RETRO_COUNT == 0`, OR
- Every retro contains literally `_None — iteration was clean and adds no signal for Phase 2._` and nothing else under "Improvement candidates".

When skipped: state file `## Phase 2 — SKIPPED (no actionable retrospective signal)`.

### 2b. Synthesise

`general-purpose` (single call). Pass every retro file content verbatim + terminal status.

```
Synthesise iterate-loop retros into ONE follow-up improvement spec.
Loop terminated as: <Done-Achieved|Done-Blocked|Done-TimedOut>
Branch: <BRANCH>   Iterate PR: <URL>   Issue: #<ISSUE_NUMBER>
Total retros: <RETRO_COUNT>

Retros (verbatim, in order, '---' separated):
<concatenated $SAFE_BRANCH-iter-N.md>

Pick the SINGLE highest-leverage candidate meeting ALL:
1. Recurs across ≥2 retros, OR appears once with high-confidence + l/m size, OR is a `bug`/`agent`/`skill` candidate the loop itself hit.
2. Source retros have enough specificity (file:line, agent, rule, log) to draft a concrete spec.
3. In scope: iterate skill, .claude/agents/, docs/*.md, src/, src-tauri/, e2e/, .github/workflows/.
4. Not duplicating an open issue. Verify: `gh issue list --state open --search "<keywords>" --limit 20`.

If NO candidate clears all four, output exactly:
NO_IMPROVEMENT_FOUND
<one-paragraph justification>

Otherwise output exactly this template — no preamble, no extra commentary:

ISSUE_TITLE: <imperative, ≤70 chars>
ISSUE_LABELS: <comma-separated; from {groomed, iterate-improvement} + exactly one of {process, tooling, test-strategy, architecture, docs, skill, agent, bug}>
ISSUE_BODY:
<problem statement, 1-2 paragraphs, citing retro file paths>

## Why this matters
<1 paragraph linking to docs/principles.md pillar(s)>

## Evidence from retrospectives
<bullets, each quoting retro verbatim + file>

SPEC_BODY:
<body of `<!-- mdownreview-spec -->` comment — self-contained for fresh /iterate run>

# <ISSUE_TITLE>

## Goal
<one sentence, observable>

## Acceptance criteria
- [ ] <specific, measurable, file/path-cited>
- [ ] …
- [ ] Regression test (if behaviour change): <file path, layer, assertion>

## Files likely to change
<bullets>

## Out of scope
<bullets>

## Notes
<constraints — e.g. "must not regress test-strategy.md rule 5">
```

Capture `IMPROVEMENT_SYNTHESIS`.

### 2c. Decision

Begins with `NO_IMPROVEMENT_FOUND`:
```markdown
## Phase 2 — NO_IMPROVEMENT_FOUND
- Justification: <verbatim>
- Retrospectives reviewed: <paths>
```
Append, skip 2d/2e, banner.

Else parse `ISSUE_TITLE`, `ISSUE_LABELS`, `ISSUE_BODY`, `SPEC_BODY`.

### 2d. Create issue + spec

```bash
NEW_ISSUE_URL=$(gh issue create \
  --title "$ISSUE_TITLE" \
  --label "$ISSUE_LABELS" \
  --body "$(printf '%s\n\nSurfaced by /iterate retrospectives on PR <PR_URL>.\n\n%s' "$ISSUE_BODY" "<links to each retro file in PR>")")
NEW_ISSUE_NUMBER=<parsed>

gh issue comment "$NEW_ISSUE_NUMBER" --body "$(cat <<EOF
<!-- mdownreview-spec -->
$SPEC_BODY
EOF
)"

gh pr comment <PR_NUMBER> --body "<!-- iterate-followup -->
🔁 Phase 2 surfaced a follow-up improvement: $NEW_ISSUE_URL"
```

State file:
```markdown
## Phase 2 — IMPROVEMENT_FOUND
- New issue: <URL>
- Title: <…>   Labels: <…>
- Recursion: <will-recurse | skipped — see 2e>
```

### 2e. Optional auto-recursion (gated)

Auto-recurse ONLY when ALL hold:
- Loop ended **Done-Achieved**.
- `.claude/iterate-recursion-depth` missing OR contains `0`.
- New issue has `iterate-improvement` label (template enforces).

Off → banner line:
```
   Follow-up: <NEW_ISSUE_URL> — run `/iterate <NEW_ISSUE_NUMBER>` to deliver it.
```

On:
```bash
echo 1 > .claude/iterate-recursion-depth
```
Print:
```
   Follow-up: <NEW_ISSUE_URL>
   Auto-recursing into a fresh /iterate (recursion depth 1/1).
```
Invoke `iterate` skill with arg `<NEW_ISSUE_NUMBER>`. Recursive call sees depth=1 and refuses to recurse again at its own 2e. Outer skill exits after recursive call returns/errors.

**Cleanup contract (implemented in 0b):** delete depth marker if older than 24 h OR points at a missing branch.

---

## Termination

| Trigger | Path |
|---|---|
| Step 1 abort (rebase) | **Done-Blocked** (skip 2–9) |
| Step 2 `achieved` | **Done-Achieved** (run Step 9 first) |
| Step 2 `blocked` | **Done-Blocked** (skip 3–9) |
| End of Step 8.5 + `iteration+1 > 30` | **Done-TimedOut** |

**Phase 2 runs first on every terminal path.** `DEGRADED`/`SKIPPED` do NOT terminate.

### Done-Achieved

Step 9 ran first; if it halted you are in Done-Blocked instead. Step 9d already closed mirror, refreshed PR body, marked PR ready. Run **Phase 2** (only path where 2e may auto-recurse).

```
✅ <MODE> — <ref>
   PR: <URL> (ready for review, release gate passed)
   Branch: <BRANCH>
   Iterations: <passed_count> passed · <degraded_count> degraded
   Release-gate fix attempts: <K>
   Final assessor confidence: <%>
   Phase 2: <skipped | NO_IMPROVEMENT_FOUND | improvement issue $NEW_ISSUE_URL [auto-recursing]>
```
Exit.

### Done-Blocked

Run **Phase 2** first (synthesis only — 2e gated off; not Done-Achieved).

PR stays draft. Comment:
```bash
gh pr comment <PR_NUMBER> --body "$(cat <<'EOF'
<!-- iterate-blocked -->
## ⚠️ Autonomous iteration halted at iteration <N>/30
**Reason:** <BLOCKING_REASON | rebase-conflict summary | release-gate reason>
**Last assessor evidence:** <…>
<if rebase-conflict:> **Conflicted files:** <list>
Iterations 1..<N-1> are pushed. Restart with `/iterate <same args>` after deletion, or continue manually.
EOF
)"
```
Issue mode: post the same on the issue (`<!-- iterate-blocked-issue -->`).

```
❌ <MODE> — <ref>
   Halted at iteration <N>/30   Reason: <short>
   PR (draft): <URL>   Branch: <BRANCH>
   Phase 2: <skipped | NO_IMPROVEMENT_FOUND | follow-up issue $NEW_ISSUE_URL>
```
Exit.

### Done-TimedOut

Run **Phase 2** first (2e gated off). 30 iterations is the strongest possible signal that something structural needs to change.

PR stays draft. Comment:
```bash
gh pr comment <PR_NUMBER> --body "$(cat <<'EOF'
<!-- iterate-timeout -->
## ⏱ Iteration cap reached (30)
**Progress:** <passed_count> passed · <degraded_count> degraded
**Final assessor confidence:** <%>
**Last NEXT_REQUIREMENTS (still open):**
<bullets>
Review the branch — merge what is ready, continue manually, or restart with `/iterate <args>` after adjusting scope.
EOF
)"
```
Issue mode: post the same on the issue.

```
⏱  <MODE> — <ref>
   Cap reached after 30 iterations
   PR (draft, partial): <URL>   Branch: <BRANCH>
   Phase 2: <skipped | NO_IMPROVEMENT_FOUND | follow-up issue $NEW_ISSUE_URL>
```
Exit.

---

## Halt semantics

**Halt (loop ends, Phase 2 runs):**
- Step 2 `blocked`
- Step 1 abort after auto-resolution
- Cap = 30
- Step 9 fail after 5 forward-fix
- Step 9 finds pre-existing release-mirror branch

**`DEGRADED` (continue):**
- Validate/CI fails after 5 forward-fix (Step 6)
- Expert review still blocks after one fix round (Step 7)
- `IS_BUG` and bug-expert RCA inconclusive (Step 3a)

**`SKIPPED` (continue):**
- `risk=high` plan rejected by `architect-expert` (Step 4)
- Every implementer reports no-op (Step 5)

**Pre-loop halt:**
- Dirty tree at setup
- Pre-existing target branch
- Issue mode auto-pick finds no open issues at all

**No longer halts:**
- Issue has no `<!-- mdownreview-spec -->` comment (0d derives)
- Auto-pick finds no `groomed` (0c falls back to oldest open)

---

## Commit conventions

| Situation | Mode | Message |
|---|---|---|
| Iteration impl | Issue | `feat(#<N>): iter <iteration> — <summary>\n\n<body>\n\nRefs #<N>\n\nCo-authored-by: Claude Opus 4.7 <noreply@anthropic.com>` |
| Iteration impl | Goal | `auto-improve: iter <iteration> — <summary>\n\n<body>\n\nCo-authored-by: Claude Opus 4.7 <noreply@anthropic.com>` |
| Forward-fix in iteration | Either | `fix(iter-<iteration>): <summary>` |
| Rebase repair | Either | `fix(rebase): <summary>` |
| Release-gate forward-fix | Either | `fix(iter-release): <summary>` |
| Retrospective (8.5c) | Either | `chore(iter-<iteration>): retrospective\n\n<retro title>` |

No "final" iteration commit — `achieved` skips Steps 3–8. Step 8.5 is the LAST commit of every iteration that ran 3–8 (DEGRADED/SKIPPED also write retros). Phase 2 does NOT push to the iterate branch — its artefact is the new GitHub issue (and optional recursion). Issue closure on merge is driven by the `Closes #<N>` trailer in the PR body (set in 0g), not commit messages.

---

## Failure recovery

If interrupted mid-loop:

1. Read `.claude/iterate-state.md` for branch / PR / last iteration.
2. `git checkout <BRANCH>`.
3. If `.git/rebase-merge` or `.git/rebase-apply` exists, complete or abort before restart.
4. ```bash
   git config rerere.enabled true
   git config rerere.autoupdate true
   ```
5. Inspect retros at `.claude/retrospectives/<safe-branch>-iter-*.md` — pushed retros are visible in PR; uncommitted ones can be reviewed locally.
6. If `.claude/iterate-recursion-depth` exists from a crash, delete it (or wait 24 h for 0b to expire).
7. **Restart is not supported** — Phase 0 halts on existing branch. To resume the work, delete the in-flight branch and re-invoke `/iterate <same args>` — Step 1's rebase + Step 2's assessor will fold in already-pushed work. Retros committed on the prior branch persist via the rebase and still drive Phase 2 of the next run.
