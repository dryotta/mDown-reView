---
name: perf-trend
description: Use when the user asks about benchmark trends, says "perf trend", "/perf-trend", "show bench history", "check if perf is regressing", or "compare benches across commits". Reads the `bench-output` artifact from recent successful `ci.yml` runs on `main`, parses criterion bencher output, and renders a markdown report with per-bench history, budget status, and regression callouts.
---

# perf-trend

Generates a markdown trend report from the perf-bench artifacts produced by the
`bench` job in `ci.yml`. Bench artifacts retain for 14 days, so the report's
natural window is `--days 14`.

## When to invoke

- User says "perf trend", "show bench history", "are we regressing on perf",
  "check the last week's benches", or runs `/perf-trend`.
- After a suspected hot-path change has landed on `main` and the user wants to
  see whether the next `bench` run measured a delta.
- As a pre-release check before tagging — surfaces any silently-failing
  bench harness (a panic in one harness short-circuits `cargo bench` and
  drops the rest of the suite from the artifact).

## How

One command, no flags needed for the default 14-day window on `main`:

```bash
npm run perf:trend
```

Or with overrides:

```bash
node scripts/perf-trend.mjs --days 7 --runs 20
node scripts/perf-trend.mjs --branch canary-build/canary-194
node scripts/perf-trend.mjs --summary   # writes to $GITHUB_STEP_SUMMARY
```

Flags:

| Flag | Default | Meaning |
|---|---|---|
| `--days N` | 14 | Cutoff in days; older runs are filtered out. Cap is effectively the artifact retention (14 days). |
| `--runs M` | 30 | Max number of `gh run list` rows to consider before the day filter. Bump for sparse branches. |
| `--workflow F` | `ci.yml` | Workflow file name. |
| `--branch B` | `main` | Branch filter for `gh run list`. |
| `--summary` | off | Append the report to `$GITHUB_STEP_SUMMARY` instead of stdout. |

Requires `gh` authenticated against the current repo. Reads
`.github/workflows/ci.yml` for the canonical budget table (the script parses
the `declare -A BUDGETS` block, so updates to the workflow's budgets flow
through automatically).

## Report sections

The renderer emits four sections in order:

1. **⚠️ Missing budgeted benches** — present only if any bench named in the
   workflow's `BUDGETS` table is absent from every artifact in the window.
   This is the headline signal for a silently-failing harness. The CI summary
   step is silent about missing benches; this skill exists in large part to
   surface them.
2. **Summary** — one row per bench seen: latest measurement, budget,
   per-window median, % delta vs median, status (`✅` / `⚠️ over budget`),
   ASCII sparkline of all samples (left=oldest, right=newest).
3. **Movers** — benches whose latest sample is ≥10% off their window median
   (requires ≥3 samples to avoid noise). Split into Regressions and
   Improvements. Each row cites the commit SHA + PR title of the latest run.
4. **Per-bench history** — `<details>` block per bench with the full series
   of (date, commit, ns/iter, ± deviation, title) rows.

## Triage hints

When the report shows…

- **Missing budgeted benches** — download a recent `bench-output` artifact
  manually (`gh run download <id> --name bench-output`) and grep for `panicked
  at` / `error: bench failed`. Fix the failing bench harness; otherwise the
  missing benches' budgets are unenforced.
- **A bench newly over budget** — cross-reference the per-bench history
  table for the SHA where the value first crossed the budget. That commit is
  the prime suspect. Open a perf issue, link the report excerpt.
- **A bench oscillating ±5–10%** — usually runner noise (release-ci profile
  is lto=off so codegen variance is real). Don't file an issue unless the
  trend persists across ≥5 samples on the over-budget side.
- **The whole window is one commit** — the tree-hash skip on `push` to
  `main` (see `ci-gate-inputs.outputs.skip`) elides the bench job on
  byte-identical squash-merges. This is intentional; widen `--days` or
  re-run on a PR branch.

## Notes

- The script never writes to the repo or opens issues; it only reads. Acting
  on findings (filing issues, opening PRs) is for the user or a follow-on
  skill.
- Bench output capture in `ci.yml` is `2>&1 | tee bench-output.txt`, so the
  artifact also contains compiler warnings and any panic backtrace. The
  parser tolerates this noise.
- Bench IDs in the report are the raw criterion IDs (e.g.
  `hot_path/get_file_comments_large`), matching the keys in the workflow's
  `BUDGETS` table — not the human-readable names in `docs/performance.md`.
