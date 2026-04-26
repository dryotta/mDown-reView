# mdownreview Best Practices (Project-Specific)

Knowledge files specific to **mdownreview**: hot-path maps, bug categories, test patterns. These complement (do not replace) the project deep-dives in `docs/principles.md`, `architecture.md`, `performance.md`, `security.md`, `design-patterns.md`, `test-strategy.md`.

> Cross-cutting, project-agnostic patterns (React, Tauri v2, JS performance, Vite) live in [`../best-practices-common/`](../best-practices-common/). When project-specific knowledge here conflicts with the cross-cutting guidance there, the project-specific file wins.

## Layout

| File | Owns | Consumed by |
|---|---|---|
| [`test-patterns.md`](test-patterns.md) | IPC mock skeleton, watcher-event simulation, save-call tracking, native fixture wiring, canonical DOM selectors, time/debounce patterns, reliability anti-patterns | `exe-task-implementer` (when writing tests), `test-expert` (when reviewing) |
| [`bug-categories.md`](bug-categories.md) | High-probability bug categories for this stack: race conditions, async error handling, subscription leaks, comment-anchoring edge cases, IPC type mismatches, Tauri-specific pitfalls | `bug-expert` |
| [`hot-paths.md`](hot-paths.md) | Performance-sensitive areas: which components, hooks, and Rust modules are on the hot path; what each one is sensitive to | `performance-expert` |

## Citation format

Within agent reports: `violates rule <rule-id> in docs/best-practices-project/<file>.md`. If a knowledge file lists categories rather than numbered rules (e.g. `bug-categories.md`), cite by category heading: `category: race-conditions in docs/best-practices-project/bug-categories.md`.

## Per-knowledge-file review pattern

Review agents that consult these files MUST follow the per-knowledge-file dispatch pattern embedded in each `*-expert` agent: one subagent per knowledge file, parent aggregates. This applies to both `best-practices-project/` and `best-practices-common/` files.
