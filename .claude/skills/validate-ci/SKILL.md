---
name: validate-ci
description: Triggers CI and release-gate workflows by ensuring a release/* PR exists. Use to run the full test suite for a release candidate or big change.
---

# Validate CI Skill

Runs both CI and Release Gate workflows against the current work. Use this before a release or to validate a significant change across all platforms.

**How it works:** Both workflows trigger on PRs to `main`. Release Gate jobs additionally require the branch to start with `release/`. This skill ensures those conditions are met.

## Steps

1. **Detect current branch:**
   ```bash
   git branch --show-current
   ```

2. **Route based on branch:**

   ### If on a non-main branch

   a. **Check for uncommitted changes:**
      ```bash
      git status --porcelain
      ```
      If dirty, stop and tell the user to commit or stash first.

   b. **Check if a PR already exists:**
      ```bash
      gh pr view --json number,url,headRefName 2>&1
      ```

   c. **Handle branch naming for release gate:**
      - If the branch does NOT start with `release/`, **tell the user** that CI will trigger but Release Gate jobs require a `release/*` branch. Ask whether to:
        - Continue anyway (CI only)
        - Create a new `release/` branch from the current branch tip and open the PR from there instead
      - If the user chooses a new release branch:
        ```bash
        git checkout -b release/<original-slug>
        git push -u origin HEAD
        ```

   d. **Push and create PR if needed:**
      ```bash
      git push -u origin HEAD
      gh pr create --title "validate: <branch-name>" --body "Validation PR to trigger CI + Release Gate workflows." --draft
      ```
      Use `--draft` so it's clear this is a validation PR, not ready to merge.

   e. **Print status:**
      ```
      ✅ PR created/found: <url>
      ⏳ CI workflow: triggered (all PRs to main)
      ⏳ Release Gate: triggered (release/* branch)
      ```
      Include a link to the Actions tab:
      ```
      👉 https://github.com/dryotta/mdownreview/actions
      ```

   ### If on main

   a. **Check for uncommitted changes:**
      ```bash
      git status --porcelain
      ```
      If dirty, stop and tell the user to commit or stash first.

   b. **Pull latest:**
      ```bash
      git pull
      ```

   c. **Create a temporary release validation branch:**
      ```bash
      git checkout -b release/validate-<short-sha>
      ```
      Use the first 7 characters of HEAD's SHA as the slug.

   d. **Push an empty validation commit and create PR:**
      ```bash
      git commit --allow-empty -m "chore: trigger CI + release gate validation"
      git push -u origin HEAD
      gh pr create --title "validate: full CI + release gate" --body "Temporary validation PR to trigger all CI and Release Gate workflows against main. Close after workflows complete." --draft
      ```

   e. **Print status:**
      ```
      ✅ Validation PR created: <url>
      ⏳ CI workflow: triggered
      ⏳ Release Gate: triggered (release/* branch)

      👉 https://github.com/dryotta/mdownreview/actions

      ℹ️  Close and delete this branch after validation completes:
          gh pr close <number> --delete-branch
      ```

## Notes

- Release Gate jobs (`release-gate.yml`) only run when `github.head_ref` starts with `release/`.
- CI (`ci.yml`) runs on any PR to main but is path-filtered — it may skip if only docs changed.
- Draft PRs trigger workflows but signal the PR is not ready for merge.
