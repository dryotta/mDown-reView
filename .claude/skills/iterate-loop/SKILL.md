---
name: iterate-loop
description: Use when the user wants to drain the GitHub issue backlog autonomously — phrases like "drain the backlog", "work through the issues", "auto-fix open issues", or just empty `/iterate-loop`. Continuous orchestrator that picks the next eligible issue, dispatches `iterate-one-issue` against it, and loops. Default is continuous (drain + monitor); `--once` drains once and exits. Never prompts. Pair with `test-exploratory-loop` running in another terminal for the full self-improvement dogfood.
---

**RIGID. Fully autonomous — never calls `ask_user`.** This skill is the **outer orchestrator** for the issue-fix loop. It picks the next eligible issue from the GitHub backlog, claims it (`iterate-in-progress` label), invokes `iterate-one-issue` against it, releases the claim, and repeats. When the backlog drains, it either exits (`--once`) or polls indefinitely waiting for new issues (default).

For single-issue or freeform-goal work, the user invokes `iterate-one-issue` directly — this skill is **only** for the backlog-drain pattern.

---

## Args

| Arg | Mode | Behavior when backlog empty |
|---|---|---|
| empty | `continuous` | Poll backlog every 5 min, max 24 h. Then halt. |
| `--once` | `drain-once` | Halt immediately. |

Anything else → STOP `[iterate-loop] Unknown arg "<ARG>". Use empty (continuous) or --once.`

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
ROUNDS_PROCESSED=0
ROUNDS_DONE_ACHIEVED=0
ROUNDS_DONE_BLOCKED=0
ROUNDS_DONE_TIMED_OUT=0
ROUNDS_DEFERRED=0   # iterate-one-issue exited via 0d (needs-grooming)
```

Print banner:
```
[iterate-loop] Mode: <continuous|drain-once> | Run tag: <RUN_TAG>
Watching backlog (skip: needs-grooming, blocked, iterate-in-progress)
```

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

Invoke the `iterate-one-issue` skill with arg `$PICK`. The inner skill will:
- Branch / draft PR / state file / etc.
- Run the iteration loop end-to-end.
- Print `ITERATE_OUTCOME: <Done-Achieved|Done-Blocked|Done-TimedOut> issue=<N> branch=<…> pr=<URL>` as its last line, then exit.

**Or** (rare) defer the issue via 0d (`needs-grooming` clarification posted). In that case the inner skill exits without printing `ITERATE_OUTCOME` — instead its banner ends `[iterate-one-issue] Issue #<N> deferred to grooming.`

Wait for the inner skill to return. Capture its full final stdout into `INNER_OUTPUT`.

### Step 5 — Release the claim

Whatever the outcome, the `iterate-in-progress` label must come off so future sweeps see the issue clearly. The inner skill's Done-X handlers DO add `blocked` (Done-Blocked) or leave it alone (Done-Achieved → closure on PR merge), so this skill only owns the claim label:

```bash
gh issue edit $PICK --remove-label "iterate-in-progress" 2>/dev/null || true
```

### Step 6 — Tally + per-round log

Parse `INNER_OUTPUT`. Append one row to `$LOOP_LOG`:

```markdown
## Round <ROUNDS_PROCESSED+1> — Issue #<PICK>
- Started: <ISO>   Finished: <ISO>   Duration: <h:mm>
- Outcome: <Done-Achieved|Done-Blocked|Done-TimedOut|Deferred-Grooming>
- Branch: <BRANCH>   PR: <URL or n/a>
- Phase 2 (inner): <improvement issue URL | NO_IMPROVEMENT_FOUND | skipped>
```

Increment the matching `ROUNDS_*` counter. `ROUNDS_PROCESSED += 1`.

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

Run R1 then R2 per the shared spec. Created issues carry `iterate-improvement` + `self-improve:iterate-loop` and feed the next `/iterate-loop` run automatically (no human required).

End with the shared banner so logs are greppable:
```
🔁 Self-improve: <NEW_ISSUE_URL> (<category>)   # or "reproduced #N", "NO_IMPROVEMENT_FOUND", "skipped"
```

Then print the loop summary:
```
[iterate-loop] Run complete — RUN_TAG=<…>
Rounds processed: <N>
  ✅ Done-Achieved: <a>
  ❌ Done-Blocked:  <b>
  ⏱  Done-TimedOut: <c>
  📝 Deferred-Grooming: <d>
Halt reason: <…>
Loop digest: $LOOP_DIGEST_DIR/loop.md
Retrospective: $RETRO_FILE
```

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
