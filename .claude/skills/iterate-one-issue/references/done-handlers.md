### Done-Achieved

Step 9 ran first; if it halted you are in Done-Blocked instead. Step 9d already closed mirror, refreshed PR body, marked PR ready. Run **Phase 2** (only path where 2e may auto-recurse).

Closure of the source issue happens automatically on PR merge via the `Closes #<N>` trailer. The `iterate-in-progress` claim label is owned by `iterate-loop` (when this skill was invoked from the loop) and is cleared by `iterate-loop` after parsing the `ITERATE_OUTCOME` marker — this skill does not touch it.

```
✅ <MODE> — <ref>
   PR: <URL> (ready for review, release gate passed)
   Branch: <BRANCH>
   Iterations: <passed_count> passed · <degraded_count> degraded
   Release-gate fix attempts: <K>
   Final assessor confidence: <%>
   Phase 2: <skipped | NO_IMPROVEMENT_FOUND | improvement issue $NEW_ISSUE_URL [auto-recursing]>
```

```
ITERATE_OUTCOME: Done-Achieved issue=<N|n/a> branch=<BRANCH> pr=<URL>
```

Then exit cleanly. Chaining to the next issue (if any) is `iterate-loop`'s responsibility.

### Done-Blocked

Run **Phase 2** first (synthesis only — 2e gated off; not Done-Achieved).

PR stays draft. Comment:
```bash
gh pr comment <PR_NUMBER> --body "$(cat <<'EOF'
<!-- iterate-blocked -->
## ⚠️ Autonomous iteration halted at iteration <N>/30
**Reason:** <BLOCKING_REASON | rebase-conflict summary | release-gate reason>
**Last assessor evidence:** <…>
<if rebase-conflict:> **Conflicted files:** <list>
Iterations 1..<N-1> are pushed. Restart with `/iterate-one-issue <same args>` after deletion, or continue manually.
EOF
)"
```

Issue mode: post the same on the issue (`<!-- iterate-blocked-issue -->`) **and label it `blocked` so future autonomous sweeps skip it until a human un-blocks**:

```bash
gh issue comment $ISSUE_NUMBER --body "$(cat <<'EOF'
<!-- iterate-blocked-issue -->
## ⚠️ /iterate-one-issue halted — Done-Blocked at iteration <N>/30
**Reason:** <BLOCKING_REASON>
**Branch:** $BRANCH (draft PR: <URL>)
**Last assessor evidence:** <…>

This issue has been labelled `blocked`; subsequent `/iterate-loop` sweeps will skip it until the label is removed. Resolve the blocker, remove the `blocked` label (and remove the draft branch if you want a clean restart), then the next `/iterate-loop` sweep will pick it up.
EOF
)"
gh issue edit $ISSUE_NUMBER --add-label "blocked"
```

The `iterate-in-progress` claim label is owned by `iterate-loop`; it clears that label after parsing `ITERATE_OUTCOME`.

```
❌ <MODE> — <ref>
   Halted at iteration <N>/30   Reason: <short>
   PR (draft): <URL>   Branch: <BRANCH>
   Phase 2: <skipped | NO_IMPROVEMENT_FOUND | follow-up issue $NEW_ISSUE_URL>
```

```
ITERATE_OUTCOME: Done-Blocked issue=<N|n/a> branch=<BRANCH> pr=<URL>
```

Then exit cleanly.

### Done-TimedOut

Run **Phase 2** first (2e gated off). 30 iterations is the strongest possible signal that something structural needs to change.

PR stays draft. Comment:
```bash
gh pr comment <PR_NUMBER> --body "$(cat <<'EOF'
<!-- iterate-timeout -->
## ⏱ Iteration cap reached (30)
**Progress:** <passed_count> passed · <degraded_count> degraded
**Final assessor confidence:** <%>
**Last NEXT_REQUIREMENTS (still open):**
<bullets>
Review the branch — merge what is ready, continue manually, or restart with `/iterate-one-issue <args>` after adjusting scope.
EOF
)"
```
Issue mode: post the same on the issue and add `blocked` so the autonomous sweep skips this issue until a human revises scope:

```bash
gh issue edit $ISSUE_NUMBER --add-label "blocked"
```

The `iterate-in-progress` claim label is owned by `iterate-loop`.

```
⏱  <MODE> — <ref>
   Cap reached after 30 iterations
   PR (draft, partial): <URL>   Branch: <BRANCH>
   Phase 2: <skipped | NO_IMPROVEMENT_FOUND | follow-up issue $NEW_ISSUE_URL>
```

```
ITERATE_OUTCOME: Done-TimedOut issue=<N|n/a> branch=<BRANCH> pr=<URL>
```

Then exit cleanly.
