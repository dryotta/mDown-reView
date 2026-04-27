## Failure recovery

If an iteration is interrupted mid-loop (CLI crash, host reboot, manual Ctrl-C):

1. Identify the in-flight branch from `git branch --show-current`.
2. Read `.claude/iterate-state-<branch-slug>.md` for branch / PR / last iteration.
3. `git checkout <BRANCH>`.
4. If `.git/rebase-merge` or `.git/rebase-apply` exists, complete or abort before restart.
5. ```bash
   git config rerere.enabled true
   git config rerere.autoupdate true
   ```
6. Inspect retros at `.claude/retrospectives/<safe-branch>-iter-*.md` — pushed retros are visible in PR; uncommitted ones can be reviewed locally.
7. If `.claude/iterate-recursion-depth` exists from a crash, delete it (or wait 24 h for 0b to expire).
8. **Restart is not supported** — Phase 0 halts on existing branch. To resume, delete the in-flight branch and re-invoke `/iterate-one-issue <same args>` — Step 1's rebase + Step 2's assessor will fold in already-pushed work. Retros committed on the prior branch persist via the rebase and still drive Phase 2 of the next run.

For release-gate forward-fix interruptions (Phase R, `--resume-pr`): no special recovery is needed. Phase R is single-pass — re-invoke `/iterate-one-issue --resume-pr <PR>` after cleaning the working tree. The PR-comment marker count from prior attempts is the only state.
