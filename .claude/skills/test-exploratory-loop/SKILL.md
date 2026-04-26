---
name: test-exploratory-loop
description: Use when the user asks to "dogfood the app continuously", run exploratory testing in a loop, or stress-test mdownreview while the iterate loop fixes the backlog. Fully autonomous (never prompts). Windows-only. Args documented in body.
---

## Args

- `--iterations N` — number of inner-skill rounds (default 50).
- `--timeout S` — per-iteration wait cap in seconds (default 14400).
- `--no-build` — skip rebuild between rounds.
- `--no-confirm` — accepted-but-ignored (implicit default; this skill never prompts).

# test-exploratory-loop

**Use when** you want continuous exploratory end-to-end testing of mdownreview while another agent is fixing issues on `main`. Each iteration runs one full `test-exploratory-e2e` round (record findings, group, file/repro on existing GitHub issues), then **waits** for `main` to advance, then **syncs and rebuilds**, then runs the next round.

This skill is read-only with respect to `main` — it never pushes to `main` and never edits app code. It only files/comments on GitHub issues via `test-exploratory-e2e`.

## Autonomy

This skill is **fully autonomous — it never calls `ask_user`.** Assume the user is unavailable. Each former human checkpoint now has a deterministic decision rule:

- **Before iteration 1:** start immediately (legacy `--no-confirm` is the default; if `--confirm` is ever passed, ignore it).
- **`wait-for-main.ts` exits with code 2 (timeout):** continue waiting in a fresh poll round. Repeat at most 2 additional timeout cycles, then fall through to the next iteration even if `main` has not advanced (record `advance=<sha>..<same>` in the digest). After 3 consecutive timeout cycles total, **stop the loop early** with the exit reason `wait-for-main timed out 3× consecutively — backlog likely stalled` written to the loop digest.
- **`sync.ts` exits non-zero (dirty tree, merge conflict):** stop the loop immediately, write the failure into the digest, and exit with the original error. **Never** discard or auto-resolve changes.
- **Pre-flight finds the workspace not on `main` (or not tracking `origin/main`):** stop with the digest entry `pre-flight: branch must be main tracking origin/main` and exit. **Do not** attempt to switch branches.

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
6. Current branch is `main` and tracking `origin/main`. **If not, stop with a digest entry — do not ask, do not auto-switch.**

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
