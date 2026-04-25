# Multi-File Review Protocol

Shared protocol for **review-style agents** (architect, performance, security, react-tauri, lean, ux, test, bug-hunter, documentation, product-improvement). Implementation, validation, and writer agents do NOT follow this protocol — they own a single contiguous task and benefit from full context.

## Why this exists

When a single agent reviews many files in one context window:

1. **Context contamination** — findings from file A bias the lens used on file B. A reviewer who has just flagged 5 issues in `MarkdownViewer.tsx` is statistically more likely to over-report on `SourceView.tsx` (priming) or under-report (fatigue).
2. **Token pressure** — large diffs force truncation; truncated reads miss real issues.
3. **Loss of focus** — the deeper into a long review, the more findings degrade in specificity.

Dispatching one subagent per file (or per coherent group) keeps every read fresh and short.

## When to dispatch subagents

| Signal | Action |
|---|---|
| Diff/scope contains **1–2 files** | Review directly (no subagents). |
| Diff/scope contains **3–5 files** of the **same kind** (e.g. all hooks) | Review directly; the kind-uniformity dampens the contamination risk. |
| Diff/scope contains **3+ files spanning ≥ 2 distinct concerns** (e.g. a hook + a Rust command + a viewer) | **Dispatch one subagent per file.** Aggregate findings yourself. |
| Diff/scope contains **6+ files of any kind** | **Dispatch subagents per file or per logical group of ≤ 3 closely-related files.** |
| The task is "review the whole codebase against `<rule>`" | Dispatch subagents grouped by area (e.g. one for `src/components/viewers/`, one for `src/hooks/`, one for `src-tauri/src/commands/`). |

## How to dispatch

For each file or group:

1. Use the `task` tool with the appropriate sub-agent type (typically `explore` for read-only review work; `general-purpose` only when the subagent needs to write or run commands).
2. **Give the subagent the SAME rule citations and output format you would use yourself.** Quote the relevant section of the docs the rule lives in (or pass the doc path) so the subagent can cite the rule by number without re-reading the whole doc.
3. Constrain scope: "Review ONLY `<file>` against `<rule N in docs/X.md>`. Do not read or comment on any other file."
4. Request the subagent's output in the **same structured format** your own report uses — that lets you concatenate findings without re-formatting.

## Aggregation

After all subagents return:

1. **Deduplicate** — the same root cause can surface in multiple files (e.g. a missing typed wrapper in `tauri-commands.ts` shows up as a finding against every consumer). Collapse to a single finding citing the root location plus the affected sites.
2. **Re-prioritise across files** — a Critical finding in one file outranks a wave of Medium findings in another. Apply your normal severity ordering across the merged list.
3. **Cite cross-file relationships you observe** — subagents can't see between files, so dependencies (e.g. "the bug in `useFileWatcher.ts` is what causes the orphan state seen by the subagent reviewing `SourceView.tsx`") are YOUR responsibility to surface.
4. **Honest scope note** — if you delegated, say so in the final report: "Reviewed via 7 parallel subagents, one per modified file." This lets the human reviewer audit the dispatch decision.

## What NOT to do

- Do not dispatch subagents for files outside the diff/scope just to "be thorough" — that re-introduces the context-contamination problem at the dispatcher level.
- Do not pass project-wide context (the entire `docs/` tree, the full file list) to a per-file subagent. Pass only what's needed to evaluate that one file against the rule.
- Do not let subagents call further subagents (recursive dispatch). Reviews stay one level deep.
- Do not skip the aggregation step — a list of seven raw subagent dumps is not a review.
