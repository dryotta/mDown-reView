---
name: validate-ci
description: Use when verifying that CI runs on the current work or when the user asks to "trigger CI" / "validate before merging" / "force a re-run on the same SHA". Since [PR #376](https://github.com/dryotta/mdownreview/pull/376) merged release-gate.yml into the converged ci.yml, no `release/*` branch is required — CI runs on every PR to main.
---

The converged `ci.yml` (windows-x64 + windows-arm64 + macos-arm64 builds + tests + native-e2e + bundle integrity) runs on every PR to `main` automatically — no path filter at the workflow level, so docs-only PRs see the full check status (heavy jobs are correctly skipped via the `changes` job; the aggregate `CI gate` accepts skip-on-skip). canary/release reuse this same workflow via `workflow_call` with `sign=true`.

This skill exists for two scenarios:

1. **Branch has no PR yet** — push the branch and open a draft PR so CI fires.
2. **PR exists but CI didn't fire** (rare; e.g. workflow file was just edited, branch protection paused) — force a re-run by pushing an empty commit.

## Steps

1. `git branch --show-current`.
2. `git status --porcelain` — if dirty, stop and tell user to commit/stash.

### On a non-main branch

3. `gh pr view --json number,url,headRefName 2>&1` — capture URL if PR exists.
4. If no PR exists, push + create draft PR:
   ```bash
   git push -u origin HEAD
   gh pr create --title "validate: <branch>" --body "Validation PR — triggers CI." --draft
   ```
5. If PR exists but CI didn't fire (verify with `gh run list --workflow=CI --branch <branch> --limit 1`), force a re-run with an empty commit:
   ```bash
   git commit --allow-empty -m "chore: re-trigger CI"
   git push
   ```

### On main

3. `git pull`.
4. ```bash
   git checkout -b validate/ci-<short-sha>
   git commit --allow-empty -m "chore: trigger CI validation"
   git push -u origin HEAD
   gh pr create --title "validate: CI" --body "Temporary validation PR. Close after CI completes." --draft
   ```

## Output

```
✅ PR: <url>
⏳ CI: triggered
👉 https://github.com/dryotta/mdownreview/actions
ℹ  Close after validation: gh pr close <number> --delete-branch
```

## Notes

- **No `release/*` branch is required** — that constraint disappeared with `release-gate.yml`. The single `ci.yml` accepts every PR head-ref pattern.
- **CI does NOT run on workflow_dispatch** — there is no "manual trigger" button for ci.yml. The only way to make it run is a `pull_request` event (open / synchronize / reopen) or `push` to main. This skill exploits the `synchronize` event by pushing an empty commit when CI didn't fire on its own.
- **Branch protection check name:** `CI gate` (the aggregate gate inside ci.yml). All other CI jobs feed into it.
- **For canary/release validation**, push a tag (`v*.*.*`) instead — that fires `release.yml` which calls ci.yml with `sign=true` for the production-quality build path.
