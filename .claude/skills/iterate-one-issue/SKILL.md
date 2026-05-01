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
| `^--resume-pr\s+(\S+)$` | `MODE=resume-pr`, `PR_REF=$1` (number, `#N`, or PR URL). Skips 0c–0h and Phase 1; jumps to [Phase R — release-gate forward-fix](#phase-r--release-gate-forward-fix-mode-resume-pr). Caller pre-conditions: clean tree on `main` · the referenced PR carries the `iterate-pr` label · **either** the PR's most recent `release-gate.yml` run failed (forward-fix sub-mode) **or** the PR branch is behind `origin/main` (rebase-only sub-mode). Used by `merge-pr-loop` to drive forward-fixes (Step 4) and rebase-conflict resolution (Step 3.5). |
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

This skill **never calls `ask_user`**. Defer only when the spec has a **genuine ambiguity** that falls into one of these three closed categories:

| # | Deferral category | Example |
|---|---|---|
| 1 | **Internal contradictions** | AC-3 requires X, AC-7 forbids X |
| 2 | **Undefined success signal** | No AC has an observable verification method; "make it better" with no metric |
| 3 | **Unresolvable external dependency** | Spec references an external API, third-party service, or user workflow the assessor cannot inspect from the codebase |

**Anti-pattern: scope-size deferral.** Scope size (many ACs, many files, large architectural change) is **never** a deferral reason. The 30-iteration loop with phased planning (Step 4) exists to break large goals into incremental progress. If the spec is clear, proceed — even for multi-hundred-file changes. (Incident: issue #147 was incorrectly deferred as "scope too large" despite having 9 clear ACs and a full architecture spec.)

**Bias is to skip this branch entirely.** Never defer over: implementation detail, anything answered by deep-dive docs, anything the assessor can discover from the codebase, style/naming/framework choices, or scope size.

When deferral is warranted:

1. **Goal mode** — proceed with the most defensible interpretation of `GOAL_TEXT`, capture the ambiguity as a `### Operator clarifications (deferred)` block in the PR description, and continue.

2. **Issue mode** — defer to grooming. The comment **must cite one of the three categories above**:
   ```bash
   gh issue comment $ISSUE_NUMBER --body "$(cat <<'EOF'
   <!-- iterate-needs-grooming -->
   ## /iterate-one-issue halted — clarification needed before autonomous work can proceed

   **Deferral category:** <internal-contradiction | undefined-success-signal | unresolvable-external-dependency>

   The following blocking questions need answers before /iterate-one-issue can implement safely:

   <numbered list of ≤5 questions, each one sentence, each citing the ambiguity in the spec>

   Once answered, remove the `needs-grooming` label (or run `/groom-issues $ISSUE_NUMBER`). The next `/iterate-loop` sweep will pick this issue up automatically.
   EOF
   )"
   gh issue edit $ISSUE_NUMBER --add-label "needs-grooming"
   ```
   Then STOP `[iterate-one-issue] Issue #$ISSUE_NUMBER deferred to grooming. See comment.` Exit cleanly so the calling `iterate-loop` (if any) can move on to the next eligible issue.

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
state_schema_version: 2
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
---
# Iteration Log

## Open scope non-actions
<!-- branch-level (issue #309): 6a-noaction appends entries here with disposition=pending; 8-pre + termination preconditions drain them. Survives across iterations until every entry has a non-pending disposition. -->
<!-- empty initially -->

## Resolved scope non-actions
<!-- branch-level (issue #309): entries dispositioned by 8-pre or the termination-precondition gate are moved here for audit history. Never re-imported into Open. -->
<!-- empty initially -->
```

`state_schema_version` is bumped on any structured-block shape change (the YAML frontmatter or the named markdown sections above are part of the schema). Today's shape is version `2` (issue #316 added `Env-flake retries:` to Step 8-record's iteration block).

This file is the source of truth for iteration history; only Step 1 writes `iter_base_sha`. Release-gate validation is **not** performed by this skill (see [Non-goals](#non-goals)) — `merge-pr-loop` owns that lifecycle and tracks its own state on the PR itself.

### 0h. Banner

```
[iterate-one-issue] Mode: <MODE> | Goal: <GOAL_FOR_ASSESSOR>
<issue mode:> Issue: #<ISSUE_NUMBER> | Spec source: <SPEC_SOURCE> | Bug-mode: <IS_BUG>
Branch: <BRANCH> | PR: <PR_URL>
Starting autonomous loop — cap 30. Per-iteration retrospectives committed to this branch.
```

---

## Phase 1 — Iteration loop

Counters: `iteration=1`, `passed_count=0`, `degraded_count=0`, `INLINE_FIX_USED=0` (Phase 1.5 inline-fix carry-over cap; reset to 0 once per skill invocation, never decremented). Run Steps 1–8 each iteration. Termination fires only at Step 1 (rebase abort) or Step 2 (`achieved`/`blocked`) or end-of-iteration cap. **Step 2 `achieved` does NOT immediately invoke the Done-Achieved handler — it first passes through [Phase 1.5](#phase-15--inline-fix-carry-over-done-achieved-only-gated) which may extend the loop with one bounded follow-on iteration before Done-Achieved fires.**

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
- `achieved` → **[Phase 1.5](#phase-15--inline-fix-carry-over-done-achieved-only-gated)** eligibility gate. If gate fires, loop extends by one bounded iteration before Done-Achieved handler runs. If gate skips, Done-Achieved handler runs immediately. Either way: no commit at this step.
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
Sprint plan for this iteration. Identify all required work, then scope this iteration to a convergent phase.

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
<if INLINE_FIX_USED == 1 (Phase 1.5 carry-over active):>
**Inline-fix task brief:** <verbatim TASK_BRIEF parsed from Phase 1.5b synthesis output>
This brief is load-bearing — it bounds the candidate's scope (allowed files, out-of-scope, required test layer, rule citations). The plan MUST address the new `Phase 1.5 inline-fix carry-over` AC appended to NEXT_REQUIREMENTS using only the files listed in this brief; touching anything outside that allow-list is a scope violation that 6a-pre will revert.
<end>

Phased planning (apply when NEXT_REQUIREMENTS contains >5 items OR overall risk is high):
- Map all remaining work, then choose ONE iteration-sized phase for this iteration.
- Phase boundaries follow dependency order (e.g. data model before UI, core logic before integration).
- Carry remaining phases forward explicitly as "deferred to iteration N+1" — the assessor tracks partial met/unmet progress.
- Example: a 9-AC architectural feature might target ACs 1-3 (Rust data model + types) in iteration 1, ACs 4-6 (IPC + store) in iteration 2, ACs 7-9 (UI + E2E) in iteration 3.

Use NEXT_REQUIREMENTS grouping: independent groups parallel; dependents wait.
Per group: files · exact changes · tests · group dependencies · expected local validation · AC items satisfied (issue mode, cite spec).
Rate overall risk: low | medium | high.

AC literal compliance (issue #326 — load-bearing for issue mode with explicit AC):
When the source spec has explicit acceptance-criteria checkboxes or bullets (`- [ ]` / `- [x]` / `- ` under `## Acceptance criteria`), the plan MUST emit a top-level `**AC literal compliance:**` section BEFORE the per-group breakdown. For each AC bullet, extract every:
- LITERAL STRING — exact words/phrases the AC requires verbatim (e.g. `'environmental_failure: true'`, `'PASS — docs-only diff'`, `'docs/architecture.md'`).
- STRUCTURED FIELD NAMES + VALUES — YAML/JSON/markdown field names with their required values (e.g. `verdict: ENVIRONMENTAL`, `LAYER: native-e2e`, `severity: P1`).
- FILE PATHS — exact relative paths the AC names (e.g. `src-tauri/src/core/sidecar.rs`, `.claude/agents/lean-expert.md`).
- COMMAND NAMES — exact CLI invocations or function names (e.g. `npm run lint:skills`, `cargo test`, `compute_anchor_hash`).
- HEADINGS / SECTION NAMES — exact markdown headings the AC requires the implementation to emit or contain (e.g. `## Open scope non-actions`, `### Step 4 — Plan`).
- REGEX / PATTERNS — any regex-shaped or pattern-shaped requirement (e.g. `^pre-flight:`, `MDR-CONSOLE-ERROR`).
Cite each extracted literal back to the AC bullet it came from (e.g. `AC #3: structured field environmental_failure: true`). Skip this section ONLY if the spec has zero explicit AC bullets — never summarise the AC text in place of literal extraction.

Completeness rules (non-negotiable, per docs/test-strategy.md rules 4-5):
- UI-visible change → browser e2e in e2e/browser/ AND native e2e in e2e/native/ if real I/O or IPC.
- New Tauri command → commands.rs + tauri-commands.ts + IPC mock in src/__mocks__/@tauri-apps/api/core.ts.
- Delete code made obsolete in the same step. No TODOs, half-wires, workarounds.
```

Save as `PLAN`. Parse groups · label `independent` or list deps. The `**AC literal compliance:**` section (when emitted) is contractually attached to `PLAN` and forwarded to every Step 5 implementer prompt verbatim — see Step 5.

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
<if PLAN contains an **AC literal compliance:** section:>
**AC literal compliance (issue #326 — copy VERBATIM, do not summarise):**
<paste the entire **AC literal compliance:** section from PLAN, byte-for-byte, including bullet structure and citations>

The AC literal compliance section above is load-bearing: every literal string, structured field name+value, file path, command name, heading, and regex pattern listed there MUST appear verbatim in the diff this group produces (in the implementation code, the test assertions, the doc text, or wherever the AC bullet anchors them). Summarising or paraphrasing an AC literal is a contract violation and will be flagged at Step 7 review.
<end>
Do NOT touch files outside this group. Do NOT ask questions — if ambiguous, conservative choice + note.
Return Implementation Summary.
```

Wait for each dependency wave. Collect every summary.

Every implementer reports "no changes" → log `SKIPPED — no-op: <reason>` to state file, no commit, advance iteration.

### Step 6 — Push, classify diff, race local + CI + experts

#### 6a. Push

##### 6a-noaction. Scope non-action capture (issue #309) — record implementer-reported deferrals

Every `exe-task-implementer` Implementation Summary contains a `**Did NOT do (scope):** ...` field (see `.claude/agents/exe-task-implementer.md`). Before staging anything in this iteration's commit, parse those reports so deferred work cannot evaporate into agent-output text:

1. For every implementer summary returned in this iteration's wave (Step 5 group OR a 6d forward-fix attempt — see 6d step 4 below for the forward-fix re-run requirement), extract the scope non-action block using these explicit rules:
   - **Start marker**: the literal line containing `**Did NOT do (scope):**` (case-sensitive — the field name is contractual, see `.claude/agents/exe-task-implementer.md`).
   - **End marker**: the next top-level Implementation-Summary field marker (`**<Field>:**` matching `^\*\*[A-Z][A-Za-z ]+:\*\*` in markdown), OR end of the summary.
   - **Body**: the text BETWEEN start and end markers, indentation preserved verbatim. Trim only the start marker line itself.
   - **Empty/none**: if the body is empty, whitespace-only, or a single bullet `- none` / `none`, treat as no non-action and skip.
   - **Multiple sections**: if a single Implementation Summary has more than one `**Did NOT do (scope):**` field (anomalous but possible), concatenate all bodies in encounter order, separated by `\n---\n`. Do **not** silently skip later sections.
   - **Malformed (no end marker found)**: capture from start marker to end of summary; flag with `[scope-noaction] WARN: malformed summary, no closing field marker — captured to EOF`.
2. Append each captured non-empty body as a `scope_non_actions[]` entry to the **branch-level** `## Open scope non-actions` section in the state file `.claude/iterate-state-<branch-slug>.md` with this shape:
   ```yaml
   - implementer_attempt_id: <iter-N-step5-<group> | iter-N-6d-attempt-K>
     raw_text: |
       <verbatim Did NOT do (scope) body — multi-line, indentation preserved>
     disposition: pending   # final value set in 8-pre or the termination-precondition gate
     disposition_note: ""   # one-line rationale, set when disposition leaves pending
   ```
   Note: capture lives at the **branch level** (one Open list per branch), not per-iteration. This lets pending entries survive across DEGRADED iterations until they are explicitly dispositioned. Per-iteration provenance is preserved in `implementer_attempt_id`.
3. Log to stdout: `[scope-noaction] captured: <implementer_attempt_id> -- <first 80 chars of raw_text>`.
4. **Worked example** (locked in the contract test): an implementer that returns `**Did NOT do (scope):** rustfmt outside declared files` produces this entry:
   ```yaml
   - implementer_attempt_id: iter-1-step5-rust-changes
     raw_text: |
       rustfmt outside declared files
     disposition: pending
     disposition_note: ""
   ```
   The disposition gate at 8-pre + the termination-precondition gate (see done-handlers) MUST resolve this entry to one of `accepted`, `handled-in-forward-fix`, or `follow-up-issue:<N>` before the iteration can record PASSED or transition to Done-Achieved.

The state-file capture is the durable record (referenced by Step 8's record field, the PR comment, the post-loop retro, and Phase 2 synthesis). No commit is needed at this step — the state file is iteration-local.

##### 6a-pre. Scope-diff guard (issue #302) — block workspace-wide formatter churn

Implementers report their changed files in their Implementation Summary's `**Files changed:**` block. **Before staging anything**, run a scope-diff guard so workspace-wide `cargo fmt` (or any other off-scope edit) cannot leak into the iteration commit:

1. Compute `EXPECTED_FILES` = the union of every implementer's reported `Files changed` paths from this iteration's Step 5 wave (and any earlier 6d wave on the same iter, see below).
2. Compute `ACTUAL_FILES = git diff --name-only` (working tree against `HEAD`).
3. `UNEXPECTED = ACTUAL_FILES − EXPECTED_FILES`.
4. For each `path` in `UNEXPECTED`:
   - If `path` ends in `.rs` AND `git diff -w -- "$path"` is empty (whitespace-only churn — the exact failure mode from issue #302): revert with `git checkout HEAD -- "$path"`, log `[scope-guard] reverted format-only churn: $path` to stdout, AND append the same line to the iteration's block in the state file `.claude/iterate-state-<branch-slug>.md` so retros can see cross-iteration patterns of formatter abuse.
   - Else: do NOT auto-revert (the file may carry load-bearing edits the implementer forgot to report). Log `[scope-guard] BLOCK: unexpected file outside reported scope: $path` to stdout, append the same line to the state file's current iteration block, and surface it as a **scope-guard BLOCK** to 6d's forward-fix wave (see 6d step 1 for the justify-or-revert carve-out). Re-run this guard until clean.
5. Only after `UNEXPECTED` is empty do we proceed to the staging block below. Never `git add -A`.

The implementer prompt forbids `cargo fmt`/`cargo fmt --all`/`cargo fmt -p` directly (see `.claude/agents/exe-task-implementer.md`); this guard is the second line of defence in case an agent (or a manual fix-up commit) violates that rule.

##### 6a-stage. Stage and commit
```bash
git add <specific files reported by implementers — NEVER git add -A blindly>
git commit -m "$COMMIT_MESSAGE"
git push
```
Commit messages: see Commit conventions table below.

#### 6b. Classify diff (consumed by 6c and Step 7)

**New-IPC-surface gate (issue #125)** — before running the classifier, if `git diff --name-only "$ITER_BASE_SHA" HEAD` includes any of `src-tauri/src/commands/**` (new `#[tauri::command]` lines), `src-tauri/src/commands.rs`, or `src/lib/tauri-commands.ts` (new exported wrapper), reject the iteration if the iter commit messages on `$ITER_BASE_SHA..HEAD` do not contain a `pre-flight:` line citing the rg result. Treat as a forward-fix BLOCK — feed back into 6d. The pre-flight contract is documented in `.claude/agents/exe-task-implementer.md` "Pre-flight: Caller-Side Verification".

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

# Caller-side pre-flight gate — only applies when DIFF_CLASS=code AND new IPC surface added
if [ "$DIFF_CLASS" = "code" ]; then
  ADDS_IPC=$(git diff "$ITER_BASE_SHA" HEAD -- 'src-tauri/src/commands/**' 'src-tauri/src/commands.rs' 'src/lib/tauri-commands.ts' \
    | grep -E '^\+.*(#\[tauri::command\]|export (async )?function)' | wc -l)
  if [ "$ADDS_IPC" -gt 0 ]; then
    if ! git log "$ITER_BASE_SHA..HEAD" --format=%B | grep -q '^pre-flight:'; then
      echo "[caller-preflight] BLOCK: new IPC surface added but no commit message contains 'pre-flight:' citation. See .claude/agents/exe-task-implementer.md."
      # Surface this to 6d as a forward-fix BLOCK; do not silently proceed.
    fi
  fi
fi
```

`DIFF_CLASS` rules:
- **`code`** — at least one file outside `.claude/**`, `docs/**`, root `*.md`. Default when in doubt.
- **`prompt-only`** — every changed file is under `.claude/skills/` or `.claude/agents/` (rule contracts, no behavioural code).
- **`docs-only`** — every changed file is under `.claude/**` (non-prompt) or `docs/**` or a root `*.md`.
- **`none`** — empty diff (Step 5 was a no-op; you should not be here).

> **Contract test**: the DIFF_CLASS scoping for 6b/6c-A/Step 7 is locked in by `src/__tests__/iterate-skill-contract.test.ts` (issue #122). If you change a row in the validator or expert-panel tables, update that test too.

#### 6c. Local validate ∥ CI poll ∥ Expert diff review (parallel)

ONE message, three agents launched together. The expert panel runs against the pushed diff — does not wait for local/CI.

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

CI is path-filtered (`.github/workflows/ci.yml`); on `prompt-only`/`docs-only` diffs every check skips green within ~30 s — poller exits fast.

**C — Expert diff review panel (diff-scoped, see Step 7).** Launched in the SAME parallel message as A and B; details in Step 7.

#### 6d.0. Environmental retry (one-shot, pre-loop) — issue #316

Before entering the forward-fix loop, check whether the validator (A from 6c) returned an environmental classification. The validator emits `<!-- iterate-validator-classification -->` followed by `classification: ENVIRONMENTAL`, `suite: native-e2e`, and `environmental_failure: true` when a native-E2E failure matches the host-state signatures (`0x8007139F`, `ERROR_SERVICE_NOT_ACTIVE`, `CDP HTTP did not become ready`) AND the diff has no changes under `e2e/native/` or to `src-tauri/src/lib.rs` / `src-tauri/src/main.rs` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` / `src-tauri/build.rs` / `playwright.native.config.ts` / `scripts/stage-cli.mjs` / `src-tauri/binaries/**`. Per rule 27 in `docs/test-strategy.md`, this classification triggers a free retry:

1. **Detection.** Grep validator output for `^classification: ENVIRONMENTAL$` AND `^suite: native-e2e$`. If absent, skip 6d.0 entirely and proceed to 6d.
1.5. **Wait for B + complete env-retry before evaluating outcomes.** If CI poller B (6c-B) is still `in_progress`, wait for it to complete first. Then run the env-retry (steps 2-5 below) to terminal state BEFORE entering 6d's forward-fix loop. The env-retry decision (pass / repeat-env / different-verdict / malformed / timeout) gates whether 6d.0 outcomes 2 ("soft-PASS skip 6d") or 3 ("enter 6d") fires. 6d does not start its 5-attempt loop until 6d.0 has fully terminated.
2. **Retry constraints.** Re-run only the native-E2E suite (`npm run test:e2e:native`) — NOT validator A's full suite, NOT CI poller B, NOT expert panel C. The diff is unchanged; expert verdicts from 6c-C still apply (per the existing "Reuse SAME expert set unless DIFF_CLASS changed" rule below). Do NOT re-spawn the expert panel; DIFF_CLASS is unchanged because the diff is unchanged.
3. **Retry cap.** One retry total. Does NOT consume the 5-attempt forward-fix budget.
4. **Outcomes:**
   - **Retry passes** → the env-flake cleared. Treat A as PASS for this iteration. Proceed normally.
   - **Retry repeats the same `ENVIRONMENTAL` classification AND no expert from 6c-C is BLOCKing AND CI poller B is green/skipped AND no scope-guard BLOCK from 6a-pre** → record env-flake warning (see step 5 below). Treat A as soft-PASS for this iteration's outcome calculation; do NOT enter the forward-fix loop solely for this host-state failure. Proceed to Step 7 disposition.
   - **Retry repeats ENVIRONMENTAL but other 6c signals (B fail or C BLOCK or scope-guard BLOCK from 6a-pre) need addressing** → record env-flake warning AND enter the regular forward-fix loop (6d) for the OTHER failures only. The implementer prompt should NOT mention the env-flake (it's not actionable in code).
   - **Retry produces a different verdict (PASS or hard FAIL)** → use that verdict directly; no env-flake special-casing.
   - **Retry produces malformed output (no `<!-- iterate-validator-classification -->` marker, no `### Native E2E:` header, or both signals contradict each other)** → treat as hard FAIL. Do NOT trust the retry; surface the malformed output to the operator via stdout log + state-file warning, then enter the regular forward-fix loop (6d) treating the env-flake as a hard FAIL for this iteration.
   - **Retry hangs / times out / never returns terminal output within 10 minutes** → treat as hard FAIL. Log `[env-flake] retry timeout — suite: native-e2e — no terminal output within 10 minutes` to stdout AND append to state file's iteration block. Enter the regular forward-fix loop (6d) treating the env-flake as a hard FAIL for this iteration.
5. **Warning mechanism.** Log `[env-flake] retry $RESULT — suite: native-e2e — <verbatim trigger token from validator>` to stdout AND append the same line to the state file's current iteration block (mirrors the scope-guard precedent at 6a-pre). Step 8-record's iteration block (see template below) gains an `Env-flake retries:` field for retro consumption.

Sequencing guarantee: 6d.0 completes (env-retry runs to terminal state and outcome is selected) BEFORE 6d enters its forward-fix loop. There is no concurrent execution between env-retry and 6d's implementer waves.

#### 6d. Forward-fix loop (max 5 attempts) — merges A/B/C failures

Repeat until A, B, AND C are all green/APPROVE, or 5 attempts:

1. Collect every failure: validator failures (A) + CI check failures (B) + every BLOCK from the expert panel (C) + every **scope-guard BLOCK** from 6a-pre (issue #302). **Exclude validator A from the failure bundle when its classification is `ENVIRONMENTAL` (per 6d.0 above) — that signal is not actionable as a code fix.** Scope-guard BLOCKs are a distinct category from A/B/C — they have a justify-or-revert carve-out documented in step 2 below.
2. ONE `exe-task-implementer`:
   ```
   Fix all of the failures below in one pass.

   General policy: forward-fix only — no revert — for validator failures, CI failures, and expert BLOCKs.

   **Scope-guard BLOCKs (issue #302) — special handling, justify-or-revert allowed:**
   For each listed unexpected path from the scope-diff guard at 6a-pre, choose ONE:
     (a) Revert the file with `git checkout HEAD -- "<path>"` if it was an off-scope edit you did not intend (e.g. a stray formatter run, an editor auto-format, a test fixture you touched and forgot about). Report the revert in your `Files changed` block with `(reverted off-scope)` annotation.
     (b) Keep the edit and add `<path>` to your reported `Files changed` block with a one-line justification of why it belongs in this iteration's scope.
   DO NOT silently absorb scope-guard-flagged files without explicit acknowledgment in the Implementation Summary.

   Local: <full output>
   CI: <names + logs>
   Expert blocks: <each: expert · file:line · rule · fix direction>
   Scope-guard BLOCKs: <list of unexpected paths from 6a-pre>
   Prior attempts: <summaries>
   Minimal change per failure. Tighten existing code over new abstractions. Do NOT reopen approved concerns.
   Return Implementation Summary.
   ```
3. **Re-apply scope-noaction capture (6a-noaction, issue #309) AND scope-diff guard (6a-pre, issue #302)** against the forward-fix implementer's Implementation Summary, in that order:
   - First, run the 6a-noaction parser against the forward-fix Implementation Summary's `**Did NOT do (scope):**` field (per the explicit boundary rules at 6a-noaction step 1). Append any non-empty captures to the branch-level `## Open scope non-actions` section with `implementer_attempt_id: iter-<N>-6d-attempt-<K>`. The forward-fix prompt at step 2 above includes "Return Implementation Summary" — that summary MUST contain the standard `**Did NOT do (scope):**` field per `.claude/agents/exe-task-implementer.md`.
   - Second, run the 6a-pre scope-diff guard against the forward-fix's reported `Files changed` (treat its summary as the new `EXPECTED_FILES`; the original Step 5 `EXPECTED_FILES` from this iteration still counts as in-scope).
   Then commit:
   ```bash
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

Spawn the panel in the SAME parallel message as the validators (6c-C). Composition is demand-driven by `DIFF_CLASS` + path triggers (mirrors Step 3).

**Always included** (every diff): `lean-expert`, `rubber-duck`.

**By `DIFF_CLASS`:**

| `DIFF_CLASS` | Add to panel |
|---|---|
| `code` | `product-expert`, `performance-expert`, `architect-expert`, `react-tauri-expert`, `bug-expert`, `test-expert`, `documentation-expert` (always with code), and **conditionally** `security-expert` when diff touches `src-tauri/src/commands.rs`, `src-tauri/src/core/sidecar.rs`, any `Path`/`canonicalize` use, or any `src/components/viewers/` markdown rendering. |
| `prompt-only` | `documentation-expert` (the prompt itself is documentation), `architect-expert` (skill/agent contracts shape downstream IPC and dispatch). Skip the rest — `react-tauri-expert`/`performance-expert`/`bug-expert`/`security-expert`/`test-expert` have nothing to say about a markdown contract change. |
| `docs-only` | `documentation-expert` only. |
| `none` | Skip Step 7 entirely. |

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

Type-surface proof for literal code/assertion suggestions (issue #320 — panel-wide):
Any literal code or assertion suggestion you emit (e.g. a Rust assertion like `assert_eq!(loaded.comments[0].field, ...)`, a TypeScript expression, a regex you assert against an output) MUST cite the struct/function/type definition (file:line) that makes it type-valid, OR be explicitly labelled as `pseudocode` with a one-line note stating what surface still needs verification. Snippets that cannot compile/typecheck against the cited surface (e.g. naming a non-existent field) are themselves a BLOCK condition — they impose adaptation cost on the implementer and erode review trust. This rule applies to every reviewer in this panel.

Return APPROVE or BLOCK with file:line + "violates rule N in docs/X.md".
```

Findings flow into 6d's forward-fix wave alongside validator/CI failures. Convergence is owned by 6d — no separate Step 7 forward-fix loop.

### Step 8 — Record

#### 8-pre. Scope non-action disposition gate (issue #309) — block PASSED on undisposed deferrals

Before recording PASSED, every entry in the **branch-level** `## Open scope non-actions` section of the state file MUST have a non-`pending` disposition. This includes entries captured by 6a-noaction in this iteration AND any pending entries left over from prior DEGRADED iterations on the same branch.

Allowed disposition values (exactly these three — extending the set requires a contract-test update):

- `accepted` — the runner intentionally defers the non-action (out-of-scope for this iteration, mis-categorised as scope when it was actually in-scope, or any other reason that doesn't warrant a follow-up issue). `disposition_note` carries a one-line rationale.
- `handled-in-forward-fix` — a subsequent 6d implementer wave addressed the gap; `disposition_note` cites the commit SHA that closed it.
- `follow-up-issue:<N>` — a separate GitHub issue tracks the work; the runner MUST verify the issue exists and is open with `gh issue view <N>` (closed issues are NOT acceptable — re-categorise to `accepted` if the work was completed under a different issue); `disposition_note` carries a one-line summary.

Workflow:

1. Read every entry under `## Open scope non-actions` in the state file (this iteration's new entries from 6a-noaction PLUS any leftover `pending` entries from prior iterations on this branch).
2. For each entry with `disposition: pending`, the runner reviews the entry against this iteration's commits, reviewer feedback, and other implementer summaries; chooses one of the three allowed values; writes a one-line `disposition_note`.
3. For borderline entries, the runner MAY consult `architect-expert` or `bug-expert` with the entry's `raw_text` + `implementer_attempt_id` + iteration log. The runner makes the final call.
4. Update the state file in place: replace `disposition: pending` with the chosen value, set `disposition_note`. Move the entry from `## Open scope non-actions` to `## Resolved scope non-actions` (audit history; entries here are never re-imported into Open).
5. **Block PASSED:** if any entry remains `pending` at the end of this gate, the iteration cannot record PASSED. Log `DEGRADED — scope non-action <implementer_attempt_id> remains pending: <reason>`, set the iteration's outcome to DEGRADED in the Step 8 record below, and proceed (do NOT loop forever in this gate; PASSED is unavailable until the runner resolves all entries — either in a later 8-pre run or in the termination-precondition gate before any Done-X exit, see [`references/done-handlers.md`](references/done-handlers.md)).

This gate ensures implementer-reported scope deferrals never silently disappear: they get explicit acknowledgement, a follow-up issue, or a documented `accepted` rationale — visible in the iteration record, the PR comment, the retro, and Phase 2 synthesis.

#### 8-record. Append to state file

```markdown
## Iteration <N> — <PASSED | DEGRADED | SKIPPED>
- DIFF_CLASS: <code | prompt-only | docs-only | none>
- Commits: <SHAs from ITER_BASE_SHA..HEAD>
- Validate+CI+Experts: <converged in K | degraded after 5>
- Scope-guard: <K reverted, M blocked | clean>   <!-- issue #302: K = whitespace-only .rs files auto-reverted by 6a-pre; M = unexpected files surfaced as scope-guard BLOCKs into 6d. "clean" if both zero. -->
- Scope-non-actions: <list of (task_id → disposition + disposition_note) | none>   <!-- issue #309: items captured by 6a-noaction with their 8-pre dispositions. "none" if every implementer reported empty Did NOT do (scope). -->
- Env-flake retries: <native-e2e=K, cleared M, warned N | none>   <!-- issue #316: K = total env-flake retries triggered by 6d.0; M = retries that cleared (validator went green); N = retries that repeated ENVIRONMENTAL (warning recorded). "none" if 6d.0 didn't fire this iteration. -->
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
  <if scope_non_actions non-empty: **Scope non-actions:** <K accepted, M handled-in-fix, P follow-up, Q rejected>>
  <if DEGRADED: Carry-over: …>
  Next: iteration <N+1>
  EOF
  )"
  ```

`iteration += 1`. PASSED → `passed_count += 1`.

### Step 8.5 — Retrospective

Follow the unified retrospective contract: [`.claude/shared/retrospective.md`](../../shared/retrospective.md). Skill-specific bindings:

- `SKILL_TAG=iterate-one-issue`
- `RUN_TAG=$(echo "$BRANCH" | tr '/' '-')-iter-$N`
- `RETRO_FILE=".claude/retrospectives/$RUN_TAG.md"`
- `OUTCOME=<PASSED|DEGRADED|SKIPPED>` (per Step 2 + Step 7 result)
- Bug-mode: append `## BUG_RCA` (verbatim from Step 3a) after `## Carry-over to the next run`.
- Phase 2 below binds **Step R2** — runs once at terminal Done-X. Skip per-iteration R2; only Step 8.5's R1 runs inside the loop.

#### 8.5a–b. Generate

Spawn the **retro author** (`general-purpose`, R1 prompt below) — writes `$RETRO_FILE`.

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
- Scope non-actions captured this iter: <list of (implementer_attempt_id → disposition + note); cite the branch-level Open + Resolved sections so cross-iteration patterns are visible>
- Open scope non-actions still pending (branch-level): <count + implementer_attempt_id list, or "none" — issue #309>
- BUG_RCA (if applicable): <verbatim>
```

Write output verbatim to `$RETRO_FILE`.

#### 8.5c. Persist retro (no commit)

`.claude/retrospectives/` is `.gitignore`d. Do **not** commit — keeps the iteration tip clean and lets recovery from any worktree just read the local file.

```bash
ls -l "$RETRO_FILE" >/dev/null   # sanity-check 8.5a/b write
```

If missing, log `[step8.5] retro not written — synthesis output unrecoverable` and continue.

#### 8.5d. Link from progress comment

Append to Step 8 comment (link local path, not blob URL — retro is uncommitted):
```
**Retrospective:** `<RETRO_FILE>` (runtime artefact, not committed) — <count> improvement candidate(s)
```

**Termination check after 8.5:** `iteration > 30` → **Done-TimedOut**. Else loop back to Step 1.

---

## Phase 1.5 — Inline-fix carry-over (Done-Achieved only, gated)

Runs ONLY between Phase 1 termination at Step 2 = `achieved` and the [Done-Achieved handler](references/done-handlers.md#done-achieved). Skipped for every other terminal path (`blocked`, `Done-TimedOut`, `Done-ForwardFixed`). Phase 1.5 is the single chokepoint where the skill may inline-fix a small product bug or test improvement surfaced in the just-written retro instead of filing a follow-up GitHub issue at Phase 2.

**Why before the Done-Achieved handler:** the Done-Achieved handler runs `gh pr ready` + `gh pr edit --add-label iterate-pr` (steps 3–4), at which point `merge-pr-loop` may begin polling. Mutating the branch from Phase 2 (which runs at handler step 6) would race the gate. Phase 1.5 happens while the PR is still draft — no merge-loop interaction risk.

### 1.5a. Eligibility gate

Required preconditions (ALL must hold; otherwise skip Phase 1.5 entirely):

1. Phase 1 just terminated `achieved` at Step 2 of iteration `<N>`.
2. `INLINE_FIX_USED == 0` (cap = 1 inline-fix per `iterate-one-issue` invocation; the cap survives even if the inline-fix iteration itself terminates `blocked`/`DEGRADED`).
3. The most recent retro file `$RETRO_FILE` (written by Step 8.5 of iteration `<N>` OR — if Step 2's `achieved` shortcut bypassed Step 8.5 — written by the prior iteration's Step 8.5) exists and contains at least one `### <candidate-title>` block under `## Improvement candidates` (i.e. is NOT the literal `_None — run was clean…_` line).
4. Light synthesis (single `general-purpose` call against THIS run's retros only — NOT the cross-run R2b synthesis in Phase 2) emits a candidate where ALL hold:
   - `**Category:**` parses to exactly one of `bug` OR `test-strategy`.
   - `**Estimated size:**` parses to exactly one of `xs` OR `s`.
   - `**Confidence this matters:**` parses to exactly one of `medium` OR `high`.
   - The candidate's `**Proposed change:**` text references file paths ENTIRELY under `src/`, `src-tauri/`, or `e2e/` (no `.claude/`, no `docs/`, no root `*.md`, no `.github/`). Mixed paths → ineligible (defer to Phase 2 issue creation).

If any condition fails, skip Phase 1.5 and proceed directly to the [Done-Achieved handler](references/done-handlers.md#done-achieved). Phase 2 will run at handler step 6 as today and may create a follow-up issue per the shared retrospective contract.

### 1.5b. Light synthesis prompt

Spawn `general-purpose`:
```
Inline-fix gate for /iterate-one-issue Phase 1.5.
Branch: <BRANCH>   Iteration: <N>   Outcome: Done-Achieved (Phase 1)
Retro: <verbatim contents of $RETRO_FILE>

Pick AT MOST ONE candidate from the retro's `## Improvement candidates` section that meets ALL:
- Category is exactly `bug` OR `test-strategy`
- Estimated size is exactly `xs` OR `s`
- Confidence this matters is exactly `medium` OR `high`
- Proposed change touches ONLY files under `src/`, `src-tauri/`, or `e2e/` (no `.claude/`, no `docs/`, no root *.md, no `.github/`)

If no candidate matches, output exactly:
INLINE_FIX_INELIGIBLE
<one-line justification>

Otherwise output exactly this template — no preamble, no extra commentary:

INLINE_FIX_ELIGIBLE
TITLE: <imperative, <=70 chars>
CATEGORY: <bug | test-strategy>
SIZE: <xs | s>
CONFIDENCE: <medium | high>
PATHS: <comma-separated allowed paths under src/ src-tauri/ e2e/>
ACCEPTANCE_SIGNAL: <one observable, measurable signal — verbatim from the retro candidate>
TASK_BRIEF:
<a 5-15-line scoped implementer brief: task sentence + allowed files + explicit out-of-scope + required test layer + rule citations from docs/*.md>
```

If output starts with `INLINE_FIX_INELIGIBLE`, log `[phase-1.5] inline-fix ineligible: <justification>` and skip to the Done-Achieved handler.

### 1.5c. Append AC + extend the loop

If output starts with `INLINE_FIX_ELIGIBLE`:

1. Set `INLINE_FIX_USED=1`.
2. Append a new requirement to `REQUIREMENTS` (the assessor's source of truth at Step 2):
   ```
   - [ ] Phase 1.5 inline-fix carry-over: <ACCEPTANCE_SIGNAL> (category=<CATEGORY>, size=<SIZE>; from retro candidate "<TITLE>")
   ```
   This becomes a new unmet AC, so the next assessor pass at Step 2 will return `in_progress` (not `achieved`), keeping the loop alive for one more iteration.
3. Append to the state file under a new `## Inline-fix carry-overs` section:
   ```yaml
   - iteration_at_eligibility: <N>
     title: <TITLE>
     category: <bug | test-strategy>
     size: <xs | s>
     confidence: <medium | high>
     paths: <PATHS>
     acceptance_signal: <ACCEPTANCE_SIGNAL>
     status: pending   # set to `landed` when the follow-on iteration converges; `dropped` if the follow-on terminates blocked/degraded
   ```
4. Print banner:
   ```
   [phase-1.5] inline-fix carry-over eligible: "<TITLE>" (<CATEGORY>/<SIZE>/confidence=<CONFIDENCE>)
              extending Phase 1 by one bounded iteration before marking PR ready.
   ```
5. `iteration += 1` (counts against the 30-cap). If `iteration > 30` after increment, do NOT enter the follow-on iteration; instead, edit the most recent `## Inline-fix carry-overs` entry in `.claude/iterate-state-<branch-slug>.md` to set `status: dropped` with note `cap-exhausted: iteration > 30`, log `[phase-1.5] inline-fix dropped — 30-cap exhausted`, and proceed directly to the Done-Achieved handler.
6. **Carry the parsed `TASK_BRIEF` into Step 4 of the follow-on iteration** as a load-bearing context block. The Step 4 planner's `NEXT_REQUIREMENTS` already includes the new AC from step 2; the `TASK_BRIEF` is appended verbatim under a `**Inline-fix task brief:**` heading in the Step 4 prompt (the Step 4 prompt template includes `<if INLINE_FIX_USED == 1 ...>` for exactly this purpose) so the planner has the candidate's scope budget.
7. Re-enter Phase 1 at **Step 1** (rebase). The full pipeline runs — planner (Step 4), 6a-pre scope-diff guard, validators (6c-A), CI (6c-B), expert panel (6c-C), forward-fix loop (6d).
8. **State-file status flip on second-pass termination** (single chokepoint — the runner owns this write):
   - When Phase 1 terminates `achieved` AGAIN at Step 2 of the follow-on iteration, edit the most recent entry in `## Inline-fix carry-overs` to set `status: landed` with `landed_commit: $(git rev-parse HEAD)`. Do this BEFORE invoking the Done-Achieved handler so the handler's PR comment can reference the landed inline-fix.
   - When Phase 1 terminates `blocked` at Step 2 of the follow-on iteration, edit the entry to set `status: dropped` with note `blocked: <BLOCKING_REASON>`. Done-Blocked handler runs as today.
   - When Step 8.5 advances `iteration > 30` during the follow-on iteration, edit the entry to set `status: dropped` with note `timed-out: <BLOCKING_REASON or "30-cap during follow-on iteration">`. Done-TimedOut handler runs as today.
   In all three cases the audit trail in `## Inline-fix carry-overs` reflects the actual outcome — never leave `status: pending` past terminal exit.

Phase 1 will terminate again at Step 2 either:
- `achieved` → Phase 1.5 re-runs its eligibility gate. `INLINE_FIX_USED == 1` so it skips. State file's `status: pending` flips to `landed` per step 8 above. Done-Achieved handler runs.
- `in_progress` → loop continues normally up to the 30-cap.
- `blocked` → state file's `status: pending` flips to `dropped` per step 8 above. Done-Blocked handler runs (the inline-fix attempt is recorded in carry-over for the post-loop retro).

### 1.5d. Done-Achieved handler invariant

The Done-Achieved handler ([references/done-handlers.md](references/done-handlers.md#done-achieved)) is invoked ONLY after Phase 1.5 has either skipped (eligibility gate failed) or completed (the follow-on iteration converged or `INLINE_FIX_USED == 1` on the second pass). The handler's existing termination-precondition gate (drain `## Open scope non-actions`) and bug-mode behavioural verification still run — Phase 1.5 only adds the inline-fix carry-over check upstream of those.

> **Contract test**: the Phase 1.5 ordering invariants (cap=1 via `INLINE_FIX_USED`, runs before `gh pr ready` / `iterate-pr` label, eligibility gate categories/sizes/paths) are locked by `src/__tests__/iterate-skill-contract.test.ts`. If you change Phase 1.5 behaviour, update that test too.

---

## Phase R — Release-gate forward-fix mode (`--resume-pr`)

Entered from Phase 0a when `MODE=resume-pr`. Skips Phase 0c–0h (no spec, no new branch, no PR creation) and Phase 1 (no goal-assessor loop).

Phase R has **two sub-modes**, auto-selected at R3 based on what's wrong with the PR:

| Sub-mode | Trigger (R3) | What runs | Exit |
|---|---|---|---|
| **forward-fix** | Latest `release-gate.yml` run on the branch is `failure` | R3 → R4 (logs) → R5 (rebase if behind) → R6 (`exe-task-implementer` consumes failed-job logs) → R7 (commit + push) → R8 | `Done-ForwardFixed` |
| **rebase-only** | No failed gate run **and** branch is behind `origin/main` | R3 → R5 (rebase + per-file conflict resolver) → R7 (push only, no commit) → R8 | `Done-ForwardFixed` |

In both sub-modes the skill writes a `<!-- iterate-forward-fix-attempt -->` marker and the caller (`merge-pr-loop`) re-dispatches the gate. Both sub-modes share the same 5/PR attempt budget.

**Phase R always rebases against the freshest `origin/main`** at the time R5 runs — not whatever snapshot the caller saw. If `origin/main` advanced again between the caller's behind-check and R5, that's fine: rebasing onto the newer main is exactly what we want.

**Phase R does not increment the `.claude/iterate-recursion-depth` marker** (Phase 0b's hygiene step ages out stale markers but Phase R is single-pass, not recursive). The caller (`merge-pr-loop` Step 3.5 or Step 4.3) drives all retries.

### R0 — Pre-flight

```bash
# 0a's pre-flight already verified clean tree on main.
# Resolve PR_REF -> PR_NUMBER (strip leading '#', or extract from URL).
PR_NUMBER=$(echo "$PR_REF" | sed -E 's|^https?://github\.com/[^/]+/[^/]+/pull/||; s|^#||; s|/.*$||')
gh pr view "$PR_NUMBER" --json number,headRefName,headRefOid,labels,state,isDraft,url > /tmp/pr.json
BRANCH=$(jq -r '.headRefName' /tmp/pr.json)
PR_URL=$(jq -r '.url' /tmp/pr.json)
PR_STATE=$(jq -r '.state' /tmp/pr.json)
HAS_LABEL=$(jq -r '[.labels[].name] | index("iterate-pr") != null' /tmp/pr.json)
```

Refuse to proceed (STOP, no `ITERATE_OUTCOME`) if any of:
- `PR_STATE != "OPEN"` → `[iterate-one-issue --resume-pr] PR #$PR_NUMBER is not open ($PR_STATE).`
- `HAS_LABEL != "true"` → `[iterate-one-issue --resume-pr] PR #$PR_NUMBER lacks the iterate-pr label.`

### R1 — Forward-fix attempt budget

merge-pr-loop tracks per-PR attempts via PR-comment markers — each successful R-pass leaves a `<!-- iterate-forward-fix-attempt -->` comment. Cap at 5:

```bash
ATTEMPTS=$(gh pr view "$PR_NUMBER" --json comments --jq '[.comments[].body | select(contains("<!-- iterate-forward-fix-attempt -->"))] | length')
if [ "$ATTEMPTS" -ge 5 ]; then
  # Emit Done-Blocked — see done-handlers.md
fi
```

If at cap: post a Done-Blocked PR comment (reason `release-gate forward-fix budget exhausted (5 attempts)`), emit `ITERATE_OUTCOME: Done-Blocked issue=n/a branch=$BRANCH pr=$PR_URL`, exit. (No `blocked` label on the source issue from this mode — merge-pr-loop owns that decision.)

### R2 — Check out branch (stateless, remote-authoritative)

Always reset the local branch to `origin/$BRANCH` so a stale local tracking ref or earlier interrupted run cannot poison this pass:

```bash
git fetch origin "$BRANCH"
git checkout -B "$BRANCH" "origin/$BRANCH"
git config rerere.enabled true
git config rerere.autoupdate true
OLD_REMOTE_SHA=$(git rev-parse "origin/$BRANCH")   # captured for SHA-bound --force-with-lease in R7
```

If the remote branch is gone (`git fetch` fails for it): emit `ITERATE_OUTCOME: Done-Blocked issue=n/a branch=$BRANCH pr=$PR_URL` (reason `branch missing or diverged`), exit.

### R3 — Locate the failing release-gate run (or detect rebase-only trigger)

Filter on the **current HEAD SHA** so an older failed run (from a prior commit on this branch that has since been forward-fixed) does not falsely re-trigger forward-fix mode and apply stale logs to the current tree:

```bash
CURRENT_SHA=$(git rev-parse HEAD)
RG_RUN_ID=$(gh run list --workflow=release-gate.yml --branch "$BRANCH" --limit 10 \
  --json databaseId,status,conclusion,headSha,createdAt \
  --jq "[.[] | select(.status == \"completed\" and .conclusion == \"failure\" and .headSha == \"$CURRENT_SHA\")] | sort_by(.createdAt) | reverse | .[0].databaseId // empty")
```

Sub-mode dispatch:

```bash
if [ -n "$RG_RUN_ID" ]; then
  REBASE_ONLY=false
  # Forward-fix sub-mode — fall through to R4.
else
  # No failed gate at the current HEAD. Maybe merge-pr-loop's Step 3.5 invoked us because the branch is behind main.
  git fetch origin main
  BEHIND=$(git rev-list --count "HEAD..origin/main")
  if [ "$BEHIND" -gt 0 ]; then
    REBASE_ONLY=true
    FAIL_LOGS=""
    FAILED_JOBS="rebase-only ($BEHIND commits behind origin/main)"
    # Skip R4 and R6; jump to R5.
  else
    # Nothing for us to do — emit Done-Blocked.
    # ITERATE_OUTCOME: Done-Blocked issue=n/a branch=$BRANCH pr=$PR_URL
    # reason: `no failed release-gate run found for current HEAD and branch is up to date with origin/main`
    # See done-handlers.md.
    exit
  fi
fi
```

### R4 — Pull failed-job logs *(forward-fix sub-mode only)*

Skip entirely when `REBASE_ONLY=true` (no logs to pull).

```bash
FAIL_LOGS=$(gh run view "$RG_RUN_ID" --log-failed | tail -n 200)
FAILED_JOBS=$(gh run view "$RG_RUN_ID" --json jobs --jq '[.jobs[] | select(.conclusion == "failure") | .name] | join(", ")')
```

### R5 — Re-sync against `origin/main` if behind

```bash
git fetch origin main
REBASE_HAPPENED=false
if ! git merge-base --is-ancestor origin/main HEAD; then
  git rebase --strategy=recursive --strategy-option=diff3 origin/main
  REBASE_HAPPENED=true
  # On conflict: reuse Step 1's conflict-resolver loop (per-file `exe-task-implementer` dispatch,
  # `attempt < max_attempts_per_commit=3` per file, `commits_replayed < max_total_commits=20`,
  # `architect-expert` escalation once at max). If still unresolvable:
  #   git rebase --abort
  #   ITERATE_OUTCOME: Done-Blocked reason=`forward-fix rebase against origin/main failed`.
fi
```

In **rebase-only** sub-mode, R5 is the work — the rebase + conflict resolver is the entire job for this pass.

### R6 — Forward-fix *(forward-fix sub-mode only)*

Skip entirely when `REBASE_ONLY=true` (no failed-job logs to act on; the rebase itself was the fix).

Spawn `exe-task-implementer`:
```
Fix Release Gate failures. No revert — forward fix.
PR: <PR_URL>   Branch: <BRANCH>   Failed run: <RG_RUN_ID>
Failed jobs: <FAILED_JOBS>
Logs (truncated, last 200 lines):
<FAIL_LOGS>
Edit on the iterate branch (current tree). Commit nothing — caller commits.
Return Implementation Summary.
```

If the implementer reports no-op (nothing to fix in the failing logs): emit `ITERATE_OUTCOME: Done-Blocked issue=n/a branch=$BRANCH pr=$PR_URL` (reason `forward-fix produced no diff`), exit.

### R7 — Commit + push

`OLD_REMOTE_SHA` was captured at R2 — use it for an explicit SHA-bound `--force-with-lease` so a concurrent `git fetch` in this repo cannot relax the safety check:

```bash
git add -A
if [ "$REBASE_ONLY" = "true" ]; then
  # Rebase-only: nothing to commit, just push the rebased branch.
  # SHA-bound lease — accept the push iff origin/$BRANCH still equals what we observed at R2.
  git push --force-with-lease="$BRANCH:$OLD_REMOTE_SHA" origin "HEAD:refs/heads/$BRANCH"
elif [ "$REBASE_HAPPENED" = "true" ]; then
  # Forward-fix sub-mode after a rebase: commit the fix, then SHA-bound force-push (history was rewritten).
  git commit -m "fix(iter-release): <one-line implementer summary>

<body>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  git push --force-with-lease="$BRANCH:$OLD_REMOTE_SHA" origin "HEAD:refs/heads/$BRANCH"
else
  # Forward-fix sub-mode without rebase: regular fast-forward push.
  git commit -m "fix(iter-release): <one-line implementer summary>

<body>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  git push
fi
NEW_HEAD=$(git rev-parse HEAD)
```

### R8 — Mark attempt + exit

Marker text varies by sub-mode (caller parses by counting markers, not by reading text — text is for humans):

```bash
if [ "$REBASE_ONLY" = "true" ]; then
  gh pr comment "$PR_NUMBER" --body "<!-- iterate-forward-fix-attempt -->
🔧 Release-gate forward-fix attempt $((ATTEMPTS + 1))/5 on commit \`$(git rev-parse --short HEAD)\` (rebase-only — was $BEHIND commit(s) behind origin/main). merge-pr-loop will re-dispatch the gate."
else
  gh pr comment "$PR_NUMBER" --body "<!-- iterate-forward-fix-attempt -->
🔧 Release-gate forward-fix attempt $((ATTEMPTS + 1))/5 on commit \`$(git rev-parse --short HEAD)\` (failed run [<RG_RUN_ID>](https://github.com/dryotta/mdownreview/actions/runs/<RG_RUN_ID>)). merge-pr-loop will re-dispatch the gate."
fi
```

Emit:
```
ITERATE_OUTCOME: Done-ForwardFixed issue=n/a branch=$BRANCH pr=$PR_URL commit=$NEW_HEAD
```

Then exit. Phase 2 is **not** run for this mode — forward-fix passes are too narrow to drive useful self-improvement signal, and the eventual merge-pr-loop merge or Done-Blocked will surface a retro. See [references/done-handlers.md](references/done-handlers.md#done-forwardfixed).

---

## Phase 2 — Improvement-spec synthesis (every terminal path)

Runs first on every terminal Done-X — before banner, before exit. Highest signal value comes from Done-Blocked / Done-TimedOut. Full 2a–2e flow (gate, synthesise, decision, create issue+spec, optional auto-recursion) lives in [references/phase-2.md](references/phase-2.md).

**Phase 2 is skipped for `Done-ForwardFixed`** (the `--resume-pr` outcome) — those passes are too narrow to drive useful improvement signal, and the eventual merge-pr-loop merge or Done-Blocked emits a retro of its own.

## Termination

| Trigger | Path | Phase 2? |
|---|---|---|
| Step 1 abort (rebase) | **Done-Blocked** (skip 2–8.5) | yes |
| Step 2 `achieved` (after Phase 1.5 gate) | **Done-Achieved** (skip 3–8.5) | yes |
| Step 2 `blocked` | **Done-Blocked** (skip 3–8.5) | yes |
| End of Step 8.5 + `iteration+1 > 30` | **Done-TimedOut** | yes |
| Phase R (resume-pr) success | **Done-ForwardFixed** | no |
| Phase R (resume-pr) failure / cap exhausted | **Done-Blocked** | no |

`DEGRADED`/`SKIPPED` do not terminate.

**Phase 1.5 interposes between `Step 2 achieved` and the Done-Achieved handler.** When Phase 1.5's eligibility gate fires, the loop extends by one bounded iteration; when it skips, the Done-Achieved handler runs immediately.

### Done-Achieved · Done-Blocked · Done-TimedOut · Done-ForwardFixed

Each terminal path: post the PR/issue comment, set the label (`blocked` for Done-Blocked / Done-TimedOut from Phase 1; `iterate-pr` + `gh pr ready` for Done-Achieved), print the banner, **exit cleanly with the outcome on stdout**. `iterate-loop` (and `merge-pr-loop`) parse the outcome to chain. Handler scripts: [references/done-handlers.md](references/done-handlers.md).

**Outcome marker (last line printed before exit, machine-parseable for callers):**
```
ITERATE_OUTCOME: <Done-Achieved|Done-Blocked|Done-TimedOut|Done-ForwardFixed> issue=<N|n/a> branch=<BRANCH> pr=<URL> [commit=<sha>]
```

`commit=` is set **only** on `Done-ForwardFixed` — the new HEAD merge-pr-loop should re-dispatch the release gate against.

---

## Halt semantics

See [references/halt-semantics.md](references/halt-semantics.md) for the full enumeration of halt / DEGRADED / SKIPPED / pre-loop-halt triggers.

## Commit conventions

See [references/commit-conventions.md](references/commit-conventions.md) for the per-situation commit-message templates.

## Failure recovery

See [references/failure-recovery.md](references/failure-recovery.md) for the mid-loop interruption checklist (state file, rebase repair, rerere, retro inspection, recursion-marker hygiene, restart policy).

## Non-goals

- **No release-gate dispatch / polling / forward-fix in Phase 1.** When iteration converges to `Done-Achieved`, this skill marks the PR ready-for-review with the `iterate-pr` label and exits. The companion `merge-pr-loop` skill owns release-gate validation and merging.
- **No PR merging.** `Done-Achieved` always leaves the PR ready-for-review. Merging is `merge-pr-loop`'s job (or a human's).
- **No backlog selection.** This skill works on one explicit issue or goal. `iterate-loop` owns backlog drain.
- **No mid-run mode switching.** Choose `--resume-pr` up-front for forward-fix mode; the regular issue/goal mode never enters Phase R.
