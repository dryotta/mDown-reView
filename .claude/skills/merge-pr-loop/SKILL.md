---
name: merge-pr-loop
description: Use when the user wants the agent to ship the iterate PR backlog autonomously — phrases like "merge the ready PRs", "ship the iterate PRs", "run the release gate on everything ready", or an empty `/merge-pr-loop`. Continuous (default) or single-pass (`--once`). Picks the next open ready-for-review PR labelled `iterate-pr`, dispatches the Release Gate, polls to completion, drives forward-fixes via `/iterate-one-issue --resume-pr <PR>` on failure (cap 5/PR), squash-merges on green. Never prompts. Never writes app source. Pair with `/iterate-loop` in another terminal — that loop produces the PRs this one ships.
---

**RIGID. Fully autonomous — never calls `ask_user`.** Owns the **release-gate + merge** lifecycle for PRs opened by `iterate-one-issue`. Picks ready-for-review PRs labelled `iterate-pr`, validates each via the signed-installer Release Gate, drives forward-fixes when the gate fails, squash-merges on green.

This skill never writes app source — every fix is delegated to `/iterate-one-issue --resume-pr <PR>`.

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
gh label create iterate-pr               --description "PR opened by iterate-one-issue, awaiting release-gate validation by merge-pr-loop" --color BFD4F2 2>/dev/null || true
gh label create merge-pr-in-progress     --description "PR claimed by merge-pr-loop"                                                          --color FBCA04 2>/dev/null || true
gh label create merge-pr-blocked         --description "PR halted by merge-pr-loop — release-gate fix budget exhausted or unrecoverable"     --color B60205 2>/dev/null || true
```

### 0b. Counters + run tag

```bash
RUN_TAG="merge-loop-$(date -u +%Y%m%dT%H%M%SZ)"
LOOP_DIGEST_DIR=".claude/merge-pr-loop/runs/$RUN_TAG"
mkdir -p "$LOOP_DIGEST_DIR"
LOOP_LOG="$LOOP_DIGEST_DIR/loop.md"
PRS_PROCESSED=0
PRS_MERGED=0
PRS_BLOCKED=0          # release-gate forward-fix exhausted, or unrecoverable
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

Capture PR metadata (used throughout the round):
```bash
gh pr view "$PICK" --json number,headRefName,headRefOid,url > /tmp/merge-pr-$PICK.json
BRANCH=$(jq -r '.headRefName' /tmp/merge-pr-$PICK.json)
PR_URL=$(jq -r '.url'         /tmp/merge-pr-$PICK.json)
HEAD_SHA=$(jq -r '.headRefOid' /tmp/merge-pr-$PICK.json)
```

### Step 3 — Pre-flight `main` (re-sync between rounds)

```bash
git checkout main && git pull --ff-only
```

If pull fails (local main diverged from origin), STOP `[merge-pr-loop] main has diverged from origin/main. Resolve manually before resuming.` Release the claim:
```bash
gh pr edit $PICK --remove-label "merge-pr-in-progress"
```

### Step 4 — Release-gate + forward-fix loop

Per-PR forward-fix attempt budget: **5**. Tracked via PR-comment markers (`<!-- iterate-forward-fix-attempt -->`) — survives orchestrator restarts. The loop body in this step may iterate up to 5 times for a single PR; each iteration is one dispatch + poll + (on fail) one forward-fix pass.

Detailed flow: [references/release-gate.md](references/release-gate.md). High level:

1. **Dispatch** `release-gate.yml` against `$BRANCH` (workflow_dispatch, with disambiguation).
2. **Poll** the run synchronously (foreground `general-purpose` subagent, max 60 min).
3. On **PASS** → break out of the loop, jump to Step 5 (merge).
4. On **FAIL** → check attempt count. If `>= 5` → halt this PR (Step 6 — block). Otherwise spawn `iterate-one-issue --resume-pr $PICK` synchronously in the foreground:
   - `Done-ForwardFixed commit=<sha>` → re-checkout main, refresh `$HEAD_SHA = <sha>`, loop back to (1) — re-dispatch on the new commit. `PRS_FORWARD_FIXED += 1`.
   - `Done-Blocked` → halt this PR (Step 6 — block, with reason from inner skill).
5. On **dispatch failure** (workflow file missing, gh auth expired) → halt this PR (Step 6 — block, reason `release-gate dispatch failed`).

### Step 5 — Merge (PASS path)

When the release-gate run completes with `conclusion=success`:

1. **Refresh PR body** — preserve `Closes #<N>` trailer; replace summary with `Ready to merge — release gate passed.`:
   ```bash
   gh pr edit "$PICK" --body "<refreshed body>"
   ```
2. **Comment** with the gate run URL:
   ```bash
   gh pr comment "$PICK" --body "<!-- merge-pr-release-gate-passed -->
   🟢 Release gate passed on commit \`$(git rev-parse --short "$HEAD_SHA")\` (run [<RG_RUN_ID>](https://github.com/dryotta/mdownreview/actions/runs/<RG_RUN_ID>)). Squash-merging."
   ```
3. **Squash-merge**:
   ```bash
   gh pr merge "$PICK" --squash --delete-branch
   ```
   On non-zero exit (race, branch-protection regressed): log + halt this PR (Step 6 — block, reason `gh pr merge failed: <stderr first line>`). Do **not** retry mid-loop.
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
   **Last release-gate run:** <RG_RUN_ID> (<conclusion>)
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
- Release-gate runs: <list of RG_RUN_ID>
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

Improvement candidates here typically target **the orchestrator itself** or systemic release-gate flakes — examples:
- A whole class of release-gate failures kept needing the same forward-fix → propose CI hardening or a `documentation-expert` follow-up to capture the pattern.
- Forward-fix budget too low / too high for healthy PR throughput.
- Release-gate dispatch races with another agent → propose a stronger lock.
- `iterate-one-issue` keeps producing PRs that fail the gate the same way → file an `iterate-improvement` against `iterate-one-issue`.

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
- Release-gate dispatch fails (Step 4) → block this PR, continue.
- Forward-fix budget exhausted (Step 4) → block this PR, continue.
- `gh pr merge` fails (Step 5) → block this PR, continue.
- Inner `iterate-one-issue --resume-pr` returns `Done-Blocked` → block this PR with the inner reason, continue.

**No retry of failed claims or merges.** A claim collision means another `merge-pr-loop` (parallel session or manual) already owns the PR. Skipping is correct.

---

## Multi-terminal dogfood mode (recommended)

Each loop's inner agent runs synchronously in the foreground of its own terminal — output is always visible.

- **Terminal A — `/iterate-loop`**: drains the issue backlog, opens ready-for-review PRs labelled `iterate-pr`.
- **Terminal B — `/merge-pr-loop`**: this skill — gates and ships those PRs.
- **Terminal C — `/test-exploratory-loop`** (optional, Windows-only): dogfoods the live binary, files new bugs.

Each loop re-syncs to `origin/main` between rounds. The full pipeline is: bug → issue → fix → PR → release-gate → merge — autonomously.

---

## Outputs

- `$LOOP_DIGEST_DIR/loop.md` — per-PR digest (one row per PR processed)
- `$LOOP_DIGEST_DIR/retrospective.md` — in-run mirror of post-loop retro
- `.claude/retrospectives/merge-pr-loop-$RUN_TAG.md` — canonical retro location
- One self-improvement issue (if R2 found a candidate), labelled `iterate-improvement` + `self-improve:merge-pr-loop`

## Non-goals

- This skill never opens issues, never opens PRs, and never modifies app source. Forward-fixes are delegated to `iterate-one-issue --resume-pr <PR>`.
- This skill never picks issues from the backlog (that's `iterate-loop`'s job).
- This skill never enables GitHub's `--auto` merge queue (would require repo-level "Allow auto-merge" setting). It polls + merges directly so it works on any repo the agent can push to and merge on.
- This skill never bypasses the release gate. Every merged PR was validated against the signed-installer build on the exact commit it merged.
