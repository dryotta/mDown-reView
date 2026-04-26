## Failure recovery

If interrupted mid-loop:

1. Read `.claude/iterate-state.md` for branch / PR / last iteration.
2. `git checkout <BRANCH>`.
3. If `.git/rebase-merge` or `.git/rebase-apply` exists, complete or abort before restart.
4. ```bash
   git config rerere.enabled true
   git config rerere.autoupdate true
   ```
5. Inspect retros at `.claude/retrospectives/<safe-branch>-iter-*.md` — pushed retros are visible in PR; uncommitted ones can be reviewed locally.
6. If `.claude/iterate-recursion-depth` exists from a crash, delete it (or wait 24 h for 0b to expire).
7. **Restart is not supported** — Phase 0 halts on existing branch. To resume the work, delete the in-flight branch and re-invoke `/iterate <same args>` — Step 1's rebase + Step 2's assessor will fold in already-pushed work. Retros committed on the prior branch persist via the rebase and still drive Phase 2 of the next run.
