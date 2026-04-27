# Pipelined scheduler — reference

Spec for `iterate-loop --pipeline`. Concurrency budget: at most **1 active** round (agent is currently executing the inner `iterate-one-issue` loop) **plus** at most **1 RG-pending** round (release-gate workflow running on GitHub; no agent attention). Never claim a 3rd issue.

Trades a small amount of orchestrator complexity for a roughly 18-minute-per-round wall-clock saving (the release-gate poll baseline) by overlapping it with the next round's active work.

---

## Scheduler state

In-memory; mirrored to `$LOOP_DIGEST_DIR/scheduler.json` on every transition (atomic write — temp file + rename) so `/iterate-loop --resume` can reconstruct it.

```json
{
  "run_tag": "loop-20260426T160000Z",
  "mode": "continuous | drain-once",
  "auto_merge": true,
  "active": null,
  "rg_pending": null,
  "counters": {
    "rounds_processed": 0,
    "rounds_done_achieved": 0,
    "rounds_done_blocked": 0,
    "rounds_done_timed_out": 0,
    "rounds_deferred": 0,
    "rounds_overlapped": 0,
    "rounds_fellback": 0,
    "rounds_auto_merged": 0
  }
}
```

Slot shape (both `active` and `rg_pending`):

```json
{
  "issue": 142,
  "branch": "feature/issue-142-csv-export",
  "worktree": "/abs/path/mdrev-pick-142",
  "started_at": "2026-04-26T16:01:30Z",
  "pr_url": "https://github.com/dryotta/mdownreview/pull/899",
  "rg_run_id": "11234567890",
  "dispatched_at": "2026-04-26T16:38:11Z"
}
```

`pr_url` / `rg_run_id` / `dispatched_at` are populated only when the entry is `rg_pending` (parsed from the `Done-Achieved-RG-Pending` marker). For `active`, leave `null`.

`branch` is unknown when active is first written (inner skill computes it in 0e). Backfill from `ITERATE_OUTCOME` after Step 5; if the inner skill exits via 0d (deferral) without printing the marker, `branch` may stay null and the entry is dropped at teardown.

---

## Worktree lifecycle

### Create — at Step 4

```bash
WT_ROOT="${ITERATE_WORKTREE_ROOT:-$(dirname "$(git rev-parse --show-toplevel)")}"
WT_PATH="$WT_ROOT/mdrev-pick-$PICK"
git worktree add "$WT_PATH" main
```

- `ITERATE_WORKTREE_ROOT` is honoured if set (operators with non-default disk layouts).
- The new worktree starts at the current `main` tip — inner 0f then creates `feature/issue-<N>-…` off it.
- Naming uses `pick-$PICK` (issue number) since the slug is unknown until 0e. After the inner skill completes, scheduler `branch` is backfilled from the marker; on-disk path stays `mdrev-pick-<N>`.

### Failure — fall back

Any non-zero exit from `git worktree add` (disk full, path exists, dubious-ownership on Windows): log one line, set `ROUNDS_FELLBACK += 1`, dispatch this single round in the main worktree without `ITERATE_PIPELINE_AWARE`. Next round attempts pipelined again — fallback is **per-round, not sticky**.

### Teardown

```bash
git worktree remove --force "$WT_PATH"
```

Runs **after** the outcome is FINAL for that issue:

| Outcome at Step 5 | Teardown timing |
|---|---|
| `Done-Achieved` (single dispatch path, e.g. `DIFF_CLASS != code`) | Immediately at Step 5. |
| `Done-Blocked` / `Done-TimedOut` / `Deferred-Grooming` | Immediately at Step 5. |
| `Done-Achieved-RG-Pending` | **Defer.** Worktree is needed by 9b–d-resume. Tear down only after the resume call's outcome is `Done-Achieved` or `Done-Blocked`. |
| `Done-Achieved-RG-Pending` re-emitted from 9c (forward-fix re-dispatched) | **Keep** the worktree; update `rg_pending.rg_run_id` + `dispatched_at` and re-poll. |

If `git worktree remove --force` fails (e.g. open file handle on Windows), log `[iterate-loop] worktree teardown failed for <path>: <stderr>` and continue. No retry mid-loop. Phase 2 retro counts these and proposes a sweep candidate.

---

## Yield points

The scheduler probes `rg_pending` **only** at safe checkpoints. Mid-rebase, between `git add`/`git commit`, between `git commit`/`git push` are forbidden — the inner skill must finish its current sub-step before the loop drives a resume.

| # | Yield point | What it does |
|---|---|---|
| 1 | **Between Step 8.5 and Step 1** of the active round (iteration boundary) | Non-blocking probe: `gh run view <rg_pending.rg_run_id> --json status,conclusion`. If `completed`, drive resume. |
| 2 | **On any inner-skill exit** (Done-X marker, 0d deferral, hard halt) | Same probe as #1, unconditional — even if the active round is wrapping up. Used by Step 6.5. |

**Inner-skill probes are deliberately omitted.** A previous design proposed a "multi-target CI poller" inside the inner skill's Step 6c that would also watch the prior round's release-gate. Removed because (a) the inner skill has no clean control path to suspend its A/B/C parallel agents and call back, and (b) cap-protection at Step 5 (drain prior `rg_pending` BEFORE moving the new active in) makes inside-the-round probing unnecessary for safety. The two yield points above suffice: the longest the loop holds an `rg_pending` past completion is one full active round.

---

## RG-completion handling

Triggered when any yield point sees `gh run view <RG_RUN_ID>` report `status=completed`, **or** when Step 5's cap-protection needs to drain `rg_pending` before refilling it.

1. **Suspend active at next safe checkpoint.** Forbidden mid-rebase, between `git add`/`git commit`, between `git commit`/`git push`. In practice: finish the current sub-step. Both yield points are safe by construction; cap-protection's call site (end of Step 5) is also safe (inner skill already exited).
2. `cd $RG_PENDING_WORKTREE`.
3. Invoke `/iterate-one-issue --resume-rg <RG_PENDING_BRANCH>`. Inner Phase 0a routes this to 9b–d-resume; pre-conditions: cwd = worktree, branch checked out, clean tree, `release_gate.state ∈ {dispatched, failed}`.
4. Parse the new `ITERATE_OUTCOME`:
   - `Done-Achieved` → tally as `Done-Achieved`, optional Step 5b auto-merge, write follow-up Step 6 row, **tear down**, **release the claim label** (held since the original Step 5), clear `rg_pending`.
   - `Done-Blocked` → tally as `Done-Blocked`, write Step 6 row, **tear down**, **release claim**, clear `rg_pending`.
   - `Done-Achieved-RG-Pending` → 9c forward-fixed and re-dispatched. **Keep** worktree, **keep** claim, update `rg_pending.rg_run_id` + `dispatched_at`, do **not** clear, do **not** write a "complete" row (one comes on next resume). When invoked from cap-protection, loop step 3 immediately (drain again until final).
5. `cd` back to active worktree (or main if none) and resume.

> **Cap-protection invariant.** Step 5's call here MUST loop until the slot is cleared (resumed outcome is final). A 9c re-dispatch refills the slot and restarts the wait; the loop must drain again before the new active takes the slot. This guarantees `len(active) + len(rg_pending) ≤ 2` at all observable times.

### Resume bookkeeping

The eventual `Done-Achieved` / `Done-Blocked` from a resumed round writes a follow-up row in `$LOOP_LOG` under the **same** `## Round <N>` heading the original `Done-Achieved-RG-Pending` row used:

```markdown
### Round <N> — RG-resume
- Resumed: <ISO>   Finished: <ISO>   Resume duration: <h:mm>
- Outcome: <Done-Achieved | Done-Blocked>
- Forward-fix attempts: <K>
- Auto-merge: <merged | skipped: <reason> | n/a (Done-Blocked) | off>
- Phase 2 (inner): <improvement issue URL | NO_IMPROVEMENT_FOUND>
```

`ROUNDS_DONE_ACHIEVED` / `ROUNDS_DONE_BLOCKED` increment **here**, not at the original `Done-Achieved-RG-Pending` Step 6. The original row logs the dispatch; the resume row logs the verdict. Together they describe one accounting unit.

---

## Resume reconciliation

Phase 3 of `iterate-loop/SKILL.md` calls into this section. For every persisted artefact:

1. Read `$LOOP_DIGEST_DIR/scheduler.json` (newest under `.claude/iterate-loop/runs/`). Use its `run_tag`, `mode`, `auto_merge`, `counters` as ground truth.
2. **Walk every worktree** (`git worktree list --porcelain` → `worktree <path>` lines) and inspect `<path>/.claude/iterate-state-*.md` inside each. Per-branch state files live inside their worktree, so the main worktree alone won't show them. For each `active`/`rg_pending` slot in `scheduler.json`, cross-check against the matching state file:
   - State file missing OR worktree gone → drop slot, log orphan, attempt teardown.
   - `release_gate.state == passed` but PR still draft → call `/iterate-one-issue --resume-rg <branch>` (9b short-circuits on the already-passed state and runs only 9d).
   - `release_gate.state ∈ {dispatched, failed}` AND `gh run view <run_id>` says `completed` → drive [§ RG-completion handling](#rg-completion-handling) immediately.
   - `release_gate.state ∈ {dispatched, failed}` AND run still in flight → leave intact; main loop picks up at next yield point.
   - `release_gate.state == not-started` (active killed mid-iteration) → no recovery; tear down, log as `Done-Blocked` reason `interrupted mid-iteration; resume not supported`, drop slot.
3. **Adopt unreferenced live state.** Any per-branch state file inside a live worktree but **not** referenced by any scheduler slot is the most-important recovery case (loop crashed between 9a writing state and `scheduler.json` being saved). For each:
   - `release_gate.state ∈ {dispatched, failed, passed}` → reconstruct an `rg_pending` entry from the state file (`issue` from branch name, `worktree` = parent of the `.claude/` dir, `branch` from header, `rg_run_id` from `workflow_run_id`, `dispatched_at` from same), insert into `scheduler.json`, then re-run case 2.
   - `release_gate.state == not-started` → orphan; move state file to `.claude/iterate-loop/runs/$RUN_TAG/orphans/` for human inspection; do not delete; tear down worktree.
4. Restore counters from `scheduler.json`. If absent, recompute from `$LOOP_LOG` row count and `Outcome:` lines.

After reconciliation, return to `iterate-loop` Step 1 with `PIPELINE=true`.
