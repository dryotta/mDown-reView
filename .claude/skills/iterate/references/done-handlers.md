### Done-Achieved

Step 9 ran first; if it halted you are in Done-Blocked instead. Step 9d already closed mirror, refreshed PR body, marked PR ready. Run **Phase 2** (only path where 2e may auto-recurse).

In issue mode, also clear the claim label so the issue is no longer flagged as in-flight (closure happens automatically on PR merge via the `Closes #<N>` trailer):

```bash
gh issue edit $ISSUE_NUMBER --remove-label "iterate-in-progress" 2>/dev/null || true
```

```
✅ <MODE> — <ref>
   PR: <URL> (ready for review, release gate passed)
   Branch: <BRANCH>
   Iterations: <passed_count> passed · <degraded_count> degraded
   Release-gate fix attempts: <K>
   Final assessor confidence: <%>
   Phase 2: <skipped | NO_IMPROVEMENT_FOUND | improvement issue $NEW_ISSUE_URL [auto-recursing]>
```

**Continuous-mode handoff:** if `OUTER_MODE` was `continuous` or `drain-once` (and 2e did not auto-recurse), return to **0b** for the next eligible issue. Otherwise exit.

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
Iterations 1..<N-1> are pushed. Restart with `/iterate <same args>` after deletion, or continue manually.
EOF
)"
```

Issue mode: post the same on the issue (`<!-- iterate-blocked-issue -->`) **and label it `blocked` so future autonomous sweeps skip it until a human un-blocks**:

```bash
gh issue comment $ISSUE_NUMBER --body "$(cat <<'EOF'
<!-- iterate-blocked-issue -->
## ⚠️ /iterate halted — Done-Blocked at iteration <N>/30
**Reason:** <BLOCKING_REASON>
**Branch:** $BRANCH (draft PR: <URL>)
**Last assessor evidence:** <…>

This issue has been labelled `blocked`; the autonomous loop will skip it on subsequent sweeps. Resolve the blocker, remove the `blocked` label (and remove the draft branch if you want a clean restart), then `/iterate` will pick it up again.
EOF
)"
gh issue edit $ISSUE_NUMBER --add-label "blocked" --remove-label "iterate-in-progress"
```

```
❌ <MODE> — <ref>
   Halted at iteration <N>/30   Reason: <short>
   PR (draft): <URL>   Branch: <BRANCH>
   Phase 2: <skipped | NO_IMPROVEMENT_FOUND | follow-up issue $NEW_ISSUE_URL>
```

**Continuous-mode handoff:** if `OUTER_MODE` was `continuous` or `drain-once`, do **not** exit. Return to **0b** (pre-flight on `main`) and pick the next eligible issue. Otherwise exit.

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
Review the branch — merge what is ready, continue manually, or restart with `/iterate <args>` after adjusting scope.
EOF
)"
```
Issue mode: post the same on the issue, clear the claim label, and add `blocked` so the autonomous sweep skips this issue until a human revises scope:

```bash
gh issue edit $ISSUE_NUMBER --add-label "blocked" --remove-label "iterate-in-progress"
```

```
⏱  <MODE> — <ref>
   Cap reached after 30 iterations
   PR (draft, partial): <URL>   Branch: <BRANCH>
   Phase 2: <skipped | NO_IMPROVEMENT_FOUND | follow-up issue $NEW_ISSUE_URL>
```

**Continuous-mode handoff:** same as Done-Blocked — if `OUTER_MODE` was `continuous` or `drain-once`, return to **0b** for the next eligible issue. Otherwise exit.
