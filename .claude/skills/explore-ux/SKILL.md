---
name: explore-ux
description: Headed Playwright exploration of the live mdownreview app. Drives major flows over CDP, captures screenshot/DOM/a11y/console/IPC evidence, runs heuristic + vision triage, and files deduplicated GitHub issues. Windows-only v1. Args - empty (full catalogue), `--seed <flow-id>` (PR-scoped), `--steps N`, `--no-vision`, `--file` (default dry-run), `--auto`, `--no-confirm`. Spec at docs/specs/skill-explore-ux.md.
---

# explore-ux

**Use when** you want to surface UX issues and functional drift the scripted `e2e/native/` suite misses, especially before merging a PR or after a self-improve cycle. Read-only — never edits app code.

## Pre-flight

1. Confirm OS is Windows.
2. Check port 9222 is free.
3. Confirm a build artefact exists at `src-tauri/target/{debug,release}/mdownreview.exe`.
4. If `--file` is set, confirm `gh auth status` is OK.
5. Ask the user "OK to drive your app for ~N steps?" unless `--no-confirm`.

## Run

```powershell
npm run explore-ux -- [--seed <flow-id>] [--steps N] [--no-vision] [--file] [--auto] [--no-confirm]
```

Defaults: steps=50, vision ON, dry-run (no issues filed).

Outputs:
- `.claude/explore-ux/runs/<ISO-ts>/report.md` — human digest
- `.claude/explore-ux/runs/<ISO-ts>/evidence.jsonl` — per-step bundles
- `.claude/explore-ux/runs/<ISO-ts>/screenshots/` — PNG per step
- `.claude/explore-ux/known-findings.json` — dedupe store

## Optional: vision triage (default on)

After the runner exits, this skill optionally invokes a vision sub-agent (see `prompts/triage.md`) on each evidence bundle's screenshot. Vision findings are merged into the dedupe store using the same `(heuristic-id, screen-id, anchor)` key. Skip with `--no-vision`.

## Phase 6 — file issues

If `--file`:
1. Read latest run's `evidence.jsonl`.
2. For each NEW finding, call `fileIssue(...)` with `dryRun: false` (uses `gh issue create`).
3. For each REPRODUCED finding with an existing open issue, append `gh issue comment "Reproduced in run <id>"`.
4. Update `known-findings.json` with the new issue numbers.

Ask "File these N issues?" unless `--auto`.

## Heuristic catalogue

See `heuristics/{nielsen,wcag-aa,mdownreview-specific,anti-patterns}.md`. Every issue body cites a numbered rule ID — same posture as `AGENTS.md` review rules.

## Non-goals

See `docs/specs/skill-explore-ux.md` §3.
