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
- **`sync.ts` exits non-zero (dirty tree outside the allow-list, merge conflict):** stop the loop immediately, write the failure into the digest, and exit with the original error. **Never** discard or auto-resolve changes. The allow-list covers `.claude/retrospectives/**.md` only — the inner skill's mandatory retrospective artefacts are stashed across the ff and restored automatically.
- **Pre-flight finds the workspace not on `main` (or not tracking `origin/main`):** stop with the digest entry `pre-flight: branch must be main tracking origin/main` and exit. **Do not** attempt to switch branches.

## Iteration cycle

For `i = 1 .. iterations`:

1. **Record baseline** — `git rev-parse origin/main` → baseline SHA. Save it.
2. **Per-iteration Vite health probe** (debug-build runs only) — Vite's TCP listener can crash silently while the hosting `vite` shell process keeps reporting `ready in <ms>` (issue #155). Before invoking the inner skill, HTTP-probe `localhost:1420` with a 3-second timeout:

   ```powershell
   try { (Invoke-WebRequest -Uri http://localhost:1420 -UseBasicParsing -TimeoutSec 3).StatusCode } catch { 'DOWN' }
   ```

   - If `200`: proceed to step 3.
   - If `DOWN` or any non-2xx: `Stop-Process -Id <vite-shell-pid> -Force` (look up the PID via the `vite` shellId in `list_powershell`), then `powershell mode: async, shellId: vite, command: npx vite`, wait ~3 s, re-probe. Refuse to invoke the inner skill until a probe returns 200.
   - This is the orchestrator's responsibility on every iteration; the inner skill's pre-flight is a defence-in-depth (it runs the same probe at i=0 of the *inner* run, which only fires once per iteration).
3. **Run one round** — invoke the **test-exploratory-e2e** skill in full:
   - Pre-flight (build, port 9222, Vite if debug binary).
   - Drive the REPL for the configured step budget (defaults to ~30–50 actions; respects the agent's own judgement).
   - Record findings with `group` tags (responsive-layout, modal-ux, accessibility, visual-polish, errors, misc).
   - `{"act":"file_issues","dryRun":false}` — files NEW groups, comments on REPRODUCED groups via the `<!-- explore-ux:group=<g> -->` marker.
   - `{"act":"stop"}` — emit the run report.
4. **Wait for main to advance**:
   ```powershell
   npx tsx .claude/skills/test-exploratory-loop/runner/wait-for-main.ts `
     --since <baseline-sha> --timeout <S> --poll 60
   ```
   Blocks until `origin/main` differs from baseline. Exit 0 = advanced, 2 = timeout, 1 = git error.
5. **Sync the workspace** (only if iteration < iterations):
   ```powershell
   npx tsx .claude/skills/test-exploratory-loop/runner/sync.ts
   ```
   Fetches origin, fast-forwards `main`. Refuses if the working tree is dirty outside the allow-list (only `.claude/retrospectives/**.md` is allowed; those are stashed across the ff and restored).
6. **Rebuild** (unless `--no-build`):
   ```powershell
   npm run tauri -- build --debug   # or `npm run tauri:build` for release
   ```
   Skip if the user is running Vite-served debug — the binary already follows source.
7. Brief progress report: `[loop i/N] new=X reproduced=Y filed=Z; advance=<old>..<new>`.

After the last iteration, write a session digest to `.claude/test-exploratory-loop/runs/<ISO-ts>/loop.md` summarising per-iteration counts, all baseline→advance SHA pairs, and links to filed/reproduced issues.

## Post-loop retrospective + self-improvement issue

After the final iteration's digest is written, run the unified retrospective contract: [`.claude/shared/retrospective.md`](../../shared/retrospective.md). Bindings:

- `SKILL_TAG=test-exploratory-loop`
- `RUN_TAG=loop-<ISO-ts>` (matches the loop digest folder)
- `OUTCOME=PASSED` if the loop completed all `--iterations`; `DEGRADED` if the early-stop heuristics in "Stopping early" fired; `BLOCKED` if pre-flight or `sync.ts` halted; `TIMED-OUT` if `wait-for-main` hit its 3-consecutive-timeout cap.
- `RETRO_FILE=".claude/retrospectives/test-exploratory-loop-$RUN_TAG.md"`. Mirror to `.claude/test-exploratory-loop/runs/<ISO-ts>/retrospective.md`.

Source material for the retro: the per-iteration `loop.md` digest (advance SHAs, new/reproduced/filed counts), each inner-skill `runs/<ISO-ts>/retrospective.md`, and the early-stop reason if any.

Improvement candidates here typically target **the orchestrator itself**:
- A wait-for-main poll cadence that hides backlog stalls.
- A rebuild step that misses a binary change.
- Persona seeds that reach saturation too early.
- Synchronisation gaps with the fix loop (e.g. issues filed but never picked up).

Run R1 then R2 per the shared spec. The created issue carries `iterate-improvement` + `self-improve:test-exploratory-loop` and feeds the next `/iterate-loop` run.

End with:
```
🔁 Self-improve: <NEW_ISSUE_URL> (<category>)   # or "reproduced #N", "NO_IMPROVEMENT_FOUND", "skipped"
```

## Pre-flight (once at i=0)

Same as `test-exploratory-e2e`:

1. OS is Windows.
2. Port 9222 is free.
3. `src-tauri/target/{debug,release}/mdownreview.exe` exists.
4. `gh auth status` is OK (filing on every iteration requires it).
5. Working tree is clean (`git status --porcelain` empty, ignoring the `.claude/retrospectives/**.md` allow-list) — `sync.ts` will refuse otherwise.
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
- `.claude/test-exploratory-loop/runs/<ISO-ts>/retrospective.md` — post-loop retro (mirrored to `.claude/retrospectives/`)
- `.claude/test-exploratory-e2e/runs/<ISO-ts>/` — one folder per iteration (inherited from the inner skill)

## Non-goals

- This skill never edits app source.
- This skill never opens PRs.
- This skill never closes GitHub issues — only the fix loop / human reviewer does that.
- This skill does not run on macOS yet (Windows-only, like its inner skill).
