---
name: iterate
description: Fully autonomous single-branch/single-PR iteration loop. Args - empty (continuous mode - drain the backlog and then monitor for new issues), `42`/`#42`/`issue-42`/issue URL (single-issue mode), `--once` (drain backlog once and exit), or free text (goal mode). Auto-skips issues labelled `needs-grooming`, `blocked`, or `iterate-in-progress`. Ambiguous issues get a clarification comment + `needs-grooming` label rather than a user prompt. Done-Blocked outcomes label the issue `blocked`. Bug-labelled issues run root-cause + test-gap analysis. Charter rules in AGENTS.md govern every iteration.
---

**RIGID. Follow every step exactly.** This skill is **fully autonomous — it never calls `ask_user`.** Assume the user is unavailable. Where a human checkpoint used to exist (clarification, sign-off), the skill now writes the question or status to GitHub (issue comment + label) and either skips the issue or halts gracefully. Pre-consult experts and the diff-review panel cite specific rule numbers; rule-violating diffs block at review even if green.

---

## Phase 0 — Setup

### 0a. Parse arg → mode

Let `ARG` = trimmed string after skill name. First match wins:

| Pattern | Result |
|---|---|
| empty | `MODE=continuous`, drain backlog then monitor (0c) |
| `--once` | `MODE=drain-once`, drain backlog and exit (0c, no monitor) |
| `^\d+$` | `MODE=issue`, `ISSUE_NUMBER=ARG` |
| `^#(\d+)$` | `MODE=issue`, group 1 |
| `^[Ii]ssue-(\d+)$` | `MODE=issue`, group 1 |
| `^https?://github\.com/[^/]+/[^/]+/issues/(\d+)([/#?].*)?$` | `MODE=issue`, group 1 |
| else | `MODE=goal`, `GOAL_TEXT=ARG` (strip surrounding quotes) |

`MODE=continuous` and `MODE=drain-once` both run the auto-pick loop in 0c. The only difference is what happens when the backlog is empty (see 0c).

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

### 0c. Auto-pick (only when MODE is `continuous` or `drain-once`)

**Skip filter** — never pick issues with these labels:
- `needs-grooming` (open clarification questions outstanding)
- `blocked` (previous Done-Blocked outcome — needs human attention)
- `iterate-in-progress` (another iterate run owns it)

**Selection (one query):**

```bash
PICK=$(gh issue list --state open --json number,labels --limit 200 \
  | jq '
      [ .[]
        | select(.labels | map(.name) as $L
          | (index("needs-grooming") | not)
          and (index("blocked")        | not)
          and (index("iterate-in-progress") | not))
      ]
      | (map(select(.labels | map(.name) | index("groomed"))) + map(select(.labels | map(.name) | index("groomed") | not)))
      | sort_by(.number)
      | .[0].number // empty')
```

This prefers `groomed` issues; within each tier, oldest-first.

**If `PICK` is non-empty:** record `OUTER_MODE=$MODE` (so Done-X handlers can chain), then set `MODE=issue`, `ISSUE_NUMBER=$PICK`, and immediately label the issue to claim it:

```bash
gh issue edit $ISSUE_NUMBER --add-label "iterate-in-progress"
```

The label is removed in Phase 2 / Done-Blocked / Done-TimedOut (whichever exit path runs).

**If `PICK` is empty (backlog drained):**

| Mode | Behavior |
|---|---|
| `drain-once` | STOP `[iterate] Backlog drained. No eligible open issues.` Exit. |
| `continuous` | **Monitor mode.** Poll the backlog every 5 minutes (sleep 300, max 288 polls = 24 h, then STOP `[iterate] Monitor budget exhausted (24 h with no eligible issues).`). On each poll re-run the selection query. As soon as `PICK` becomes non-empty, claim it and proceed to 0d. While waiting, log a single line `[iterate] monitoring backlog — last check <ISO>, eligible=0` at most once per hour to avoid spam. |

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

Set `ACCEPTANCE_CRITERIA` from the resolved spec (parsed `- [ ]` / `- [x]` lines). This becomes the assessor's `REQUIREMENTS` (see 0f) — the **only** definition of done for issue mode.

**Bug-mode flag.** `IS_BUG = true` if any:
- `LABELS` ∋ `bug` | `regression` | `defect`.
- Title (case-insensitive) starts with `bug:` | `fix:` | `regression:`, or contains `[bug]` | `[regression]`.
- Body has `## Steps to reproduce` / `## Reproduction` / `## Expected` + `## Actual`.

### 0e. Clarification questions (no user prompt — defer to grooming)

This skill **never calls `ask_user`**. If after reading the issue body, comments, deep-dive docs, and the assessor's view of `REQUIREMENTS` the goal is still genuinely ambiguous (scope boundaries, observable success signal, internal contradictions), do **not** guess and do **not** stop the autonomous run silently. Instead:

1. **Goal mode** — there is no issue to update. Proceed with the most defensible interpretation of `GOAL_TEXT`, capture the ambiguity as a `### Operator clarifications (deferred)` block in the PR description, and continue.

2. **Issue mode** — defer to grooming:
   ```bash
   gh issue comment $ISSUE_NUMBER --body "$(cat <<'EOF'
   <!-- iterate-needs-grooming -->
   ## /iterate halted — clarification needed before autonomous work can proceed

   The autonomous iteration loop attempted to pick up this issue but found the goal under-specified for the assessor (scope, success signal, or internal contradictions). The following blocking questions need answers before /iterate can implement safely:

   <numbered list of ≤5 questions, each one sentence, each citing the ambiguity in the spec>

   Once answered, remove the `needs-grooming` label (or run `/groom-issues $ISSUE_NUMBER`). /iterate will pick this issue up automatically on its next sweep.
   EOF
   )"
   gh issue edit $ISSUE_NUMBER --add-label "needs-grooming" --remove-label "iterate-in-progress"
   ```
   Then:
   - `MODE=continuous` or `MODE=drain-once` → return to **0c** to pick the next eligible issue.
   - `MODE=issue` (explicit single issue) → STOP `[iterate] Issue #$ISSUE_NUMBER deferred to grooming. See comment.` Exit.

**Bias is to skip this branch entirely.** Never defer over: implementation detail, anything answered by deep-dive docs, anything the assessor can discover from the codebase, style/naming/framework choices. Only defer for genuine spec ambiguity.

After 0f, no GitHub-side spec changes; the loop runs purely against the captured `REQUIREMENTS`.

### 0f. Compute branch / PR title / goal

| Var | Issue mode | Goal mode |
|---|---|---|
| `BRANCH` | `feature/issue-$ISSUE_NUMBER-<3–5-word slug>` | `auto-improve/<slug, 40-cap>-$(date +%Y%m%d)` |
| `PR_TITLE` | `feat: implement #$ISSUE_NUMBER — $ISSUE_TITLE` | `auto-improve: $GOAL_TEXT` |
| `GOAL_FOR_ASSESSOR` | `Satisfy all acceptance criteria of #$ISSUE_NUMBER: $ISSUE_TITLE` | `$GOAL_TEXT` |
| `REQUIREMENTS` | `$ACCEPTANCE_CRITERIA` (verbatim `- [ ]` / `- [x]` lines) | synthesise 1–3 `- [ ]` items from `$GOAL_TEXT`, e.g. `- [ ] <one-line restatement> — verifiable by <signal>` |
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
- Issue mode: links to issue · pastes full `$REQUIREMENTS` checklist (unchecked) · trailer `Closes #$ISSUE_NUMBER`.
- Goal mode: header quotes `$GOAL_TEXT` · pastes `$REQUIREMENTS` checklist (unchecked) under a `## Progress` heading. Step 8 ticks these as the assessor marks them `met`.

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
- Body: tick the requirement checkboxes the assessor marked `met` in its `REQUIREMENTS:` block — issue mode and goal mode alike. Do not tick a box without an assessor `met` verdict for that exact line. `gh pr edit <PR_NUMBER> --body "<…>"`.
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

Follow the unified retrospective contract: [`.claude/shared/retrospective.md`](../../shared/retrospective.md). Iterate-specific bindings:

- `SKILL_TAG=iterate`
- `RUN_TAG=$(echo "$BRANCH" | tr '/' '-')-iter-$N`
- `RETRO_FILE=".claude/retrospectives/$RUN_TAG.md"` (the SAFE_BRANCH prefix from earlier iterate versions is already encoded in `RUN_TAG`)
- `OUTCOME=<PASSED|DEGRADED|SKIPPED>` (per Step 2 + Step 7 result)
- For bug-mode iterations, append a `## BUG_RCA` section (verbatim from Step 3a) after `## Carry-over to the next run`.
- Phase 2 (below) is iterate's binding of **Step R2** — it runs once at terminal Done-X, not per iteration. **Skip the per-iteration R2 call** — only Step 8.5's R1 (write the file) runs inside the loop.

#### 8.5a–b. Generate

Use the R1 prompt from the shared spec, with iterate-specific context block:
```
- Mode: <MODE>   Goal: <GOAL_FOR_ASSESSOR>   Issue: #<ISSUE_NUMBER or n/a>
- Bug-mode: <IS_BUG>   Outcome: <PASSED|DEGRADED|SKIPPED>
- Commits ITER_BASE_SHA..HEAD: <SHAs + summaries>
- Files touched: <list>
- Forward-fix attempts: Step 6 = <K>, Step 7 = <0|1>
- Expert blocks: <expert + rule, or "none">
- Assessor confidence: <prev% → curr%>
- Iteration log entry verbatim: <…>
- BUG_RCA (if applicable): <verbatim>
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

See [references/release-gate.md](references/release-gate.md) for the full mirror-branch + 9a–9d flow. The loop returns to **Done-Achieved** banner on success, or halts **Done-Blocked** on pre-existing release branch / 5 forward-fix failures.

---

## Phase 2 — Improvement-spec synthesis (every terminal path)

Runs first on every Done-X — before banner, before exit. Highest signal value comes from Done-Blocked / Done-TimedOut. Full 2a–2e flow (gate, synthesise, decision, create issue+spec, optional auto-recursion) lives in [references/phase-2.md](references/phase-2.md).

## Termination

| Trigger | Path |
|---|---|
| Step 1 abort (rebase) | **Done-Blocked** (skip 2–9) |
| Step 2 `achieved` | **Done-Achieved** (run Step 9 first) |
| Step 2 `blocked` | **Done-Blocked** (skip 3–9) |
| End of Step 8.5 + `iteration+1 > 30` | **Done-TimedOut** |

**Phase 2 runs first on every terminal path.** `DEGRADED`/`SKIPPED` do NOT terminate.

### Done-Achieved · Done-Blocked · Done-TimedOut

Each terminal path: clear `iterate-in-progress` label, post the appropriate PR/issue comment, set the appropriate label (`blocked` for Done-Blocked / Done-TimedOut), print the banner, then either chain back to **0b** (when `OUTER_MODE` is `continuous`/`drain-once`) or exit. Full handler scripts in [references/done-handlers.md](references/done-handlers.md).

---

## Halt semantics

See [references/halt-semantics.md](references/halt-semantics.md) for the full enumeration of halt / DEGRADED / SKIPPED / pre-loop-halt / continuous-chaining triggers.

## Commit conventions

See [references/commit-conventions.md](references/commit-conventions.md) for the per-situation commit-message templates.

## Failure recovery

See [references/failure-recovery.md](references/failure-recovery.md) for the mid-loop interruption checklist (state file, rebase repair, rerere, retro inspection, recursion-marker hygiene, restart policy).
