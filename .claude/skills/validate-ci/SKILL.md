---
name: validate-ci
description: Use when verifying that CI and the Release Gate workflow run on the current work, when a `release/*` branch is missing for a change being prepped for release, or when the user asks to "trigger CI" / "run the release gate" / "validate before merging".
---

CI runs on any PR to `main`; Release Gate also requires `release/*` head ref. This skill creates whatever's needed to trigger both.

## Steps

1. `git branch --show-current`.
2. `git status --porcelain` — if dirty, stop and tell user to commit/stash.

### On a non-main branch

3. `gh pr view --json number,url,headRefName 2>&1` — capture URL if PR exists.
4. If branch doesn't start with `release/`, create one (do not prompt — autonomous default):
   ```bash
   git checkout -b release/<original-slug>
   git push -u origin HEAD
   ```
5. Push + create draft PR if not already open:
   ```bash
   git push -u origin HEAD
   gh pr create --title "validate: <branch>" --body "Validation PR — triggers CI + Release Gate." --draft
   ```

### On main

3. `git pull`.
4. ```bash
   git checkout -b release/validate-<short-sha>
   git commit --allow-empty -m "chore: trigger CI + release gate validation"
   git push -u origin HEAD
   gh pr create --title "validate: full CI + release gate" --body "Temporary validation PR. Close after workflows complete." --draft
   ```

## Output

```
✅ PR: <url>
⏳ CI: triggered
⏳ Release Gate: triggered (release/* branch)
👉 https://github.com/dryotta/mdownreview/actions
ℹ  Close after validation: gh pr close <number> --delete-branch
```

Notes: Release Gate only runs when `github.head_ref` starts with `release/`. CI is path-filtered — may skip on docs-only diffs.
