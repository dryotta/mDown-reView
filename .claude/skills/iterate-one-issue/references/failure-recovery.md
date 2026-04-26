## Failure recovery

If interrupted mid-loop:

1. Identify the in-flight branch from `git branch --show-current` (or, in pipeline mode, scan worktrees with `git worktree list`).
2. Read `.claude/iterate-state-<branch-slug>.md` (the per-branch state file — colocated worktrees each have their own) for branch / PR / last iteration / `release_gate.state`.
3. `git checkout <BRANCH>` (or `cd <worktree>` in pipeline mode).
4. If `.git/rebase-merge` or `.git/rebase-apply` exists, complete or abort before restart.
5. ```bash
   git config rerere.enabled true
   git config rerere.autoupdate true
   ```
6. Inspect retros at `.claude/retrospectives/<safe-branch>-iter-*.md` — pushed retros are visible in PR; uncommitted ones can be reviewed locally.
7. If `.claude/iterate-recursion-depth` exists from a crash, delete it (or wait 24 h for 0b to expire).
8. **If `release_gate.state == dispatched`** in the state file, you can resume the release-gate phase directly without restarting the iteration loop — invoke 9b–d-resume manually:
   - Verify the run still exists: `gh run view "$RG_RUN_ID"`. If the run was cancelled or expired, set `release_gate.state = not-started` and re-dispatch from Step 9a.
   - Otherwise jump straight to Step 9b's poll loop ([release-gate.md](release-gate.md#9b--poll-the-release-gate-run)).
9. **Otherwise restart is not supported** — Phase 0 halts on existing branch. To resume from earlier than 9b, delete the in-flight branch (and its worktree if pipeline mode created one: `git worktree remove --force <path>`) and re-invoke `/iterate-one-issue <same args>` — Step 1's rebase + Step 2's assessor will fold in already-pushed work. Retros committed on the prior branch persist via the rebase and still drive Phase 2 of the next run.

For pipeline-mode recovery (multiple worktrees / pending release gates), use `/iterate-resume` — it scans every `git worktree list` entry and every `.claude/iterate-state-*.md` to rebuild the loop's active set automatically. See `.claude/skills/iterate-loop/references/pipeline.md`.
