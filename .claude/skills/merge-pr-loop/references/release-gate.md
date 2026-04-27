# Release-gate dispatch + forward-fix orchestration — reference

Spec for [`SKILL.md`](../SKILL.md) Step 4 (the release-gate + forward-fix loop). Covers exactly: how to dispatch the workflow, how to disambiguate the run ID, how to poll, how to interpret outcomes, and how to drive `iterate-one-issue --resume-pr` between attempts.

The Release Gate workflow (`.github/workflows/release-gate.yml`) accepts a `ref` input via `workflow_dispatch` so it can validate any branch — not just `release/*`. This skill exploits that to gate iterate branches directly without a mirror PR.

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

## 4.1 — Dispatch the workflow

Capture the dispatch timestamp **before** triggering, to disambiguate our run from any concurrent `workflow_dispatch` on the branch (a parallel session, manual UI dispatch, prior failed dispatch within the same minute):

```bash
DISPATCHED_AT_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# HEAD_SHA was captured at Step 2 (initial dispatch) or refreshed by Step 4.4 (re-dispatch after Done-ForwardFixed).
gh workflow run release-gate.yml --ref "$BRANCH" -f ref="$BRANCH"
```

(`--ref` selects the workflow file revision; `-f ref=…` is the input that `actions/checkout` validates against — see `${{ inputs.ref || github.ref }}` in the workflow. Match for an iterate branch.)

`gh workflow run` does not print the run ID. Query with **timestamp + headSha disambiguation**, not blind `--limit 1`:

```bash
sleep 5   # give GitHub time to register the dispatch
RG_RUN_ID=$(gh run list --workflow=release-gate.yml --branch "$BRANCH" --event workflow_dispatch \
  --limit 10 --json databaseId,createdAt,headSha \
  --jq "[.[] | select(.createdAt >= \"$DISPATCHED_AT_ISO\" and .headSha == \"$HEAD_SHA\")] | sort_by(.createdAt) | .[0].databaseId")
```

If GitHub takes >5 s to register, retry once with longer sleep before failing:

```bash
if [ -z "$RG_RUN_ID" ]; then
  sleep 10
  RG_RUN_ID=$(gh run list --workflow=release-gate.yml --branch "$BRANCH" --event workflow_dispatch \
    --limit 10 --json databaseId,createdAt,headSha \
    --jq "[.[] | select(.createdAt >= \"$DISPATCHED_AT_ISO\" and .headSha == \"$HEAD_SHA\")] | sort_by(.createdAt) | .[0].databaseId")
fi
```

Failure to dispatch (workflow file missing, gh auth expired, etc.) → return to SKILL.md Step 6 (block this PR) with reason `release-gate dispatch failed: <stderr first line>`. No mid-loop retry — needs human triage.

PR comment (informational, before polling):
```bash
gh pr comment "$PICK" --body "<!-- merge-pr-release-gate-dispatched -->
⏳ Release-gate dispatched on commit \`$(git rev-parse --short "$HEAD_SHA")\` (run [<RG_RUN_ID>](https://github.com/dryotta/mdownreview/actions/runs/<RG_RUN_ID>)). Polling…"
```

---

## 4.2 — Poll the run

Spawn `general-purpose` synchronously in the foreground:

```
Poll GitHub Actions run <RG_RUN_ID> every 60 s, max 60 min.
  gh run view <RG_RUN_ID> --json status,conclusion --jq '{status,conclusion}'
Stop when status != "in_progress" and != "queued".
Return PASS (conclusion=success) or FAIL with the failed jobs and last 200 lines of each failed job's log:
  gh run view <RG_RUN_ID> --log-failed | tail -n 200
```

If the poll budget (60 min) elapses without completion: treat as FAIL with reason `release-gate poll timed out at 60 min` and proceed to 4.3 (forward-fix). The next attempt will see the still-running run via the headSha disambiguation and may catch the eventual conclusion before re-dispatching.

---

## 4.3 — On FAIL: forward-fix via `iterate-one-issue --resume-pr`

Re-check the attempt cap (a parallel orchestrator may have advanced it):

```bash
ATTEMPTS=$(gh pr view "$PICK" --json comments --jq '[.comments[].body | select(contains("<!-- iterate-forward-fix-attempt -->"))] | length')
[ "$ATTEMPTS" -ge 5 ] && return-to-Step-6  # block, reason `forward-fix budget exhausted (5 attempts)`
```

Spawn `iterate-one-issue --resume-pr "$PICK"` synchronously in the foreground. The inner skill's Phase R does its own preflight (clean tree on main → checkout PR branch → rebase if behind → forward-fix wave → commit + push → write `<!-- iterate-forward-fix-attempt -->` marker). Final stdout line is the outcome marker:

```
ITERATE_OUTCOME: <Done-ForwardFixed|Done-Blocked> issue=n/a branch=<BRANCH> pr=<PR_URL> [commit=<sha>]
```

Routing:

| Inner outcome | Action |
|---|---|
| `Done-ForwardFixed commit=<sha>` | `git checkout main && git pull --ff-only`. Refresh `HEAD_SHA=<sha>` (from outcome marker — do **not** re-query `gh pr view`, which may lag by several seconds). `PRS_FORWARD_FIXED += 1`. Loop back to 4.1 — re-dispatch. |
| `Done-Blocked` | Return to SKILL.md Step 6 (block this PR). Reason from inner skill PR comment, e.g. `forward-fix produced no diff`, `branch missing or diverged`, `forward-fix rebase against origin/main failed`. |
| Any other / parse failure | Return to Step 6, reason `unrecognised outcome from iterate-one-issue --resume-pr: <last 200 chars of stdout>`. |

---

## 4.4 — On PASS: hand back to SKILL.md Step 5

The poll returned `status=completed`, `conclusion=success`. Break out of Step 4's loop. SKILL.md Step 5 handles refresh-body, ready-comment, squash-merge, label cleanup.

---

## Why no mirror branch / mirror PR?

The previous design (when release-gate handling lived inside `iterate-one-issue` Step 9) created `release/iterate-<…>` mirror branches + mirror PRs to satisfy `release-gate.yml`'s `if: startsWith(github.head_ref, 'release/')` filter, then closed them after validation. With `workflow_dispatch` accepting a `ref` input and the job filter relaxed to `startsWith(github.head_ref, 'release/') || github.event_name == 'workflow_dispatch'`, the mirror is no longer needed:

- No mirror branch — saves ~5 s + one collision risk.
- No mirror PR open/close — saves ~10 s + one PR-noise event per iteration.
- No fast-forward dance during forward-fix — fixes land directly on the iterate branch via `iterate-one-issue --resume-pr`.

---

## State the loop carries between iterations

Per-PR, all of these reset on Step 1's next pick:

- `BRANCH` — captured at Step 2.
- `PR_URL` — captured at Step 2.
- `HEAD_SHA` — captured at Step 2; refreshed from the `commit=` field of every `Done-ForwardFixed` outcome.
- `RG_RUN_ID` — assigned at every 4.1 dispatch.
- Attempt count is **not** stored locally — re-read from PR comments at every loop iteration so a parallel run cannot bypass the cap.
