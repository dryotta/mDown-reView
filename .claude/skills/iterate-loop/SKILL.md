---
name: iterate-loop
description: Use when the user wants to drain the GitHub issue backlog autonomously — phrases like "drain the backlog", "work through the issues", "auto-fix open issues", or just empty `/iterate-loop`. Continuous orchestrator that picks the next eligible issue, dispatches `iterate-one-issue` against it, and loops. Default is continuous (drain + monitor); `--once` drains once and exits. PRs are left ready-for-review by default; pass `--auto-merge` to squash-merge each Done-Achieved PR automatically. Never prompts. Pair with `test-exploratory-loop` running in another terminal for the full self-improvement dogfood.
---

**RIGID. Fully autonomous — never calls `ask_user`.** This skill is the **outer orchestrator** for the issue-fix loop. It picks the next eligible issue from the GitHub backlog, claims it (`iterate-in-progress` label), invokes `iterate-one-issue` against it, releases the claim, and repeats. When the backlog drains, it either exits (`--once`) or polls indefinitely waiting for new issues (default).

For single-issue or freeform-goal work, the user invokes `iterate-one-issue` directly — this skill is **only** for the backlog-drain pattern.

---

## Args

Args are parsed positionally; flags may be combined freely.

| Arg | Mode | Behavior when backlog empty |
|---|---|---|
| empty | `continuous` | Poll backlog every 5 min, max 24 h. Then halt. |
| `--once` | `drain-once` | Halt immediately. |
| `--resume` | `resume` | Reconstruct the active set from on-disk state and continue. See [Phase 3 — Resume after interruption](#phase-3--resume-after-interruption). |

| Flag | Effect |
|---|---|
| (none) | **Default.** PRs from each round are left in the `ready-for-review` state set by `iterate-one-issue` — a human merges. |
| `--auto-merge` | After every `Done-Achieved` round, poll the PR's required checks until they finish, then squash-merge directly via `gh pr merge --squash --delete-branch`. Does **not** use GitHub's `--auto` queueing feature (which requires the repo-level "Allow auto-merge" setting). Done-Blocked / Done-TimedOut PRs are never touched. |
| `--pipeline` | **Opt-in pipelined scheduler.** While the active iterate round is running, the previous round's release-gate workflow is allowed to run concurrently on GitHub. Active set capped at 2 entries (1 active + 1 RG-pending). Each active round runs in its own `git worktree`. Scheduler probes RG completion at defined yield points (Step 6c poller, between rounds, on inner-skill exit) and re-enters `iterate-one-issue --resume-rg <branch>` to finish 9b–d. Full spec: [references/pipeline.md](references/pipeline.md). When omitted, the loop's behaviour is byte-for-byte identical to non-pipelined mode. |

Anything else → STOP `[iterate-loop] Unknown arg "<ARG>". Use empty (continuous), --once, or --resume, optionally with --auto-merge and/or --pipeline.`

Set the following from arg parsing; defaults all `false`:
- `AUTO_MERGE=true|false`
- `PIPELINE=true|false`
- `RESUME=true|false` (mutually compatible with `PIPELINE`; `RESUME=true` implies `PIPELINE=true`)

---

## Phase 0 — Setup

### 0a. Pre-flight

```bash
git status --porcelain
git branch --show-current
git rev-parse HEAD
```

- Dirty tree → STOP `[iterate-loop] Working tree is dirty. Commit or stash first.`
- Not on `main` → `git checkout main && git pull --ff-only`.

**Recursion-marker hygiene** (matches inner skill 0b):
```bash
DEPTH_FILE=".claude/iterate-recursion-depth"
if [ -f "$DEPTH_FILE" ]; then
  AGE=$(( $(date +%s) - $(stat -c %Y "$DEPTH_FILE" 2>/dev/null || stat -f %m "$DEPTH_FILE") ))
  [ "$AGE" -gt 86400 ] && rm -f "$DEPTH_FILE"
fi
```

### 0b. Counters + run tag

```bash
RUN_TAG="loop-$(date -u +%Y%m%dT%H%M%SZ)"
LOOP_DIGEST_DIR=".claude/iterate-loop/runs/$RUN_TAG"
mkdir -p "$LOOP_DIGEST_DIR"
LOOP_LOG="$LOOP_DIGEST_DIR/loop.md"
SCHEDULER_FILE="$LOOP_DIGEST_DIR/scheduler.json"   # pipelined mode only
ROUNDS_PROCESSED=0
ROUNDS_DONE_ACHIEVED=0
ROUNDS_DONE_BLOCKED=0
ROUNDS_DONE_TIMED_OUT=0
ROUNDS_DEFERRED=0   # iterate-one-issue exited via 0d (needs-grooming)
ROUNDS_OVERLAPPED=0 # pipelined: rounds whose active+rg-pending overlapped on the wall clock
ROUNDS_FELLBACK=0   # pipelined: rounds that fell back to sequential (worktree create failed)
```

Print banner:
```
[iterate-loop] Mode: <continuous|drain-once|resume> | Auto-merge: <on|off> | Pipeline: <on|off> | Run tag: <RUN_TAG>
Watching backlog (skip: needs-grooming, blocked, iterate-in-progress)
```

`ROUNDS_AUTO_MERGED=0` (only incremented when `AUTO_MERGE=true` and merge enqueues successfully).

When `PIPELINE=true`, initialise scheduler state per [references/pipeline.md § Scheduler state](references/pipeline.md#scheduler-state) and write `$SCHEDULER_FILE`. When `RESUME=true`, **skip Phase 0b counter init** and jump to [Phase 3 — Resume after interruption](#phase-3--resume-after-interruption) instead — Phase 3 reconstructs counters and the scheduler from disk.

---

## Phase 1 — Main loop

### Step 1 — Auto-pick

**Skip filter** — never pick issues with these labels:
- `needs-grooming` (open clarification questions outstanding)
- `blocked` (previous Done-Blocked outcome — needs human attention)
- `iterate-in-progress` (another iterate-one-issue run owns it)

**Selection (one query)** — prefers `groomed` issues; within each tier, oldest-first:

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

**If `PICK` is empty (backlog drained):**

| Mode | Behavior |
|---|---|
| `drain-once` | Jump to **Phase 2 — Retrospective** with reason `backlog drained`. |
| `continuous` | **Monitor mode.** `sleep 300`, increment a poll counter (max 288 = 24 h). At each tick re-run the selection query. As soon as `PICK` becomes non-empty, proceed to Step 2. While waiting, log a single line `[iterate-loop] monitoring backlog — last check <ISO>, eligible=0` at most once per hour. After 288 polls with no eligible issues → Phase 2 with reason `monitor budget exhausted (24 h)`. |

### Step 2 — Claim

```bash
gh issue edit $PICK --add-label "iterate-in-progress"
```

If the label add fails (race with another agent or label removed mid-flight), log `[iterate-loop] failed to claim #$PICK — skipping this round` and loop back to Step 1.

### Step 3 — Pre-flight `main` (re-sync between rounds)

```bash
git checkout main && git pull --ff-only
```

If pull fails (local main diverged from origin), STOP `[iterate-loop] main has diverged from origin/main. Resolve manually before resuming.` Release the claim:
```bash
gh issue edit $PICK --remove-label "iterate-in-progress"
```

### Step 4 — Dispatch `iterate-one-issue`

**Sequential mode (`PIPELINE=false`).** Invoke `iterate-one-issue $PICK` from the main worktree (cwd unchanged). Capture full final stdout into `INNER_OUTPUT`.

**Pipelined mode (`PIPELINE=true`).** Before invoking the inner skill:

1. Create a fresh worktree for this round per [references/pipeline.md § Worktree lifecycle](references/pipeline.md#worktree-lifecycle):
   ```bash
   WT_ROOT="${ITERATE_WORKTREE_ROOT:-$(dirname "$(git rev-parse --show-toplevel)")}"
   WT_PATH="$WT_ROOT/mdrev-pick-$PICK"
   git worktree add "$WT_PATH" main
   ```
   On failure (disk full, path collision): log `[iterate-loop] worktree create failed for #$PICK — falling back to sequential for this round`, set `ROUNDS_FELLBACK += 1`, and dispatch this one round in the main worktree without `ITERATE_PIPELINE_AWARE`. Continue with subsequent rounds still pipelined. (See [halt conditions table](#halt-conditions).)

2. Record the new active entry in scheduler state:
   ```json
   "active": { "issue": <PICK>, "branch": "<computed-by-inner>", "worktree": "<WT_PATH>", "started_at": "<ISO>" }
   ```
   `branch` is unknown until the inner skill computes it in 0e; backfill from the `ITERATE_OUTCOME` marker after Step 5.

3. Invoke `iterate-one-issue $PICK` with `cwd=$WT_PATH` and `ITERATE_PIPELINE_AWARE=1` exported. The inner skill's Step 9a.4 sees the env var and returns `Done-Achieved-RG-Pending` instead of running 9b–d synchronously.

The inner skill's last stdout line is the **outcome marker** (parse with regex; missing optional fields are absent, not "n/a"):
```
ITERATE_OUTCOME: <Done-Achieved|Done-Achieved-RG-Pending|Done-Blocked|Done-TimedOut> issue=<N|n/a> branch=<BRANCH> pr=<URL> [worktree=<path>] [rg_run=<ID>]
```

`worktree=` and `rg_run=` are present **only** on `Done-Achieved-RG-Pending`. **Or** (rare) the inner skill defers via 0d (`needs-grooming`) and exits without printing `ITERATE_OUTCOME`; its banner ends `[iterate-one-issue] Issue #<N> deferred to grooming.`

Wait for the inner skill to return. Capture full final stdout into `INNER_OUTPUT`.

### Step 5 — Release the claim & route the outcome

Whatever the outcome, the `iterate-in-progress` label must come off so future sweeps see the issue clearly. The inner skill's Done-X handlers DO add `blocked` (Done-Blocked) or leave it alone (Done-Achieved → closure on PR merge), so this skill only owns the claim label:

```bash
gh issue edit $PICK --remove-label "iterate-in-progress" 2>/dev/null || true
```

**Outcome routing** (parse `ITERATE_OUTCOME` from `INNER_OUTPUT`):

| Outcome | Sequential mode | Pipelined mode |
|---|---|---|
| `Done-Achieved` | Tally + Step 5b auto-merge + Step 6 log + Step 7. | Tear down `active.worktree` (`git worktree remove --force`). Tally + 5b + 6 + 7. |
| `Done-Achieved-RG-Pending` | **N/A** — inner skill never emits this without `ITERATE_PIPELINE_AWARE=1`. If seen, treat as a contract violation and STOP. | **Move** the active entry into `rg_pending` (capture `worktree=`, `rg_run=`). Do NOT tear down the worktree. Skip 5b (auto-merge waits until 9b–d completes). Tally as a "dispatched" intermediate, then proceed to Step 6 (log Mode/Worktree) and Step 7 (loop guard) — the round is **complete from the active slot's perspective**. |
| `Done-Blocked` / `Done-TimedOut` | Tally + 6 + 7. | Tear down `active.worktree`. Tally + 6 + 7. |
| `Deferred-Grooming` (no marker emitted) | Tally + 6 + 7. | Tear down `active.worktree`. Tally + 6 + 7. |

After Step 5 completes for a `Done-Achieved-RG-Pending` round, the loop now has both an empty active slot AND an `rg_pending` entry — Step 1 of the next round may claim a new issue immediately. See [references/pipeline.md § Yield points](references/pipeline.md#yield-points) for when the scheduler probes the `rg_pending` entry.

### Step 5b — Auto-merge (only when `AUTO_MERGE=true`)

**Skip unless all of these hold:**
- `AUTO_MERGE=true`
- `ITERATE_OUTCOME=Done-Achieved`
- A PR URL was captured from `INNER_OUTPUT`

Then:

1. **Poll required checks** (max 60 polls × 60 s = 60 min budget per PR):

   ```bash
   for i in $(seq 1 60); do
     gh pr checks "$PR_URL" --required
     STATUS=$?
     # gh pr checks exit codes:
     #   0  = all required checks succeeded
     #   8  = some required checks still pending / queued
     #   1+ = at least one required check failed (or no required checks configured)
     case $STATUS in
       0) break ;;
       8) sleep 60 ;;
       *) break ;;
     esac
   done
   ```

   Edge case: if `--required` reports "no required checks", fall back to `gh pr checks "$PR_URL"` (all checks, not just required) once and treat its exit 0 as green.

2. **If checks ended green** (exit 0), squash-merge directly:

   ```bash
   gh pr merge "$PR_URL" --squash --delete-branch
   ```

   On success: `ROUNDS_AUTO_MERGED += 1`. The next round's `git pull --ff-only` at Step 3 picks up the merged commit.

3. **If checks failed, polled out (60 min), or `gh pr merge` exits non-zero**, log `[iterate-loop] auto-merge skipped for #$PICK ($PR_URL): <reason>` and continue. Do **not** halt the loop and do **not** retry — the PR remains ready-for-review for human handling. `ROUNDS_AUTO_MERGE_FAILED += 1`.

This skill never uses `gh pr merge --auto` — that requires the repository-level "Allow auto-merge" setting, which is not assumed to be enabled. Polling + direct merge keeps `--auto-merge` working on any repository the agent can push to and merge on.

### Step 6 — Tally + per-round log

Parse `INNER_OUTPUT`. Append one row to `$LOOP_LOG`:

```markdown
## Round <ROUNDS_PROCESSED+1> — Issue #<PICK>
- Started: <ISO>   Finished: <ISO>   Duration: <h:mm>
- Mode: <sequential | pipelined | pipelined-fellback>
- Worktree: <absolute path | main>
- Outcome: <Done-Achieved | Done-Achieved-RG-Pending | Done-Blocked | Done-TimedOut | Deferred-Grooming>
- Branch: <BRANCH>   PR: <URL or n/a>
- Auto-merge: <merged | skipped: <reason> | n/a (Done-Blocked|TimedOut|Deferred|RG-Pending) | off>
- Phase 2 (inner): <improvement issue URL | NO_IMPROVEMENT_FOUND | skipped | deferred (RG-pending)>
```

Increment the matching `ROUNDS_*` counter. `ROUNDS_PROCESSED += 1`. For pipelined rounds where an `rg_pending` entry was active concurrently with this round's active work, also `ROUNDS_OVERLAPPED += 1`.

For `Done-Achieved-RG-Pending`, the eventual `Done-Achieved` or `Done-Blocked` from 9b–d-resume produces a **separate** log entry under the same `Round <N>` heading via [references/pipeline.md § Resume bookkeeping](references/pipeline.md#resume-bookkeeping) — do not double-count.

### Step 6.5 — Yield-point probe (pipelined mode only)

If `PIPELINE=true` AND `rg_pending != null`, run a non-blocking probe of the RG run **before** looping to Step 1:

```bash
gh run view "$RG_RUN_ID" --json status,conclusion --jq '{status,conclusion}'
```

If `status` is `completed`, drive the resume flow per [references/pipeline.md § RG-completion handling](references/pipeline.md#rg-completion-handling): `cd $RG_PENDING_WORKTREE`, invoke `/iterate-one-issue --resume-rg <branch>`, parse the new `ITERATE_OUTCOME`, tally, optional 5b auto-merge, write a follow-up Step 6 row, and tear down (or, on re-dispatch, keep) the worktree. Then `cd` back to the main worktree and continue.

Sequential mode: skip Step 6.5 entirely.

### Step 7 — Loop guard + continue

| Condition | Action |
|---|---|
| `ROUNDS_PROCESSED >= 50` | Phase 2 with reason `round cap reached (50 issues processed in one loop run)` |
| Else | Loop back to Step 1 |

The 50-round cap exists so a runaway loop doesn't blow through the entire backlog in one session without a human checkpoint. Adjust by editing this skill if needed.

---

## Phase 2 — Post-loop retrospective + self-improvement issue

Runs once when the loop exits for any reason (drain-once empty / monitor timeout / 50-round cap / hard halt). Follow the unified retrospective contract: [`.claude/shared/retrospective.md`](../../shared/retrospective.md). Skill-specific bindings:

- `SKILL_TAG=iterate-loop`
- `RUN_TAG` from 0b (`loop-<ISO-ts>`)
- `OUTCOME=PASSED` if at least one round produced `Done-Achieved` and zero `Done-Blocked`/`Done-TimedOut` requiring human attention; `DEGRADED` if mixed or any `Done-Blocked`/`Done-TimedOut` rounds; `BLOCKED` if pre-flight halted before any rounds ran.
- `RETRO_FILE=".claude/retrospectives/iterate-loop-$RUN_TAG.md"` AND mirror to `$LOOP_DIGEST_DIR/retrospective.md` for in-run inspection.

Source material for R1: `$LOOP_LOG` (per-round summary), the `Phase 2` lines from each inner run's stdout, and any halt reason from Steps 1/3/7.

Improvement candidates here typically target **the orchestrator itself** — examples:
- Skip-filter rules that hide actionable issues (e.g. `groomed` priority is wrong).
- Monitor cadence too slow / too aggressive.
- Round cap too low (or too high) for healthy backlogs.
- Inner skill returned `Done-Blocked` for a category we could have detected upstream.
- A whole class of issues kept being deferred to `needs-grooming` — propose a `groom-issues` improvement.

**Pipelined-mode-specific signals** (only when `PIPELINE=true` — fold these into R1/R2 candidate enumeration):
- `ROUNDS_OVERLAPPED / ROUNDS_PROCESSED` — overlap ratio. If <20%, pipelining bought little; investigate whether the pick filter is starving the second slot or release-gate is finishing too fast to overlap.
- Average **RG-wait absorbed** — wall-clock time the loop spent on Round N+1's active work while Round N's release-gate ran. Compute from per-round `Started`/`Finished` timestamps and `rg_pending.dispatched_at`. Goal: should approach the ~18 min release-gate baseline.
- **Worktree teardown failures** — count of `git worktree remove --force` errors. Persistent failures mean orphan worktrees accumulate; propose either a Phase 0a sweep or a Step 5 retry budget.
- Number of `ROUNDS_FELLBACK` rounds — recurring fallback (e.g. due to `ITERATE_WORKTREE_ROOT` pointing at a full disk) is itself an improvement candidate.

Run R1 then R2 per the shared spec. Created issues carry `iterate-improvement` + `self-improve:iterate-loop` and feed the next `/iterate-loop` run automatically (no human required).

End with the shared banner so logs are greppable:
```
🔁 Self-improve: <NEW_ISSUE_URL> (<category>)   # or "reproduced #N", "NO_IMPROVEMENT_FOUND", "skipped"
```

Then print the loop summary:
```
[iterate-loop] Run complete — RUN_TAG=<…>   Auto-merge: <on|off>   Pipeline: <on|off>
Rounds processed: <N>
  ✅ Done-Achieved: <a>   (auto-merged: <m>, merge-failed: <f>)
  ❌ Done-Blocked:  <b>
  ⏱  Done-TimedOut: <c>
  📝 Deferred-Grooming: <d>
  <pipeline only:> 🔀 Overlapped rounds: <ROUNDS_OVERLAPPED>   ↩  Sequential fallbacks: <ROUNDS_FELLBACK>
Halt reason: <…>
Loop digest: $LOOP_DIGEST_DIR/loop.md
Retrospective: $RETRO_FILE
```

---

## Phase 3 — Resume after interruption

Triggered by `/iterate-loop --resume`. Use when a previous run was killed mid-flight (CLI crash, host reboot, manual Ctrl-C) and on-disk state is non-empty. Pure recovery — never attempts new work until reconciliation completes.

### 3a. Discover prior runs

```bash
git worktree list --porcelain
ls -1t .claude/iterate-loop/runs/ 2>/dev/null
ls -1 .claude/iterate-state-*.md 2>/dev/null
```

Newest scheduler.json under `.claude/iterate-loop/runs/<RUN_TAG>/scheduler.json` is the canonical resume target. Reuse its `RUN_TAG`; do NOT mint a new one (so its retrospective + digest stay in one place).

### 3b. Reconcile

Per [references/pipeline.md § Resume reconciliation](references/pipeline.md#resume-reconciliation), for every entry in `scheduler.json` and every per-branch `.claude/iterate-state-<branch-slug>.md`:

| Discovered state | Action |
|---|---|
| `active.worktree` exists, branch checked out, state file `release_gate.state` is `not-started` | The previous run died mid-iteration. Treat as **Done-Blocked** (`reason: interrupted mid-iteration; resume not supported`), tear down, log, drop entry. |
| `rg_pending` entry has `release_gate.state` ∈ {`dispatched`, `failed`} | Probe `gh run view <RG_RUN_ID>`. If still in flight, leave the entry; the main loop will pick it up at the next yield point. If completed, drive 9b–d-resume immediately (same flow as Step 6.5). |
| State file `release_gate.state = passed` but PR still draft | Run the 9d tail (PR ready + comment) directly via `/iterate-one-issue --resume-rg <branch>` — its 9b will short-circuit on the already-passed state. |
| Worktree on disk but no state file / branch deleted | Orphan — `git worktree remove --force <path>` and log. |

### 3c. Re-enter Phase 1

Counters are restored from `scheduler.json`'s `counters` block (if present) or recomputed from `$LOOP_LOG`. Mode (`continuous` vs `drain-once`) is reread from `scheduler.json`. The 50-round cap counts pre-resume rounds. Then jump to Step 1 normally.

If `scheduler.json` is missing or unparseable: STOP `[iterate-loop] no resumable scheduler state found under .claude/iterate-loop/runs/. Start a fresh run instead.`

---

## Halt conditions

**Hard halts (Phase 2 still runs):**
- Dirty tree at 0a.
- `main` cannot fast-forward at Step 3.
- 50 rounds processed (round cap).
- 24 h monitor budget exhausted with zero eligible issues (continuous mode).
- Backlog empty at Step 1 (drain-once mode).

**Per-round soft skips (loop continues):**
- Claim label add fails at Step 2 (race — log + skip).
- Inner skill exits via 0d deferral (counted as `Deferred-Grooming`, loop picks the next).
- **Pipelined only:** `git worktree add` fails at Step 4 → fall back to sequential for **this round only** (`ROUNDS_FELLBACK += 1`); subsequent rounds still attempt pipelined dispatch.

**No retry of failed claims.** A claim collision means another `iterate-one-issue` (likely from the same loop in a parallel session, or a manual invocation) already owns the issue. Skipping is correct.

---

## Two-terminal dogfood mode (recommended)

**Terminal A (this skill):** `/iterate-loop` — drains backlog, applies fixes, opens PRs.

**Terminal B:** `/test-exploratory-loop` — dogfoods the live binary, files new bugs as `explore-ux` issues.

Both loops re-sync to `origin/main` between rounds. Bugs filed by Terminal B get picked up by Terminal A automatically. Retrospectives from both feed `iterate-improvement` issues that Terminal A then consumes — closing the loop.

---

## Outputs

- `$LOOP_DIGEST_DIR/loop.md` — per-round digest (one row per round)
- `$LOOP_DIGEST_DIR/retrospective.md` — in-run mirror of post-loop retro
- `.claude/retrospectives/iterate-loop-$RUN_TAG.md` — canonical retro location
- One self-improvement issue (if R2 found a candidate), labelled `iterate-improvement` + `self-improve:iterate-loop`

## Non-goals

- This skill never opens PRs of its own — only the inner `iterate-one-issue` does.
- This skill never closes GitHub issues — closure happens via PR-merge `Closes #<N>` trailers.
- This skill never modifies app source — only the inner skill does.
- This skill never merges PRs unless `--auto-merge` was passed at invocation. There is no mid-run upgrade path; choose merge policy up-front.
