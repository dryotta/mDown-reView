---
name: merge-pr-loop
description: Use when the user wants the agent to ship the iterate PR backlog autonomously — phrases like "merge the ready PRs", "ship the iterate PRs", "watch CI on the ready PRs", or an empty `/merge-pr-loop`. Continuous (default) or single-pass (`--once`). Picks the next open ready-for-review PR labelled `iterate-pr`, **rebases stale PR branches onto `origin/main` (clean rebases inline; conflicts delegate to `/iterate-one-issue --resume-pr`)**, waits for the auto-triggered CI run on the PR's HEAD, drives forward-fixes via `/iterate-one-issue --resume-pr <PR>` on failure (cap 5/PR), squash-merges on green. Never prompts. Never writes app source. Pair with `/iterate-loop` in another terminal — that loop produces the PRs this one ships.
---

**RIGID. Fully autonomous — never calls `ask_user`.** Owns the **CI-validation + merge** lifecycle for PRs opened by `iterate-one-issue`. Picks ready-for-review PRs labelled `iterate-pr`, rebases them onto `origin/main` if behind, polls the CI workflow run that the PR's `pull_request` trigger fires, drives forward-fixes when CI fails, squash-merges on green.

Since [PR #376](https://github.com/dryotta/mdownreview/pull/376) merged the standalone `release-gate.yml` into the converged `ci.yml` (with the `CI gate` aggregate gate), this skill no longer dispatches a workflow. CI fires automatically on the PR's `pull_request` event whenever `iterate-one-issue` pushes (initial open, forward-fix commits, rebase force-push). The skill's job is to find that run, poll it to completion, and act on the result.

This skill never writes app source — every code fix is delegated to `/iterate-one-issue --resume-pr <PR>`. The skill *does* perform `git rebase origin/main` + `git push --force-with-lease` on PR branches when they are behind main and the rebase is conflict-free; conflict resolution is also delegated to `/iterate-one-issue --resume-pr` (which has a per-file conflict-resolver loop). A clean rebase rewrites commit metadata only — it never modifies file contents.

---

## Args

| Arg | Mode | Behavior when no eligible PRs |
|---|---|---|
| empty | `continuous` | Poll every 5 min, max 24 h. Then halt. |
| `--once` | `drain-once` | Halt immediately. |

Anything else → STOP `[merge-pr-loop] Unknown arg "<ARG>". Use empty (continuous) or --once.`

---

## Phase 0 — Setup

### 0a. Pre-flight

```bash
git status --porcelain
git branch --show-current
git rev-parse HEAD
```

- Dirty tree → STOP `[merge-pr-loop] Working tree is dirty. Commit or stash first.`
- Not on `main` → `git checkout main && git pull --ff-only`.

**Recursion-marker hygiene** (matches `iterate-one-issue` 0b):
```bash
DEPTH_FILE=".claude/iterate-recursion-depth"
if [ -f "$DEPTH_FILE" ]; then
  AGE=$(( $(date +%s) - $(stat -c %Y "$DEPTH_FILE" 2>/dev/null || stat -f %m "$DEPTH_FILE") ))
  [ "$AGE" -gt 86400 ] && rm -f "$DEPTH_FILE"
fi
```

**Idempotent label bootstrap** (first run on a fresh repo):
```bash
gh label create iterate-pr               --description "PR opened by iterate-one-issue, awaiting CI validation by merge-pr-loop" --color BFD4F2 2>/dev/null || true
gh label create merge-pr-in-progress     --description "PR claimed by merge-pr-loop"                                              --color FBCA04 2>/dev/null || true
gh label create merge-pr-blocked         --description "PR halted by merge-pr-loop — CI fix budget exhausted or unrecoverable"   --color B60205 2>/dev/null || true
```

### 0b. Counters + run tag

```bash
RUN_TAG="merge-loop-$(date -u +%Y%m%dT%H%M%SZ)"
LOOP_DIGEST_DIR=".claude/merge-pr-loop/runs/$RUN_TAG"
mkdir -p "$LOOP_DIGEST_DIR"
LOOP_LOG="$LOOP_DIGEST_DIR/loop.md"
PRS_PROCESSED=0
PRS_MERGED=0
PRS_BLOCKED=0          # CI forward-fix exhausted, or unrecoverable
PRS_FORWARD_FIXED=0    # cumulative count of Done-ForwardFixed passes (across all PRs)
```

Print banner:
```
[merge-pr-loop] Mode: <continuous|drain-once> | Run tag: <RUN_TAG>
Watching open PRs labelled `iterate-pr` (skip: drafts, merge-pr-in-progress, merge-pr-blocked)
```

---

## Phase 1 — Main loop

### Step 1 — Auto-pick

**Selection (one query)** — open, non-draft, labelled `iterate-pr`, not currently claimed by another merge-pr-loop, not blocked. Oldest PR number first:

```bash
PICK=$(gh pr list --state open --label iterate-pr --json number,isDraft,labels --limit 100 \
  | jq '
      [ .[]
        | select(.isDraft == false)
        | select(.labels | map(.name) as $L
          | (index("merge-pr-in-progress") | not)
          and (index("merge-pr-blocked")    | not))
      ]
      | sort_by(.number)
      | .[0].number // empty')
```

**If `PICK` is empty:**

| Mode | Behavior |
|---|---|
| `drain-once` | Jump to **Phase 2 — Retrospective** with reason `no eligible PRs`. |
| `continuous` | **Monitor mode.** `sleep 300`, increment a poll counter (max 288 = 24 h). At each tick re-run the selection query. As soon as `PICK` becomes non-empty, proceed to Step 2. While waiting, log a single line `[merge-pr-loop] monitoring — last check <ISO>, eligible=0` at most once per hour. After 288 polls with no eligible PRs → Phase 2 with reason `monitor budget exhausted (24 h)`. |

### Step 2 — Claim

```bash
gh pr edit $PICK --add-label "merge-pr-in-progress"
```

If the label add fails (race with another agent or label removed mid-flight), log `[merge-pr-loop] failed to claim PR #$PICK — skipping this round` and loop back to Step 1.

Capture PR metadata + per-PR counters (used throughout the round):
```bash
gh pr view "$PICK" --json number,headRefName,headRefOid,url > /tmp/merge-pr-$PICK.json
BRANCH=$(jq -r '.headRefName' /tmp/merge-pr-$PICK.json)
PR_URL=$(jq -r '.url'         /tmp/merge-pr-$PICK.json)
HEAD_SHA=$(jq -r '.headRefOid' /tmp/merge-pr-$PICK.json)
MERGE_RACE_RETRIES=0   # cap=1; bumped each time we re-enter Step 3.5 from a Step 5 race-detect
```

### Step 3 — Pre-flight `main` (re-sync between rounds)

```bash
git checkout main && git pull --ff-only
```

If pull fails (local main diverged from origin), STOP `[merge-pr-loop] main has diverged from origin/main. Resolve manually before resuming.` Release the claim:
```bash
gh pr edit $PICK --remove-label "merge-pr-in-progress"
```

### Step 3.5 — Rebase if behind (proactive)

GitHub branch protection often requires `head branch is up to date with base` before merge. If main moved between PR creation and now, polling CI on the unrebased SHA wastes a ~13 min run only to fail at Step 5. So rebase first — the force-push fires a `synchronize` event on the PR which auto-triggers a fresh CI run on the rebased commit.

```bash
git fetch origin "$BRANCH" main
PR_BEHIND=$(git rev-list --count "origin/$BRANCH..origin/main")
```

If `PR_BEHIND -eq 0`: skip to Step 4.

If `PR_BEHIND -gt 0`: attempt a **clean** rebase inline (no conflict resolver — that's iterate-one-issue's job):

```bash
OLD_REMOTE_SHA=$(git rev-parse "origin/$BRANCH")     # used for SHA-bound --force-with-lease below
git checkout -B "$BRANCH" "origin/$BRANCH"
if git rebase origin/main; then
  # Clean rebase. Push the rebased branch with an explicit SHA-bound lease so a concurrent fetch can't relax the safety check.
  git push --force-with-lease="$BRANCH:$OLD_REMOTE_SHA" origin "HEAD:refs/heads/$BRANCH"
  HEAD_SHA=$(git rev-parse HEAD)
  git checkout main
  gh pr comment "$PICK" --body "<!-- merge-pr-rebased -->
🔄 Rebased onto main (was $PR_BEHIND commit(s) behind). New head: \`$(git rev-parse --short "$HEAD_SHA")\`. Waiting for CI on the rebased commit."
  # Continue to Step 4 with refreshed HEAD_SHA. The push triggered a synchronize event → CI auto-fires.
else
  # Conflict — abort and delegate to iterate-one-issue --resume-pr,
  # which has a per-file conflict-resolver loop (subagents) and pushes the rebased branch on success.
  git rebase --abort 2>/dev/null
  git checkout main

  # Per-PR forward-fix budget applies (same 5/PR cap as Step 4).
  ATTEMPTS=$(gh pr view "$PICK" --json comments --jq '[.comments[].body | select(contains("<!-- iterate-forward-fix-attempt -->"))] | length')
  if [ "$ATTEMPTS" -ge 5 ]; then
    # Step 6 — block, reason `rebase conflict and forward-fix budget exhausted (5 attempts)`.
  fi

  # Spawn `iterate-one-issue --resume-pr "$PICK"` synchronously in the foreground.
  # Detect path: iterate-one-issue's Phase R sees no failed CI run at the current HEAD but a behind branch
  # and runs in rebase-only mode — R5 rebase + conflict resolver, R7 SHA-bound force-push, R8 marker,
  # exit Done-ForwardFixed. Phase R always rebases against the freshest origin/main visible at R5,
  # so a race between this abort and R5 is benign.
  # Routing mirrors Step 4.3:
  # - Done-ForwardFixed commit=<sha>: refresh HEAD_SHA, PRS_FORWARD_FIXED += 1, continue to Step 4.
  # - Done-Blocked: Step 6 — block (reason from inner skill, e.g. `forward-fix rebase against origin/main failed`).
  # - Other / parse failure: Step 6 — block, reason `unrecognised outcome from iterate-one-issue --resume-pr (rebase-only)`.
fi
```

Detailed routing of the inner-skill outcome marker is identical to Step 4.3 — see [references/ci-gate.md](references/ci-gate.md).

### Step 4 — CI poll + forward-fix loop

Per-PR forward-fix attempt budget: **5**. Tracked via PR-comment markers (`<!-- iterate-forward-fix-attempt -->`) — survives orchestrator restarts. The loop body in this step may iterate up to 5 times for a single PR; each iteration is one CI poll + (on fail) one forward-fix pass.

CI is **not** dispatched by this skill — the PR's `pull_request` trigger fires CI automatically whenever the branch is updated (initial open, rebase force-push, forward-fix push). This step's job is to find that run for the current `HEAD_SHA`, poll it, and route on the result.

Detailed flow: [references/ci-gate.md](references/ci-gate.md). High level:

1. **Locate** the CI run for the current `HEAD_SHA` (waiting briefly if it hasn't registered yet).
2. **Poll** the run synchronously (foreground `general-purpose` subagent, max 30 min).
3. On **PASS** → break out of the loop, jump to Step 5 (merge).
4. On **FAIL** → check attempt count. If `>= 5` → halt this PR (Step 6 — block). Otherwise spawn `iterate-one-issue --resume-pr $PICK` synchronously in the foreground:
   - `Done-ForwardFixed commit=<sha>` → re-checkout main, refresh `$HEAD_SHA = <sha>`, loop back to (1) — the inner skill's push triggered a fresh CI run. `PRS_FORWARD_FIXED += 1`.
   - `Done-Blocked` → halt this PR (Step 6 — block, with reason from inner skill).
5. On **CI never registered** (PR pushed but no run appeared after the 5 min discovery budget) → halt this PR (Step 6 — block, reason `CI workflow did not register a run for HEAD_SHA — check workflow file or trigger filters`).

### Step 5 — Merge (PASS path)

When the CI run completes with `conclusion=success`:

0. **Pre-merge race check** — main may have moved while the ~13 min CI run was running. If the PR is now behind, the squash-merge will fail with `head branch is not up to date`:
   ```bash
   git fetch origin "$BRANCH" main
   PR_BEHIND_NOW=$(git rev-list --count "origin/$BRANCH..origin/main")
   ```
   - `PR_BEHIND_NOW -eq 0`: branch is current, proceed to step 1 below.
   - `PR_BEHIND_NOW -gt 0` and `MERGE_RACE_RETRIES -lt 1`:
     ```bash
     MERGE_RACE_RETRIES=$((MERGE_RACE_RETRIES + 1))
     gh pr comment "$PICK" --body "<!-- merge-pr-race-retry -->
     ⚠️ Main moved during the CI run. Rebasing + waiting for CI on the rebased commit ($MERGE_RACE_RETRIES/1)."
     ```
     Loop back to **Step 3.5** (rebase + wait for the auto-triggered CI run on the rebased commit + re-poll). The rebase counter is independent of the forward-fix budget — race-retries don't write `<!-- iterate-forward-fix-attempt -->` markers unless a conflict triggers iterate-one-issue.
   - `PR_BEHIND_NOW -gt 0` and `MERGE_RACE_RETRIES -ge 1`: halt this PR (Step 6 — block, reason `main moved during CI run; merge race retries exhausted (1)`).

1. **Refresh PR body** — preserve `Closes #<N>` trailer; replace summary with `Ready to merge — CI passed.`:
   ```bash
   gh pr edit "$PICK" --body "<refreshed body>"
   ```
2. **Comment** with the CI run URL:
   ```bash
   gh pr comment "$PICK" --body "<!-- merge-pr-ci-passed -->
   🟢 CI passed on commit \`$(git rev-parse --short "$HEAD_SHA")\` (run [<CI_RUN_ID>](https://github.com/dryotta/mdownreview/actions/runs/<CI_RUN_ID>)). Squash-merging."
   ```
3. **Squash-merge**:
   ```bash
   gh pr merge "$PICK" --squash --delete-branch
   MERGE_EXIT=$?
   ```
   On non-zero exit:
   - **If `MERGE_RACE_RETRIES -lt 1`**: a third-party race likely landed a commit on main between Step 5.0's check and `gh pr merge` (or branch-protection produced an "out of date" error Step 5.0 missed). Increment `MERGE_RACE_RETRIES`, comment, and **loop back to Step 3.5** — Step 5.0 on the retry will confirm the actual state.
     ```bash
     MERGE_RACE_RETRIES=$((MERGE_RACE_RETRIES + 1))
     gh pr comment "$PICK" --body "<!-- merge-pr-race-retry -->
     ⚠️ \`gh pr merge\` failed (third-party race after Step 5.0 check). Rebasing + waiting for CI ($MERGE_RACE_RETRIES/1)."
     ```
   - **If `MERGE_RACE_RETRIES -ge 1`**: log + halt this PR (Step 6 — block, reason `gh pr merge failed: <stderr first line>`). Do **not** retry mid-loop.
4. **Cleanup labels** (defensive — branch deletion already cascaded most state):
   ```bash
   gh pr edit "$PICK" --remove-label "merge-pr-in-progress" 2>/dev/null || true
   gh pr edit "$PICK" --remove-label "iterate-pr"           2>/dev/null || true
   ```
5. `PRS_MERGED += 1`. Tally + log per Step 7. Continue to Step 8.

### Step 6 — Block (FAIL path)

When the per-PR forward-fix budget is exhausted, the inner skill returns `Done-Blocked`, or any unrecoverable error halts the PR:

1. **Comment** with the failure summary:
   ```bash
   gh pr comment "$PICK" --body "<!-- merge-pr-blocked -->
   ⛔ merge-pr-loop halted PR ready check
   **Reason:** <reason>
   **Last CI run:** <CI_RUN_ID> (<conclusion>)
   **Forward-fix attempts:** <K>/5
   Resolve manually, then remove the \`merge-pr-blocked\` label so subsequent /merge-pr-loop runs pick it up again."
   ```
2. **Replace claim with block label** (so this PR is excluded from future Step 1 picks until a human un-blocks):
   ```bash
   gh pr edit "$PICK" --add-label    "merge-pr-blocked"
   gh pr edit "$PICK" --remove-label "merge-pr-in-progress"
   ```
3. `PRS_BLOCKED += 1`. Tally + log per Step 7. Continue to Step 8.

### Step 7 — Tally + per-PR log

Append one row to `$LOOP_LOG`:

```markdown
## PR <PRS_PROCESSED+1> — #<PICK>
- Started: <ISO>   Finished: <ISO>   Duration: <h:mm>
- Branch: <BRANCH>   PR: <URL>
- Outcome: <Merged | Blocked>
- CI runs: <list of CI_RUN_ID>
- Forward-fix attempts: <K>/5
- Final commit: <sha>
- Block reason: <reason | n/a>
```

`PRS_PROCESSED += 1`.

### Step 8 — Loop guard + continue

| Condition | Action |
|---|---|
| `PRS_PROCESSED >= 50` | Phase 2 with reason `PR cap reached (50 PRs processed in one loop run)` |
| Else | Loop back to Step 1 |

The 50-PR cap exists so a runaway loop doesn't process the entire backlog without a human checkpoint.

---

## Phase 2 — Post-loop retrospective + self-improvement issue

Runs once when the loop exits for any reason (drain-once empty / monitor timeout / 50-PR cap / hard halt). Follow the unified retrospective contract: [`.claude/shared/retrospective.md`](../../shared/retrospective.md). Skill-specific bindings:

- `SKILL_TAG=merge-pr-loop`
- `RUN_TAG` from 0b (`merge-loop-<ISO-ts>`)
- `OUTCOME=PASSED` if `PRS_MERGED >= 1` and `PRS_BLOCKED == 0`; `DEGRADED` if mixed; `BLOCKED` if pre-flight halted before any PRs ran.
- `RETRO_FILE=".claude/retrospectives/merge-pr-loop-$RUN_TAG.md"` AND mirror to `$LOOP_DIGEST_DIR/retrospective.md` for in-run inspection.

Source material for R1: `$LOOP_LOG` (per-PR summary), the failed-job log excerpts captured during forward-fix waves, and any halt reason from Steps 1/3/8.

Improvement candidates here typically target **the orchestrator itself** or systemic CI flakes — examples:
- A whole class of CI failures kept needing the same forward-fix → propose CI hardening or a `documentation-expert` follow-up to capture the pattern.
- Forward-fix budget too low / too high for healthy PR throughput.
- CI runs taking longer than the merge-race window allows → propose perf work in `tauri-build-expert` / `github-actions-expert` territory.
- `iterate-one-issue` keeps producing PRs that fail CI the same way → file an `iterate-improvement` against `iterate-one-issue`.

Run R1 then R2 per the shared spec. Created issues carry `iterate-improvement` + `self-improve:merge-pr-loop` and feed the next `/iterate-loop` run automatically.

End with the shared banner so logs are greppable:
```
🔁 Self-improve: <NEW_ISSUE_URL> (<category>)   # or "reproduced #N", "NO_IMPROVEMENT_FOUND", "skipped"
```

Then print the loop summary:
```
[merge-pr-loop] Run complete — RUN_TAG=<…>
PRs processed: <N>
  ✅ Merged:  <PRS_MERGED>
  ⛔ Blocked: <PRS_BLOCKED>
  🔧 Forward-fix passes (cumulative): <PRS_FORWARD_FIXED>
Halt reason: <…>
Loop digest: $LOOP_DIGEST_DIR/loop.md
Retrospective: $RETRO_FILE
```

---

## Halt conditions

**Hard halts (Phase 2 still runs):**
- Dirty tree at 0a.
- `main` cannot fast-forward at Step 3.
- 50 PRs processed (PR cap).
- 24 h monitor budget exhausted with zero eligible PRs (continuous mode).
- No eligible PRs at Step 1 (drain-once mode).

**Per-PR soft skips / blocks (loop continues):**
- Claim label add fails at Step 2 (race — log + skip).
- Step 3.5 rebase conflict + forward-fix budget exhausted (5/5) → block this PR, continue.
- Step 3.5 `iterate-one-issue --resume-pr` returns `Done-Blocked` (e.g. `forward-fix rebase against origin/main failed`) → block this PR with the inner reason, continue.
- CI did not register a run for the current HEAD_SHA after the discovery budget (Step 4) → block this PR, continue.
- Forward-fix budget exhausted (Step 4) → block this PR, continue.
- Step 5 merge race retries exhausted (`MERGE_RACE_RETRIES >= 1`) → block this PR, continue.
- `gh pr merge` fails (Step 5) → block this PR, continue.
- Inner `iterate-one-issue --resume-pr` returns `Done-Blocked` → block this PR with the inner reason, continue.

**No retry of failed claims or merges.** A claim collision means another `merge-pr-loop` (parallel session or manual) already owns the PR. Skipping is correct.

---

## Multi-terminal dogfood mode (recommended)

Each loop's inner agent runs synchronously in the foreground of its own terminal — output is always visible.

- **Terminal A — `/iterate-loop`**: drains the issue backlog, opens ready-for-review PRs labelled `iterate-pr`.
- **Terminal B — `/merge-pr-loop`**: this skill — polls CI on those PRs and ships them when green.
- **Terminal C — `/test-exploratory-loop`** (optional, Windows-only): dogfoods the live binary, files new bugs.

Each loop re-syncs to `origin/main` between rounds. The full pipeline is: bug → issue → fix → PR → CI → merge — autonomously.

---

## Outputs

- `$LOOP_DIGEST_DIR/loop.md` — per-PR digest (one row per PR processed)
- `$LOOP_DIGEST_DIR/retrospective.md` — in-run mirror of post-loop retro
- `.claude/retrospectives/merge-pr-loop-$RUN_TAG.md` — canonical retro location
- One self-improvement issue (if R2 found a candidate), labelled `iterate-improvement` + `self-improve:merge-pr-loop`

## Non-goals

- This skill never opens issues, never opens PRs, and never modifies app source. Forward-fixes (including rebase-conflict resolution) are delegated to `iterate-one-issue --resume-pr <PR>`. Inline rebases (Step 3.5 clean path) rewrite commit metadata only — file contents are unchanged.
- This skill never picks issues from the backlog (that's `iterate-loop`'s job).
- This skill never enables GitHub's `--auto` merge queue (would require repo-level "Allow auto-merge" setting). It polls + merges directly so it works on any repo the agent can push to and merge on.
- This skill never bypasses CI. Every merged PR was validated against the converged `ci.yml` (windows-x64 + windows-arm64 + macos-arm64 builds + tests + native-e2e + bundle integrity) on the exact commit it merged. (Step 5.0's race-retry waits for a fresh CI run on the rebased commit — it does not skip validation.)
- This skill never **dispatches** CI (workflow file no longer accepts `workflow_dispatch`). The PR's `pull_request` trigger is the only path; rebases and forward-fixes push to the branch, which fires the trigger automatically.
