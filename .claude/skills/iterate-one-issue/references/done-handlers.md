### Done-Achieved

Reached when Step 2's `exe-goal-assessor` returns `achieved` (every `REQUIREMENT` marked `met`). No release-gate dispatch — that lifecycle belongs to `merge-pr-loop`.

#### Termination preconditions (issue #309) — drain `## Open scope non-actions` before any Done-X exit

Before invoking ANY `Done-X` handler — Done-Achieved, Done-Blocked, or Done-TimedOut — the runner MUST drain the **branch-level** `## Open scope non-actions` section of `.claude/iterate-state-<branch-slug>.md`. Step 2's `achieved` shortcut bypasses Steps 3–8.5, including 8-pre, so this gate is the single chokepoint that catches pending scope non-actions on every terminal exit. Workflow:

1. Read every entry under `## Open scope non-actions` in the state file.
2. For each entry with `disposition: pending`, run the same disposition workflow as 8-pre (`accepted` / `handled-in-forward-fix` / `follow-up-issue:<N>`; one-line `disposition_note`; move resolved entries to `## Resolved scope non-actions`).
3. **Block Done-Achieved on undisposed entries.** If any entry remains `pending` after step 2 — for example, the runner cannot decide a disposition without human input — the terminal outcome is forced to **Done-Blocked** (NOT Done-Achieved), with reason `scope non-actions undisposed: <implementer_attempt_id list>`. The PR stays draft, the source issue gets the `blocked` label, and `iterate-loop` skips the issue on subsequent sweeps until a human resolves the entries (e.g. by opening follow-up issues and re-disposing them).
4. Done-Blocked and Done-TimedOut also run this gate, but their outcome is unchanged — the gate just ensures that pending entries are surfaced in the Done-Blocked / Done-TimedOut PR comment so they're visible in the carry-over.

This gate guarantees that no terminal exit (including the Step 2 → Done-Achieved shortcut at SKILL.md "Termination" table) can ship pending scope non-actions silently.

Handler steps (in order):

1. **Bug-mode behavioural verification (`IS_BUG` only).** Before marking the PR ready-for-review, verify the original bug is resolved at the **observation level** of the bug report — not the implementation level.

   Spawn `general-purpose`:
   ```
   Behavioural verification for bug fix.
   Issue: #<ISSUE_NUMBER> — <ISSUE_TITLE>
   Bug report (body): <ISSUE_BODY>
   BUG_RCA (from Step 3a): <BUG_RCA or "n/a">

   Reproduce the original failure mode against the current codebase. Return this exact template:

   LAYER: <unit | browser-e2e | native-e2e | manual-not-runnable-locally>
   REPRO_COMMAND: <exact command or steps executed>
   OBSERVATION: <what you inspected — DOM property, HTTP response, test assertion, file content>
   EXPECTED: <what the bug report says should happen>
   ACTUAL: <what you observed>
   VERDICT: <CONFIRMED_FIXED | STILL_BROKEN | UNABLE_TO_VERIFY>
   EVIDENCE: <command output, assertion result, or screenshot path>
   ```

   Routing:
   - `CONFIRMED_FIXED` → continue to step 2.
   - `STILL_BROKEN` → revert to `in_progress`. Inject the verification failure as a new `NEXT_REQUIREMENT`: `- [ ] Bug verification: <OBSERVATION> still shows <ACTUAL>; expected <EXPECTED>`. Loop back to Step 3 of the current iteration (do not increment iteration counter).
   - `UNABLE_TO_VERIFY` (layer is `native-e2e` or `manual-not-runnable-locally` and no local reproduction is possible) → log `[done-achieved] behavioural verification: UNABLE_TO_VERIFY — <reason>`. Continue to step 2 but add a PR comment noting the limitation:
     ```bash
     gh pr comment <PR_NUMBER> --body "<!-- iterate-verify-limitation -->
     ⚠️ Bug-mode behavioural verification could not confirm fix at the reporter's observation level (requires <LAYER>). Unit/browser tests pass. Manual verification recommended before merge."
     ```

2. Refresh PR body — tick every requirement checkbox the assessor marked `met`, replace the summary line with `Ready for review — goal achieved.`. Issue mode keeps the `Closes #<ISSUE_NUMBER>` trailer:
   ```bash
   gh pr edit <PR_NUMBER> --body "<final body>"
   ```
3. Mark the PR ready-for-review (only place this skill flips the draft state):
   ```bash
   gh pr ready <PR_NUMBER>
   ```
4. Add the `iterate-pr` label so `merge-pr-loop` will pick it up. Idempotent label create on first run:
   ```bash
   gh label create iterate-pr --description "PR opened by iterate-one-issue, awaiting release-gate validation by merge-pr-loop" --color BFD4F2 2>/dev/null || true
   gh pr edit <PR_NUMBER> --add-label iterate-pr
   ```
5. Comment on the PR:
   ```bash
   gh pr comment <PR_NUMBER> --body "<!-- iterate-done-achieved -->
   ✅ Goal achieved on commit \`$(git rev-parse --short HEAD)\`. PR ready for review; \`merge-pr-loop\` will run the release gate and merge."
   ```
6. Run **Phase 2** (only path where 2e may auto-recurse).

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

Reached only from **Phase R** (`--resume-pr` mode), in either of two sub-modes:

- **forward-fix sub-mode** — the forward-fix wave produced a new commit on the PR branch (gate logs informed an `exe-task-implementer` fix); merge-pr-loop should re-dispatch the release gate against `commit=<sha>`.
- **rebase-only sub-mode** — no failed gate run was found but the branch was behind `origin/main`; Phase R rebased the branch (clean or via the per-file conflict resolver) and force-pushed. `commit=<sha>` is the rebased HEAD. merge-pr-loop should re-dispatch the gate on the rebased commit.

In both cases Phase R already wrote the `<!-- iterate-forward-fix-attempt -->` comment and pushed. No banner beyond the outcome marker. **Phase 2 is skipped** — single-pass forward-fixes lack signal density, and the eventual merge-pr-loop merge or its own Done-Blocked emits a retro.

```
ITERATE_OUTCOME: Done-ForwardFixed issue=n/a branch=<BRANCH> pr=<URL> commit=<NEW_HEAD>
```

Then exit cleanly.
