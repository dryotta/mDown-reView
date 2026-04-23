---
name: start-feature
description: Use at the start of any new task. Creates a feature branch from a clean main, so all work goes through a PR rather than directly to main.
---

# Start Feature Skill

Use this before any development task to ensure work happens on a branch.

## Steps

1. **Check current branch:**
   ```bash
   git branch --show-current
   ```
   If already on a non-main branch, **ask the user** whether to:
   - Continue working on the current branch
   - Start a new branch from main

   If the user chooses to continue, skip to step 6.

2. **Check working tree is clean:**
   ```bash
   git status --porcelain
   ```
   If dirty, stop and tell the user to commit or stash first.

3. **Switch to main and pull latest:**
   ```bash
   git checkout main && git pull
   ```

4. **Ask the user** (if not already provided): "What is this branch for?" — get a 3-5 word slug.

5. **Create and switch to branch:**
   ```bash
   git checkout -b <type>/<slug>
   ```
   Where `<type>` is `feature`, `fix`, or `chore` based on the task.

6. **Confirm** by printing:
   ```
   Ready on branch: <branch-name>
   When done: git push -u origin HEAD && gh pr create
   ```

Now proceed with the task.
