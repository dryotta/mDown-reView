---
name: start-feature
description: Use at the start of any new task. Creates a feature branch from a clean main, so all work goes through a PR rather than directly to main.
---

# Start Feature Skill

Use this before any development task to ensure work happens on a branch.

## Steps

1. **Check working tree is clean:**
   ```bash
   git status --porcelain
   ```
   If dirty, stop and tell the user to commit or stash first.

2. **Switch to main and pull latest:**
   ```bash
   git checkout main && git pull
   ```

3. **Ask the user** (if not already provided): "What is this branch for?" — get a 3-5 word slug.

4. **Create and switch to branch:**
   ```bash
   git checkout -b <type>/<slug>
   ```
   Where `<type>` is `feature`, `fix`, or `chore` based on the task.

5. **Confirm** by printing:
   ```
   Ready on branch: <branch-name>
   When done: git push -u origin HEAD && gh pr create
   ```

Now proceed with the task.
