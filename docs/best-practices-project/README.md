---
tags: [documentation]
---

# mdownreview Best Practices (Project-Specific)

Knowledge files specific to **mdownreview**: hot-path maps, bug categories, test patterns. These complement (do not replace) the project deep-dives in `docs/principles.md`, `architecture.md`, `performance.md`, `security.md`, `design-patterns.md`, `test-strategy.md`.

> Cross-cutting, project-agnostic patterns (React, Tauri v2, JS performance, Vite) are bundled with each review agent in `.claude/agents/<agent>/knowledge/`. When project-specific knowledge here conflicts with the cross-cutting guidance there, the project-specific file wins.

## Layout

| File | Owns | Tags |
|---|---|---|
| [`test-patterns.md`](test-patterns.md) | IPC mock skeleton, watcher-event simulation, save-call tracking, native fixture wiring, canonical DOM selectors, time/debounce patterns, reliability anti-patterns | `test`, `ipc`, `mocks` |
| [`bug-categories.md`](bug-categories.md) | High-probability bug categories for this stack: race conditions, async error handling, subscription leaks, comment-anchoring edge cases, IPC type mismatches, Tauri-specific pitfalls | `bug`, `react-hooks`, `ipc`, `lifecycle`, `security` |
| [`hot-paths.md`](hot-paths.md) | Performance-sensitive areas: which components, hooks, and Rust modules are on the hot path; what each one is sensitive to | `performance`, `hot-paths`, `react-rendering`, `ipc`, `security` |
| [`must-acknowledge-banner.md`](must-acknowledge-banner.md) | UX rule for banners that signal an unsafe product state — autosave paused, save failed, conflict pending: explicit ack required, no auto-dismissal, asymmetric button styling. The user-facing parallel of rule 33 in [`../architecture.md`](../architecture.md). Derived from #352 retrospective §4.3 | `ux-banners`, `react-composition`, `product`, `architecture` |
| [`markdown-surfaces.md`](markdown-surfaces.md) | Markdown rendering surfaces and the sanitisation contract each must obey | `markdown`, `security`, `react-rendering` |

## Tag-based discovery (how agents consume this directory)

Each file above declares `tags: [...]` in its YAML frontmatter. Each agent in `.claude/agents/<agent>/agent.md` declares `knowledge_tags: [...]` in *its* frontmatter. At review time the agent:

1. If this directory is absent in the host repo: skip silently.
2. Otherwise scan every `*.md` here.
3. Load any file whose `tags` overlap the agent's `knowledge_tags` (set intersection non-empty).
4. Cite rules in loaded files as `<rule-id> in docs/best-practices-project/<file>.md` (or, for category-keyed files, `category: <slug> in docs/best-practices-project/<file>.md`).

This is the sole wiring point between agents and project-specific knowledge — the agent definitions never reference these files by hard-coded path.

The canonical tag inventory lives in [`.claude/agents/README.md`](../../.claude/agents/README.md). When introducing a new tag, update the inventory there and assign it to (a) the relevant project file's `tags:` frontmatter and (b) any agent's `knowledge_tags` that should now match.

## Citation format

Within agent reports: `violates rule <rule-id> in docs/best-practices-project/<file>.md`. If a knowledge file lists categories rather than numbered rules (e.g. `bug-categories.md`), cite by category heading: `category: race-conditions in docs/best-practices-project/bug-categories.md`.

## Per-knowledge-file review pattern

Review agents that consult these files MUST follow the per-knowledge-file dispatch pattern embedded in each `*-expert` agent: one subagent per knowledge file, parent aggregates. This applies to both `best-practices-project/` and the agent's bundled `knowledge/` folder.
