### Done-Achieved

Reached when:
- Step 2 returned `achieved` AND `DIFF_CLASS != code` (Step 9 skipped — non-buildable diff), OR
- Step 9b–d-resume completed with `release_gate.state = passed` (whether called synchronously after 9a in single-issue mode, or later by `iterate-loop` in pipeline mode).

Step 9d (when it ran) already closed pending state, refreshed PR body, marked PR ready. On the `DIFF_CLASS != code` path, Step 9-skip jumps here directly — handler runs the equivalent of 9d itself: refresh PR body summary, `gh pr ready <PR_NUMBER>`, comment `Release gate skipped — DIFF_CLASS=<…>, not applicable to non-buildable diffs`. Run **Phase 2** (only path where 2e may auto-recurse).

Source-issue closure is automatic on PR merge via the `Closes #<N>` trailer. The `iterate-in-progress` claim label is owned by `iterate-loop` (when this skill was invoked from it) and cleared by the loop after parsing `ITERATE_OUTCOME` — this skill does not touch it.

```
✅ <MODE> — <ref>
   PR: <URL> (ready for review, release gate <passed | skipped: DIFF_CLASS=<…>>)
   Branch: <BRANCH>
   Iterations: <passed_count> passed · <degraded_count> degraded
   Release-gate fix attempts: <K | n/a>
   Final assessor confidence: <%>
   Phase 2: <skipped | NO_IMPROVEMENT_FOUND | improvement issue $NEW_ISSUE_URL [auto-recursing]>
```

```
ITERATE_OUTCOME: Done-Achieved issue=<N|n/a> branch=<BRANCH> pr=<URL>
```

Then exit cleanly. Chaining is `iterate-loop`'s responsibility.

### Done-Achieved-RG-Pending

Reached when: Step 2 returned `achieved`, `DIFF_CLASS=code`, AND the inner skill is in pipeline mode (`ITERATE_PIPELINE_AWARE=1` set by `iterate-loop --pipeline`). Step 9a has dispatched the workflow and persisted `release_gate.state=dispatched`.

**Terminal for this invocation** (agent exits cleanly so the loop can claim the next issue) but **non-terminal for the loop** — the loop calls back into 9b–d-resume from a yield point in a later round. The resumed call (different invocation, same state file) emits `Done-Achieved` or `Done-Blocked`.

No PR comment beyond the `<!-- iterate-release-gate-dispatched -->` Step 9a already wrote. PR stays draft. No `blocked` label.

Phase 2 is **deferred** — running it now would race the release-gate result. The loop runs Phase 2 once 9b–d-resume reaches `Done-Achieved` or `Done-Blocked`.

```
⏳ <MODE> — <ref>
   PR (draft): <URL>   Branch: <BRANCH>   Worktree: <WORKTREE>
   Iterations: <passed_count> passed · <degraded_count> degraded   Final assessor confidence: <%>
   Release gate: dispatched (run <RG_RUN_ID>) — loop will resume validation
```

```
ITERATE_OUTCOME: Done-Achieved-RG-Pending issue=<N|n/a> branch=<BRANCH> pr=<URL> worktree=<WORKTREE> rg_run=<RG_RUN_ID>
```

Then exit cleanly.

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

Issue mode: post the same comment on the issue (`<!-- iterate-blocked-issue -->`) **and label `blocked` so future autonomous sweeps skip it until a human un-blocks**:

```bash
gh issue comment $ISSUE_NUMBER --body "$(cat <<'EOF'
<!-- iterate-blocked-issue -->
## ⚠️ /iterate-one-issue halted — Done-Blocked at iteration <N>/30
**Reason:** <BLOCKING_REASON>
**Branch:** $BRANCH (draft PR: <URL>)
**Last assessor evidence:** <…>

Labelled `blocked`; subsequent `/iterate-loop` sweeps will skip it until removed. Resolve the blocker, remove the label (and remove the draft branch for a clean restart), then the next sweep picks it up.
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

Run **Phase 2** first (2e gated off). 30 iterations is the strongest signal that something structural needs to change.

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
