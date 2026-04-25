# Best Practices

Cross-cutting, **project-agnostic** patterns and rules. Organized by tech stack so each subdirectory can be lifted into another project unchanged.

This directory complements the project-specific docs:

- [`docs/principles.md`](../principles.md), [`docs/architecture.md`](../architecture.md), [`docs/design-patterns.md`](../design-patterns.md), [`docs/performance.md`](../performance.md), [`docs/security.md`](../security.md), [`docs/test-strategy.md`](../test-strategy.md) — **mdownreview-specific** rules. They cite best-practices files where a rule is generic.

## Layout

| Path | Scope | Applies to |
|---|---|---|
| [`general/`](general/) | Language/runtime-agnostic | Any JS/TS project |
| [`react/`](react/) | React-specific | Any React 18+/19 codebase |
| [`vite/`](vite/) | Vite/Rollup bundler-specific | Any Vite project |
| [`tauri/`](tauri/) | Tauri v2 desktop-shell-specific | Any Tauri v2 project |

## Files

### `general/`
- [`javascript-performance.md`](general/javascript-performance.md) — JS hot-path patterns (Set/Map lookups, hoist regex, early-exit, cache reads).

### `react/`
- [`composition-patterns.md`](react/composition-patterns.md) — avoid boolean prop proliferation, compound components, lift state, decouple state implementation.
- [`rerender-optimization.md`](react/rerender-optimization.md) — selector hygiene, derived state without effects, functional setState, transient refs.
- [`rendering-performance.md`](react/rendering-performance.md) — `content-visibility`, hoisting JSX, conditional render shape, hydration hygiene.
- [`react19-apis.md`](react/react19-apis.md) — `use()`, `useTransition`, `useDeferredValue`, ref-as-prop, `useOptimistic`.

### `vite/`
- [`bundle-hygiene.md`](vite/bundle-hygiene.md) — barrel imports, statically analyzable paths, third-party deferral, link preload.

### `tauri/`
- [`v2-patterns.md`](tauri/v2-patterns.md) — IPC chokepoint, typed commands with tagged errors, window-scoped events, listener cleanup, capability least-privilege, plugin pinning, multi-window awareness.

## How to consume

1. **Cite a rule** as `violates rule <rule-id> in docs/best-practices/<path>.md` (e.g., `violates rule rerender-defer-reads in docs/best-practices/react/rerender-optimization.md`).
2. **Each rule has a stable ID** in kebab-case with a category prefix (`architecture-`, `rerender-`, `js-`, `bundle-`, …). IDs are preserved verbatim from upstream sources for portability.
3. **Project-specific docs override.** If a project-specific doc (e.g. `docs/performance.md`) sets a stricter or different rule, that wins.
4. **No duplication.** Project-specific docs reference best-practices rules; they do not copy them.

## Attribution

Most rules in this directory are reproduced verbatim from [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) (MIT-licensed, © Vercel), specifically the `react-best-practices` and `composition-patterns` skills. Rule IDs, headings, code examples, and prose are preserved as-is so they can be tracked against upstream. See [`LICENSE-vercel-skills.md`](LICENSE-vercel-skills.md) for the attribution notice and list of modifications. Rules tied to stacks not used here (Next.js, RSC, server actions) are intentionally omitted.

Other rules originate from this codebase's review experience and accumulated practice.

## Modifications when distilling

See [`LICENSE-vercel-skills.md`](LICENSE-vercel-skills.md) for the full list. Summary: per-topic file split, rule-ID-anchored headings, omission of Next.js-specific rules, consolidation of React 19 rules. No code examples or rule prose were modified.

## Maintenance

- **Adding a rule:** keep the upstream ID if distilled from an external source; otherwise pick a new `<category>-<short-name>` ID. One paragraph + one bad/good code snippet maximum per rule.
- **Removing a rule:** rules are removed only when the underlying API or pattern is deprecated. Replacement rules cross-link from the removed rule's anchor so old citations still resolve.
- **Tech-stack additions:** add a new top-level subdirectory (e.g., `tauri/`, `rust/`) only when ≥ 3 rules of that scope exist. Otherwise group under the closest existing category.
