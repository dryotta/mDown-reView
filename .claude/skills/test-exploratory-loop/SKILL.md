---
name: test-exploratory-loop
description: Long-running orchestrator that runs the test-exploratory-e2e skill in a loop (default 50 iterations). Between iterations it blocks until `origin/main` advances, then fast-forwards local main and rebuilds before the next round. Designed to dogfood the app continuously while another agentic loop fixes the backlog. Windows-only v1. Args - `--iterations N` (default 50), `--timeout S` (per-iteration wait cap in seconds, default 14400), `--no-build` (skip rebuild between rounds), `--no-confirm`.
---

# test-exploratory-loop

**Use when** you want continuous exploratory end-to-end testing of mdownreview while another agent is fixing issues on `main`. Each iteration runs one full `test-exploratory-e2e` round (record findings, group, file/repro on existing GitHub issues), then **waits** for `main` to advance, then **syncs and rebuilds**, then runs the next round.

This skill is read-only with respect to `main` — it never pushes to `main` and never edits app code. It only files/comments on GitHub issues via `test-exploratory-e2e`.

## When to STOP and ask

Use `ask_user` only at these points:

- **Before iteration 1** unless `--no-confirm`: confirm "OK to run up to N iterations? Each iteration takes ~5–15 min plus wait time."
- If `wait-for-main.ts` exits with code 2 (timeout): ask "Wait timed out after S seconds. Continue waiting / stop / run another iteration without an upstream change?"
- If `sync.ts` exits non-zero (dirty tree, merge conflict): stop and report; **do not** discard changes.

## Iteration cycle

For `i = 1 .. iterations`:

1. **Record baseline** — `git rev-parse origin/main` → baseline SHA. Save it.
2. **Run one round** — invoke the **test-exploratory-e2e** skill in full:
   - Pre-flight (build, port 9222, Vite if debug binary).
   - Drive the REPL for the configured step budget (defaults to ~30–50 actions; respects the agent's own judgement).
   - Record findings with `group` tags (responsive-layout, modal-ux, accessibility, visual-polish, errors, misc).
   - `{"act":"file_issues","dryRun":false}` — files NEW groups, comments on REPRODUCED groups via the `<!-- explore-ux:group=<g> -->` marker.
   - `{"act":"stop"}` — emit the run report.
3. **Wait for main to advance**:
   ```powershell
   npx tsx .claude/skills/test-exploratory-loop/runner/wait-for-main.ts `
     --since <baseline-sha> --timeout <S> --poll 60
   ```
   Blocks until `origin/main` differs from baseline. Exit 0 = advanced, 2 = timeout, 1 = git error.
4. **Sync the workspace** (only if iteration < iterations):
   ```powershell
   npx tsx .claude/skills/test-exploratory-loop/runner/sync.ts
   ```
   Fetches origin, fast-forwards `main`. Refuses dirty tree.
5. **Rebuild** (unless `--no-build`):
   ```powershell
   npm run tauri:build:debug   # or npm run tauri:build for release
   ```
   Skip if the user is running Vite-served debug — the binary already follows source.
6. Brief progress report: `[loop i/N] new=X reproduced=Y filed=Z; advance=<old>..<new>`.

After the last iteration, write a session digest to `.claude/test-exploratory-loop/runs/<ISO-ts>/loop.md` summarising per-iteration counts, all baseline→advance SHA pairs, and links to filed/reproduced issues.

## Pre-flight (once at i=0)

Same as `test-exploratory-e2e`:

1. OS is Windows.
2. Port 9222 is free.
3. `src-tauri/target/{debug,release}/mdownreview.exe` exists.
4. `gh auth status` is OK (filing on every iteration requires it).
5. Working tree is clean (`git status --porcelain` empty) — `sync.ts` will refuse otherwise.
6. Current branch is `main` and tracking `origin/main`. If not, ask before continuing.

## Handoff with the issue-fixing loop

The whole point: another agent (typically the `iterate` skill on a different branch/worktree) consumes the GitHub backlog and lands fixes on `main`. This loop:

- Files new findings → that agent picks them up.
- Comments "Reproduced in run X" on issues still open → signals the fix landed but didn't fully resolve the bug.
- Stops surfacing a finding once its issue is closed (because closing removes it from `gh issue list --state open --label explore-ux`, so the dedupe lookup no longer matches → next time the underlying bug recurs it files a NEW issue with full evidence).

## Stopping early

The agent should stop and surface to the user if:

- Three iterations in a row produce **zero new findings AND zero new reproductions**. The exploration may be saturated — better to broaden seeds or stop.
- The same group keeps reproducing across 5+ iterations with no comment thread movement on the issue. The fix loop may be stalled.
- A new finding has severity P1 with `MDR-CONSOLE-ERROR` or `MDR-IPC-RAW-JSON-ERROR` and a stack trace that smells like a regression introduced by the fix loop. **Stop and surface immediately.**

## Outputs

- `.claude/test-exploratory-loop/runs/<ISO-ts>/loop.md` — orchestrator digest
- `.claude/test-exploratory-e2e/runs/<ISO-ts>/` — one folder per iteration (inherited from the inner skill)

## Non-goals

- This skill never edits app source.
- This skill never opens PRs.
- This skill never closes GitHub issues — only the fix loop / human reviewer does that.
- This skill does not run on macOS yet (Windows-only, like its inner skill).
