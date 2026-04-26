### Step 9 — Release-gate validation (Done-Achieved only)

Runs the Windows + macOS Release Gate (real installers, signed builds) against accumulated work. Release Gate triggers on `release/*` branches; this step creates a mirror branch+PR at the iterate tip, validates there, forward-fixes on the **iterate branch** so humans review one PR.

#### 9a. Mirror branch + PR
```bash
RELEASE_BRANCH="release/iterate-$(echo "$BRANCH" | sed 's|^[^/]*/||' | cut -c1-40)-$(date +%Y%m%d%H%M)"
git checkout -b "$RELEASE_BRANCH"
git push -u origin HEAD
git checkout "$BRANCH"

RELEASE_PR_URL=$(gh pr create --draft --base main --head "$RELEASE_BRANCH" \
  --title "validate-release: $PR_TITLE" \
  --body "Release-gate validation for #<PR_NUMBER>. Close with --delete-branch after validation.")
RELEASE_PR_NUMBER=<parse>
```

Pre-existing `$RELEASE_BRANCH` → halt **Done-Blocked** reason `release-gate branch <…> already exists — delete and re-run step 9 manually`. Do NOT overwrite.

```bash
gh pr comment <PR_NUMBER> --body "<!-- iterate-release-gate-start -->
⏳ Release-gate validation started on $RELEASE_PR_URL"
```

#### 9b. Poll
`general-purpose`:
```
Poll CI + Release Gate on PR <RELEASE_PR_NUMBER> every 60 s, max 60 min.
  gh pr checks <RELEASE_PR_NUMBER>
Stop when no check is pending/in_progress. Return PASS or FAIL + logs.
```

#### 9c. Forward-fix loop (max 5)

On FAIL:
1. `exe-task-implementer`:
   ```
   Fix Release Gate failures. No revert — forward fix.
   Failed: <names>   Logs: <truncated>   Prior: <summaries>
   Edit on iterate branch (current tree). Do NOT edit the release-mirror branch.
   Return Implementation Summary.
   ```
2. Commit + push on iterate branch:
   ```bash
   git add <files>
   git commit -m "fix(iter-release): <summary>"
   git push
   ```
3. Fast-forward mirror to iterate tip:
   ```bash
   git checkout "$RELEASE_BRANCH"
   git merge --ff-only "$BRANCH"
   git push
   git checkout "$BRANCH"
   ```
4. Re-run 9b.
5. PASS → 9d. After 5 attempts still FAIL → halt **Done-Blocked** reason `release-gate failure after 5 forward-fix attempts`. Mirror PR stays draft; iterate PR stays draft.

#### 9d. Close mirror, mark iterate ready

Execute ALL in order:
1. `gh pr close "$RELEASE_PR_NUMBER" --delete-branch`
2. Refresh iterate PR body — tick all progress, summary "Ready for review — goal achieved, release gate passed". Issue mode: keep `Closes #<ISSUE_NUMBER>` trailer. `gh pr edit <PR_NUMBER> --body "<final>"`.
3. `gh pr ready <PR_NUMBER>` (only place this skill flips iterate PR out of draft).
4. State file:
   ```markdown
   ## Release-gate validation — PASSED
   - Mirror PR: <URL> (closed --delete-branch)
   - Fix attempts: <N>
   - Commit validated: <iterate HEAD SHA>
   - Iterate PR: <URL> (ready for review)
   ```
5. Comment on iterate PR:
   ```bash
   gh pr comment <PR_NUMBER> --body "<!-- iterate-release-gate-done -->
   🟢 Release gate validated on commit <sha>. Mirror PR closed. PR ready for review."
   ```

Proceed to **Done-Achieved** banner.
