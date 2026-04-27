### Step 9 — Release-gate validation (Done-Achieved only, `DIFF_CLASS=code` only)

Validates the iterate branch tip against the Windows + macOS Release Gate (real signed installers, full cross-platform tests) **without** a mirror branch or mirror PR. Triggers `release-gate.yml` via `workflow_dispatch` against the iterate branch directly; the workflow accepts a `ref` input that bypasses its `startsWith(github.head_ref, 'release/')` job filter.

The split-step design lets `iterate-loop --pipeline` reclaim the agent during the ~18 min poll. **9a-dispatch** returns immediately; **9b–d-resume** is re-entrant and may run from a different CLI session.

#### State-file invariants

Every step here reads/writes `.claude/iterate-state-<branch-slug>.md` (Phase 0g). The `release_gate:` block is the source of truth:

```yaml
release_gate:
  state: <not-started | dispatched | passed | failed | skipped>
  ref: <BRANCH>
  workflow_run_id: <ID | null>
  dispatched_at: <ISO datetime | null>
  forward_fix_attempts: <0..5>
  step_at_suspend: <9b | 9c | 9d | null>
```

Resume reads `state`, `workflow_run_id`, `forward_fix_attempts` cold; iterate branch is reachable via `git fetch && git checkout <branch>` from any worktree.

---

### 9a — Dispatch (returns immediately)

Pre-conditions: Step 2 returned `achieved`, `DIFF_CLASS=code`, `release_gate.state` is `not-started` or absent.

#### 9a.1 — Trigger the workflow

Capture the dispatch timestamp **before** triggering, to disambiguate our run from any concurrent workflow_dispatch on the branch (second iterate session, manual UI, prior failed dispatch within the same minute):

```bash
DISPATCHED_AT_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
HEAD_SHA=$(git rev-parse HEAD)
gh workflow run release-gate.yml --ref "$BRANCH" -f ref="$BRANCH"
```

(`--ref` selects the workflow file revision; `-f ref=…` is the input `actions/checkout` validates against — see `${{ inputs.ref || github.ref }}` in the workflow. Typically match for an iterate branch.)

`gh workflow run` does not print the run ID. Query with **timestamp + headSha disambiguation**, not blind `--limit 1`:

```bash
sleep 5   # give GitHub time to register the dispatch
RG_RUN_ID=$(gh run list --workflow=release-gate.yml --branch "$BRANCH" --event workflow_dispatch \
  --limit 10 --json databaseId,createdAt,headSha \
  --jq "[.[] | select(.createdAt >= \"$DISPATCHED_AT_ISO\" and .headSha == \"$HEAD_SHA\")] | sort_by(.createdAt) | .[0].databaseId")
[ -z "$RG_RUN_ID" ] && { echo "[step9a] failed to capture release-gate run ID (no run with createdAt >= $DISPATCHED_AT_ISO and headSha=$HEAD_SHA)"; exit 1; }
```

If GitHub takes >5 s to register, retry once with longer sleep before failing:

```bash
if [ -z "$RG_RUN_ID" ]; then
  sleep 10
  RG_RUN_ID=$(gh run list --workflow=release-gate.yml --branch "$BRANCH" --event workflow_dispatch \
    --limit 10 --json databaseId,createdAt,headSha \
    --jq "[.[] | select(.createdAt >= \"$DISPATCHED_AT_ISO\" and .headSha == \"$HEAD_SHA\")] | sort_by(.createdAt) | .[0].databaseId")
fi
```

Failure to dispatch (workflow file missing, gh auth expired, etc.) → halt **Done-Blocked** reason `release-gate dispatch failed: <stderr first line>`. No retry — needs human triage.

#### 9a.2 — Persist resume state

Write the state file's `release_gate:` block:

```yaml
release_gate:
  state: dispatched
  ref: <BRANCH>
  workflow_run_id: <RG_RUN_ID>
  dispatched_at: <ISO now>
  forward_fix_attempts: 0
  step_at_suspend: 9b
```

#### 9a.3 — PR comment (informational)

```bash
gh pr comment <PR_NUMBER> --body "<!-- iterate-release-gate-dispatched -->
⏳ Release-gate dispatched on commit \`$(git rev-parse --short HEAD)\` (run [<RG_RUN_ID>](https://github.com/dryotta/mdownreview/actions/runs/<RG_RUN_ID>)). PR will be marked ready when validation completes."
```

#### 9a.4 — Return path

| Caller mode | Action |
|---|---|
| Single-issue (skill invoked directly) | Continue to **9b–d-resume** synchronously — no return. |
| Pipeline mode (loop set `ITERATE_PIPELINE_AWARE=1`) | **Return now** with outcome `Done-Achieved-RG-Pending`. Loop calls 9b–d-resume from a yield point. See [done-handlers.md](done-handlers.md) for marker grammar. |

How: `iterate-loop --pipeline` exports `ITERATE_PIPELINE_AWARE=1`; the inner skill checks it here at 9a.4.

---

### 9b–d — Resume (idempotent re-entry)

Entry contract:
- cwd is the worktree where `<BRANCH>` is checked out (caller `cd`s in first).
- `.claude/iterate-state-<branch-slug>.md` exists with `release_gate.state ∈ {dispatched, failed}`.
- `git status` is clean on `<BRANCH>`.

If any pre-condition fails, refuse to resume: log `[step9b-resume] preconditions not met: <which>` and return error.

#### 9b — Poll the release-gate run

Spawn `general-purpose`:
```
Poll GitHub Actions run <RG_RUN_ID> every 60 s, max 60 min.
  gh run view <RG_RUN_ID> --json status,conclusion --jq '{status,conclusion}'
Stop when status != "in_progress" and != "queued".
Return PASS (conclusion=success) or FAIL with the failed jobs and last 200 lines of each failed job's log:
  gh run view <RG_RUN_ID> --log-failed | tail -n 200
```

Update state: `release_gate.state = passed | failed`, `step_at_suspend = 9c` if failed.

#### 9c — Forward-fix loop (max 5)

On FAIL:

1. **Re-sync the iterate branch** (other PRs may have merged during the wait):
   ```bash
   git fetch origin main
   if ! git merge-base --is-ancestor origin/main HEAD; then
     git rebase --strategy=recursive --strategy-option=diff3 origin/main
     # On conflict: use Step 1's conflict-resolver loop (see SKILL.md Step 1).
     # Unresolvable after retry budget: halt Done-Blocked reason
     # `release-gate forward-fix rebase against origin/main failed`.
   fi
   ```
2. `exe-task-implementer`:
   ```
   Fix Release Gate failures. No revert — forward fix.
   Failed jobs: <names>   Logs: <truncated>   Prior attempts: <summaries>
   Edit on the iterate branch (current tree). DO NOT create a release-mirror branch — release-gate runs via workflow_dispatch on this branch directly.
   Return Implementation Summary.
   ```
3. Commit + push on iterate branch:
   ```bash
   git add <files>
   git commit -m "fix(iter-release): <summary>"
   git push
   ```
4. Re-dispatch against the new tip — same disambiguation as 9a.1:
   ```bash
   DISPATCHED_AT_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
   HEAD_SHA=$(git rev-parse HEAD)
   gh workflow run release-gate.yml --ref "$BRANCH" -f ref="$BRANCH"
   sleep 5
   RG_RUN_ID=$(gh run list --workflow=release-gate.yml --branch "$BRANCH" --event workflow_dispatch \
     --limit 10 --json databaseId,createdAt,headSha \
     --jq "[.[] | select(.createdAt >= \"$DISPATCHED_AT_ISO\" and .headSha == \"$HEAD_SHA\")] | sort_by(.createdAt) | .[0].databaseId")
   ```
   Update state: `release_gate.workflow_run_id = <new ID>`, `release_gate.state = dispatched`, `forward_fix_attempts += 1`, `step_at_suspend = 9b`.
5. **Pipeline mode:** return `Done-Achieved-RG-Pending` (with new `rg_run`) — loop calls 9b–d-resume again from another yield point.
   **Single-issue mode:** loop back to 9b synchronously.
6. `forward_fix_attempts == 5` AND still FAIL → halt **Done-Blocked** reason `release-gate failure after 5 forward-fix attempts`. State: `release_gate.state = failed`, `step_at_suspend = null`. Iterate PR stays draft.

#### 9d — On PASS: mark PR ready

Execute ALL in order:

1. Refresh iterate PR body — tick all progress, summary "Ready for review — goal achieved, release gate passed". Issue mode: keep `Closes #<ISSUE_NUMBER>` trailer. `gh pr edit <PR_NUMBER> --body "<final>"`.
2. `gh pr ready <PR_NUMBER>` (only place this skill flips iterate PR out of draft).
3. State file:
   ```markdown
   ## Release-gate validation — PASSED
   - Workflow run: <RG_RUN_ID>
   - Forward-fix attempts: <N>
   - Commit validated: <iterate HEAD SHA>
   - Iterate PR: <URL> (ready for review)
   ```
   Update YAML: `release_gate.state = passed`, `step_at_suspend = null`.
4. Comment on iterate PR:
   ```bash
   gh pr comment <PR_NUMBER> --body "<!-- iterate-release-gate-done -->
   🟢 Release gate validated on commit <sha> (run [<RG_RUN_ID>](https://github.com/dryotta/mdownreview/actions/runs/<RG_RUN_ID>)). PR ready for review."
   ```

Proceed to **Done-Achieved** banner. Pipeline-mode loop tears down the worktree after parsing the final outcome marker.

---

### Why no mirror branch / mirror PR?

The previous design created `release/iterate-<…>` mirror branches + mirror PRs to satisfy `release-gate.yml`'s `if: startsWith(github.head_ref, 'release/')` filter, then closed them after validation. With `workflow_dispatch` accepting a `ref` input and the job filter relaxed to `startsWith(github.head_ref, 'release/') || github.event_name == 'workflow_dispatch'`, the mirror is no longer needed:

- No mirror branch — saves ~5 s + one collision risk.
- No mirror PR open/close — saves ~10 s + one PR-noise event per iteration.
- No fast-forward dance in 9c — forward-fix lands directly on the iterate branch.
- Pipeline-mode resume from any worktree — only `workflow_run_id` to track.

The release-mirror handler in `done-handlers.md` (`Done-Blocked` on pre-existing release-mirror branch) is therefore obsolete and removed.
