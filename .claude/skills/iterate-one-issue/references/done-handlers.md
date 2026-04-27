### Done-Achieved

Reached when Step 2's `exe-goal-assessor` returns `achieved` (every `REQUIREMENT` marked `met`). No release-gate dispatch — that lifecycle belongs to `merge-pr-loop`.

Handler steps (in order):

1. Refresh PR body — tick every requirement checkbox the assessor marked `met`, replace the summary line with `Ready for review — goal achieved.`. Issue mode keeps the `Closes #<ISSUE_NUMBER>` trailer:
   ```bash
   gh pr edit <PR_NUMBER> --body "<final body>"
   ```
2. Mark the PR ready-for-review (only place this skill flips the draft state):
   ```bash
   gh pr ready <PR_NUMBER>
   ```
3. Add the `iterate-pr` label so `merge-pr-loop` will pick it up. Idempotent label create on first run:
   ```bash
   gh label create iterate-pr --description "PR opened by iterate-one-issue, awaiting release-gate validation by merge-pr-loop" --color BFD4F2 2>/dev/null || true
   gh pr edit <PR_NUMBER> --add-label iterate-pr
   ```
4. Comment on the PR:
   ```bash
   gh pr comment <PR_NUMBER> --body "<!-- iterate-done-achieved -->
   ✅ Goal achieved on commit \`$(git rev-parse --short HEAD)\`. PR ready for review; \`merge-pr-loop\` will run the release gate and merge."
   ```
5. Run **Phase 2** (only path where 2e may auto-recurse).

Source-issue closure is automatic on PR merge via the `Closes #<N>` trailer. The `iterate-in-progress` claim label is owned by `iterate-loop` (when this skill was invoked from it) and cleared by the loop after parsing `ITERATE_OUTCOME` — this skill does not touch it.

Banner:
```
✅ <MODE> — <ref>
   PR: <URL> (ready for review, labelled iterate-pr — merge-pr-loop will gate + merge)
   Branch: <BRANCH>
   Iterations: <passed_count> passed · <degraded_count> degraded
   Final assessor confidence: <%>
   Phase 2: <skipped | NO_IMPROVEMENT_FOUND | improvement issue $NEW_ISSUE_URL [auto-recursing]>
```

```
ITERATE_OUTCOME: Done-Achieved issue=<N|n/a> branch=<BRANCH> pr=<URL>
```

Then exit cleanly. Chaining is `iterate-loop`'s responsibility; release-gate validation is `merge-pr-loop`'s.

---

### Done-Blocked

Run **Phase 2** first (synthesis only — 2e gated off; not Done-Achieved).

PR stays draft and **does not** receive the `iterate-pr` label (so `merge-pr-loop` never picks it). Comment:
```bash
gh pr comment <PR_NUMBER> --body "$(cat <<'EOF'
<!-- iterate-blocked -->
## ⚠️ Autonomous iteration halted at iteration <N>/30
**Reason:** <BLOCKING_REASON | rebase-conflict summary>
**Last assessor evidence:** <…>
<if rebase-conflict:> **Conflicted files:** <list>
Iterations 1..<N-1> are pushed. Restart with `/iterate-one-issue <same args>` after resolving the blocker, or continue manually.
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

---

### Done-TimedOut

Run **Phase 2** first (2e gated off). 30 iterations is the strongest signal that something structural needs to change.

PR stays draft, no `iterate-pr` label. Comment:
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

---

### Done-ForwardFixed

Reached only from **Phase R** (`--resume-pr` mode). The forward-fix wave produced a new commit on the PR branch; merge-pr-loop should re-dispatch the release gate against `commit=<sha>`.

Phase R already wrote the `<!-- iterate-forward-fix-attempt -->` comment and pushed. No banner beyond the outcome marker. **Phase 2 is skipped** — single-pass forward-fixes lack signal density, and the eventual merge-pr-loop merge or its own Done-Blocked emits a retro.

```
ITERATE_OUTCOME: Done-ForwardFixed issue=n/a branch=<BRANCH> pr=<URL> commit=<NEW_HEAD>
```

Then exit cleanly.
