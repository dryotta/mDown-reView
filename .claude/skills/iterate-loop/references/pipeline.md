# Pipelined scheduler — reference

Spec for `iterate-loop --pipeline`. Concurrency budget: at most **1 active** round (agent is currently executing the inner `iterate-one-issue` loop on it) **plus** at most **1 RG-pending** round (release-gate workflow is running on GitHub for it; no agent attention required). Never claim a 3rd issue.

The scheduler trades a small amount of orchestrator complexity for a roughly 18-minute-per-round wall-clock saving (the release-gate poll baseline) by overlapping it with the next round's active work.

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

`pr_url` / `rg_run_id` / `dispatched_at` are populated only when the entry is `rg_pending` (parsed from the `Done-Achieved-RG-Pending` outcome marker). For `active`, leave them `null`.

`branch` is unknown when the active entry is first written (the inner skill computes it in 0e). Backfill it from the `ITERATE_OUTCOME` marker after Step 5; if the inner skill exits via 0d (deferral) without printing the marker, `branch` may stay null and the entry is dropped at teardown.

---

## Worktree lifecycle

### Create — at Step 4

```bash
WT_ROOT="${ITERATE_WORKTREE_ROOT:-$(dirname "$(git rev-parse --show-toplevel)")}"
WT_PATH="$WT_ROOT/mdrev-pick-$PICK"
git worktree add "$WT_PATH" main
```

- `ITERATE_WORKTREE_ROOT` is honoured if set (operators with non-default disk layouts).
- The new worktree is checked out at the current `main` tip — the inner skill's 0f then creates `feature/issue-<N>-…` off of it.
- Naming uses `pick-$PICK` (issue number) rather than the branch slug because the slug is unknown until 0e. After the inner skill completes, scheduler state's `branch` field is backfilled from the outcome marker; the on-disk path stays `mdrev-pick-<N>`.

### Failure — fall back

Any non-zero exit from `git worktree add` (disk full, path already exists, dubious-ownership errors on Windows): log one line, set `ROUNDS_FELLBACK += 1`, and dispatch this single round in the main worktree without `ITERATE_PIPELINE_AWARE`. The next round attempts pipelined dispatch again — fallback is **per-round, not sticky**.

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

If `git worktree remove --force` fails (e.g. open file handle on Windows), log `[iterate-loop] worktree teardown failed for <path>: <stderr>` and continue. Do **not** retry mid-loop. Phase 2 retro counts these and proposes a sweep candidate.

---

## Yield points

The scheduler probes the `rg_pending` entry **only** at safe checkpoints. Mid-rebase, between `git add` and `git commit`, between `git commit` and `git push` are forbidden — the inner skill must finish its current sub-step before the loop is allowed to drive a resume.

| # | Yield point | What it does |
|---|---|---|
| 1 | **Between Step 8.5 and Step 1** of the active round (iteration boundary) | Non-blocking probe: `gh run view <rg_pending.rg_run_id> --json status,conclusion`. If `completed`, drive resume now. |
| 2 | **On any inner-skill exit** (Done-X marker emitted, or 0d deferral, or hard halt) | Same probe as #1, but unconditional — even if the active round is wrapping up. This is the path Step 6.5 uses. |

**Inner-skill probes are deliberately omitted.** A previous design proposed a "multi-target CI poller" inside the inner skill's Step 6c that would also watch the prior round's release-gate workflow. It was removed because (a) the inner skill has no clean control path to suspend its in-flight A/B/C parallel agents and call back to the loop, and (b) the cap-protection at Step 5 (drain prior `rg_pending` BEFORE moving the new active into `rg_pending`) makes inside-the-round probing unnecessary for safety. The two-yield-point design above is sufficient: the longest the loop can hold an `rg_pending` past completion is one full active round (because cap-protection drains it at the end of any round that would otherwise overflow the slot).

---

## RG-completion handling

Triggered when any yield point sees `gh run view <RG_RUN_ID>` report `status=completed`, **or** when Step 5's cap-protection rule needs to drain the existing `rg_pending` slot before moving a new entry into it.

1. **Suspend the active round at the next safe checkpoint.** Forbidden mid-rebase, between `git add` and `git commit`, between `git commit` and `git push`. In practice: finish the current sub-step and don't start the next one yet. Both yield points are already at safe checkpoints by construction; the cap-protection call site (end of Step 5) is also safe by construction (the inner skill has already exited).
2. `cd $RG_PENDING_WORKTREE`.
3. Invoke `/iterate-one-issue --resume-rg <RG_PENDING_BRANCH>`. The inner skill's Phase 0a parser routes this to its 9b–d-resume entry; pre-conditions are: cwd is the worktree, branch is checked out, `git status` clean, state file's `release_gate.state` ∈ {`dispatched`, `failed`}.
4. Parse the new `ITERATE_OUTCOME` marker:
   - `Done-Achieved` → tally as `Done-Achieved`, run optional Step 5b auto-merge, write a follow-up Step 6 row, **tear down** the worktree, **release the `iterate-in-progress` claim label** for that issue (it was held since the original Step 5 round), clear `rg_pending`.
   - `Done-Blocked` → tally as `Done-Blocked`, write Step 6 row, **tear down**, **release the claim label**, clear `rg_pending`.
   - `Done-Achieved-RG-Pending` → 9c forward-fixed and re-dispatched. **Keep** the worktree; **keep** the claim label; update `rg_pending.rg_run_id` + `dispatched_at` from the new marker; do **not** clear the entry; do **not** write a "complete" Step 6 row (one will come on the next resume). When invoked from cap-protection, loop step 3 immediately (drain again until the resumed outcome is `Done-Achieved` or `Done-Blocked`).
5. `cd` back to the active round's worktree (or the main worktree if there is no active round) and resume.

> **Cap-protection invariant.** Step 5's call into this section MUST loop until the slot is cleared (i.e. the resumed outcome is final). A re-dispatch from 9c re-fills the slot and restarts the wait; the loop must drain it again before the new active entry is allowed to take the slot. This guarantees `len(active) + len(rg_pending) ≤ 2` at all observable times.

### Resume bookkeeping

The eventual `Done-Achieved` / `Done-Blocked` from a resumed round writes a follow-up row in `$LOOP_LOG` under the **same** `## Round <N>` heading the original `Done-Achieved-RG-Pending` row used. Format:

```markdown
### Round <N> — RG-resume
- Resumed: <ISO>   Finished: <ISO>   Resume duration: <h:mm>
- Outcome: <Done-Achieved | Done-Blocked>
- Forward-fix attempts: <K>
- Auto-merge: <merged | skipped: <reason> | n/a (Done-Blocked) | off>
- Phase 2 (inner): <improvement issue URL | NO_IMPROVEMENT_FOUND>
```

`ROUNDS_DONE_ACHIEVED` / `ROUNDS_DONE_BLOCKED` increment **here**, not at the original `Done-Achieved-RG-Pending` Step 6. The original Step 6 row only logs the dispatch; the resume row logs the verdict. Together they describe one accounting unit.

---

## Resume reconciliation

Phase 3 of `iterate-loop/SKILL.md` calls into this section. For every persisted artefact:

1. Read `$LOOP_DIGEST_DIR/scheduler.json` (newest under `.claude/iterate-loop/runs/`). Use its `run_tag`, `mode`, `auto_merge`, `counters` as ground truth.
2. **Walk every worktree** (`git worktree list --porcelain` → `worktree <path>` lines) and inspect `<path>/.claude/iterate-state-*.md` inside each. Per-branch state files live inside their worktree, so the main worktree alone does not show them. For each `active`/`rg_pending` slot in `scheduler.json`, cross-check against the matching state file:
   - State file missing OR worktree gone → drop the slot, log orphan, attempt teardown.
   - State file `release_gate.state == passed` but PR still draft → call `/iterate-one-issue --resume-rg <branch>` (9b will short-circuit on the already-passed state and run only 9d).
   - State file `release_gate.state ∈ {dispatched, failed}` AND `gh run view <run_id>` says `completed` → drive [§ RG-completion handling](#rg-completion-handling) immediately.
   - State file `release_gate.state ∈ {dispatched, failed}` AND run still in flight → leave slot intact; main loop picks it up at the next yield point.
   - State file `release_gate.state == not-started` (active was killed mid-iteration) → no recovery; tear down, log as `Done-Blocked` reason `interrupted mid-iteration; resume not supported`, drop slot.
3. **Adopt unreferenced live state.** Any per-branch state file found inside a live worktree but **not** referenced by any scheduler slot is the most-important recovery case (loop crashed between 9a writing state and `scheduler.json` being saved). For each:
   - If `release_gate.state ∈ {dispatched, failed, passed}` → reconstruct an `rg_pending` entry from the state file (`issue` parsed from branch name, `worktree` = parent of the `.claude/` dir, `branch` from state header, `rg_run_id` from `workflow_run_id`, `dispatched_at` from same), insert into `scheduler.json`, then re-run case 2.
   - If `release_gate.state == not-started` → orphan; move the state file to `.claude/iterate-loop/runs/$RUN_TAG/orphans/` for human inspection; do not delete; tear down the worktree.
4. Restore counters from `scheduler.json`. If absent, recompute from `$LOOP_LOG` row count and `Outcome:` lines.

After reconciliation, return to `iterate-loop` Step 1 with `PIPELINE=true`.
