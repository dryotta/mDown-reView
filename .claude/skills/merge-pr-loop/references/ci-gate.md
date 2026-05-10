# CI poll + forward-fix orchestration — reference

Spec for [`SKILL.md`](../SKILL.md) Step 4 (the CI poll + forward-fix loop). Covers exactly: how to find the auto-triggered CI run for the current `HEAD_SHA`, how to poll it, how to interpret outcomes, and how to drive `iterate-one-issue --resume-pr` between attempts.

The converged CI workflow (`.github/workflows/ci.yml`, [merged in PR #376](https://github.com/dryotta/mdownreview/pull/376)) fires automatically on every `pull_request` event — including the `synchronize` event GitHub fires after a rebase force-push or a forward-fix push. This skill exploits that to validate iterate branches without dispatching anything.

> **Why no dispatch?** The previous design (when this file was `release-gate.md`) used `gh workflow run release-gate.yml --ref <branch>` because `release-gate.yml` was gated to `release/*` head refs and required `workflow_dispatch` for arbitrary iterate branches. The converged `ci.yml` runs on every PR's `pull_request` trigger — no dispatch required, no `workflow_dispatch` accepted, fewer moving parts.

---

## Forward-fix attempt accounting

Per-PR cap: **5**. Source of truth is the count of `<!-- iterate-forward-fix-attempt -->` comment markers on the PR — not orchestrator memory. This survives orchestrator crashes, parallel runs, and operator-driven `iterate-one-issue --resume-pr` invocations.

Read at the top of every Step 4 loop iteration:

```bash
ATTEMPTS=$(gh pr view "$PICK" --json comments --jq '[.comments[].body | select(contains("<!-- iterate-forward-fix-attempt -->"))] | length')
if [ "$ATTEMPTS" -ge 5 ]; then
  # Step 6 — block this PR; budget exhausted.
fi
```

The marker comment is written by `iterate-one-issue --resume-pr` Phase R8 — this skill does **not** write it itself. That guarantees the count only advances when an actual forward-fix landed a commit.

---

## 4.1 — Locate the CI run for HEAD_SHA

`HEAD_SHA` was captured at Step 2 (initial pick), refreshed by Step 3.5 (clean rebase), or refreshed by Step 4.3 (re-poll after `Done-ForwardFixed`). Each of those refreshes was preceded by a push to the PR branch, which fires GitHub's `synchronize` event → `ci.yml` workflow run.

GitHub takes a few seconds to register the event and queue the run. Discovery has a tight retry budget — if the run never appears, that's a configuration bug (path filter, branch protection, workflow disabled), not a transient.

```bash
DISCOVER_BUDGET_S=300        # 5 min total
DISCOVER_INTERVAL_S=10
ELAPSED=0
CI_RUN_ID=""
while [ $ELAPSED -lt $DISCOVER_BUDGET_S ]; do
  CI_RUN_ID=$(gh run list --workflow=CI --branch "$BRANCH" --event pull_request \
    --limit 10 --json databaseId,headSha,createdAt,status \
    --jq "[.[] | select(.headSha == \"$HEAD_SHA\")] | sort_by(.createdAt) | reverse | .[0].databaseId // empty")
  if [ -n "$CI_RUN_ID" ]; then
    break
  fi
  sleep $DISCOVER_INTERVAL_S
  ELAPSED=$((ELAPSED + DISCOVER_INTERVAL_S))
done
```

If `CI_RUN_ID` is still empty after the budget: return to SKILL.md Step 6 (block this PR) with reason `CI workflow did not register a run for HEAD_SHA <sha> within 5 min — check workflow file or trigger filters`. No mid-loop retry — needs human triage.

PR comment (informational, before polling):
```bash
gh pr comment "$PICK" --body "<!-- merge-pr-ci-watching -->
⏳ Watching CI on commit \`$(git rev-parse --short "$HEAD_SHA")\` (run [<CI_RUN_ID>](https://github.com/dryotta/mdownreview/actions/runs/<CI_RUN_ID>)). Polling…"
```

> **Filtering by `--event pull_request` is intentional.** `ci.yml` also runs on `push: main` (post-merge sanity) and via `workflow_call` (canary/release). Those runs target `main` or a temporary canary branch — they would never match `headSha == $HEAD_SHA` for an iterate branch. The event filter is belt-and-braces against future workflow re-organisation.

---

## 4.2 — Poll the run

Spawn `general-purpose` synchronously in the foreground:

```
Poll GitHub Actions run <CI_RUN_ID> every 60 s, max 30 min.
  gh run view <CI_RUN_ID> --json status,conclusion --jq '{status,conclusion}'
Stop when status != "in_progress" and != "queued".
Return PASS (conclusion=success) or FAIL with the failed jobs and last 200 lines of each failed job's log:
  gh run view <CI_RUN_ID> --log-failed | tail -n 200
```

CI's hot-cache wall time is ~13 min on this repo (limited by Build (windows-x64)). The 30-minute budget covers cold-cache + retry attempts. If the budget elapses without completion, treat as FAIL with reason `CI poll timed out at 30 min` and proceed to 4.3 (forward-fix). The next attempt will see the still-running run via the headSha disambiguation and may catch the eventual conclusion before pushing again.

> **Why 30 min when the gate used to allow 60 min?** The converged `ci.yml` is bounded by per-job `timeout-minutes` (max 30 across the matrix). A run that exceeds 30 min wall time is a runner outage, not a slow build — better to fail fast and trigger forward-fix rather than wait an hour.

---

## 4.3 — On FAIL: forward-fix via `iterate-one-issue --resume-pr`

Re-check the attempt cap (a parallel orchestrator may have advanced it):

```bash
ATTEMPTS=$(gh pr view "$PICK" --json comments --jq '[.comments[].body | select(contains("<!-- iterate-forward-fix-attempt -->"))] | length')
[ "$ATTEMPTS" -ge 5 ] && return-to-Step-6  # block, reason `forward-fix budget exhausted (5 attempts)`
```

Spawn `iterate-one-issue --resume-pr "$PICK"` synchronously in the foreground. The inner skill's Phase R does its own preflight (clean tree on main → checkout PR branch → rebase if behind → forward-fix wave → commit + push → write `<!-- iterate-forward-fix-attempt -->` marker). The push fires a fresh `synchronize` event → CI auto-triggers a new run on the new HEAD_SHA. Final stdout line is the outcome marker:

```
ITERATE_OUTCOME: <Done-ForwardFixed|Done-Blocked> issue=n/a branch=<BRANCH> pr=<PR_URL> [commit=<sha>]
```

Routing:

| Inner outcome | Action |
|---|---|
| `Done-ForwardFixed commit=<sha>` | `git checkout main && git pull --ff-only`. Refresh `HEAD_SHA=<sha>` (from outcome marker — do **not** re-query `gh pr view`, which may lag by several seconds). `PRS_FORWARD_FIXED += 1`. Loop back to 4.1 — locate the new CI run for `HEAD_SHA`. |
| `Done-Blocked` | Return to SKILL.md Step 6 (block this PR). Reason from inner skill PR comment, e.g. `forward-fix produced no diff`, `branch missing or diverged`, `forward-fix rebase against origin/main failed`. |
| Any other / parse failure | Return to Step 6, reason `unrecognised outcome from iterate-one-issue --resume-pr: <last 200 chars of stdout>`. |

---

## 4.4 — On PASS: hand back to SKILL.md Step 5

The poll returned `status=completed`, `conclusion=success`. Break out of Step 4's loop. SKILL.md Step 5 handles refresh-body, ready-comment, squash-merge, label cleanup.

---

## State the loop carries between iterations

Per-PR, all of these reset on Step 1's next pick:

- `BRANCH` — captured at Step 2.
- `PR_URL` — captured at Step 2.
- `HEAD_SHA` — captured at Step 2; refreshed by Step 3.5 (clean rebase) and from the `commit=` field of every `Done-ForwardFixed` outcome.
- `MERGE_RACE_RETRIES` — captured at Step 2 (init `0`); incremented by Step 5.0 when the branch is found behind right before merge; cap = `1`. Independent of the forward-fix budget.
- `CI_RUN_ID` — re-discovered at every 4.1 invocation by `headSha` lookup.
- Attempt count is **not** stored locally — re-read from PR comments at every loop iteration so a parallel run cannot bypass the cap.

## Step 3.5's interaction with this document

Step 3.5 in [`SKILL.md`](../SKILL.md) does an inline clean rebase before reaching this document's flow. The rebase force-push triggers a `synchronize` event → CI auto-fires on the rebased commit, exactly as if a forward-fix had pushed. On rebase **conflict** (not handled inline — clean rebases only), Step 3.5 invokes the same `iterate-one-issue --resume-pr "$PICK"` subagent described in §4.3 below. The inner skill detects "no failed CI run but branch behind origin/main" and runs a **rebase-only** Phase R pass (R5 rebase + per-file conflict resolver, R7 push --force-with-lease, R8 marker, exit `Done-ForwardFixed`). Outcome routing is identical to §4.3:

- `Done-ForwardFixed commit=<sha>` → refresh `HEAD_SHA = <sha>`, `PRS_FORWARD_FIXED += 1`, continue to §4.1 (locate the new CI run on the rebased commit).
- `Done-Blocked` → SKILL.md Step 6 (block with inner reason).
- Other / parse failure → SKILL.md Step 6 (block with `unrecognised outcome from iterate-one-issue --resume-pr (rebase-only)`).

---

## Branch-protection + check-name contract

The single required status check is **`CI gate`** — the aggregate-gate job inside `ci.yml`. It runs `if: always()` and depends on every other job in the workflow, so:

- For code PRs: every heavy job must succeed → `CI gate` succeeds.
- For docs-only PRs: `changes` job sets `code=false` → all heavy jobs are correctly skipped → `CI gate` accepts skip-on-skip and reports green in <30 s.

The `gh run list --workflow=CI` poll above watches the **whole CI workflow run**. The aggregate-gate job's success implies every required job succeeded — which is exactly what branch protection enforces. No need to query individual job statuses; the workflow-level `conclusion=success` is sufficient.

If branch protection is later expanded to require additional named checks, this skill's poll is unaffected — those new checks would also be jobs inside `ci.yml` and would block the aggregate gate's success when they fail.
