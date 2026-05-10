---
tags: [bug, react-hooks, ipc, lifecycle, security]
---

# Bug Categories (mdownreview-specific)

High-probability bug categories for the mdownreview stack: React 19 frontend + async file watcher + Tauri v2 IPC + comment anchoring. Use this as the primary checklist when bug-hunting; each category lists the file/line areas to read first and the typical failure mode.

> **Scope:** project-specific. Generic React re-render and bundling patterns are bundled with each review agent (`react-coding-expert`, `lean-expert`, `performance-expert`); cross-cutting Tauri v2 footguns are bundled with `tauri-coding-expert` and `tauri-architect-expert`.

## How to apply this file

Every confirmed bug needs:
- File:line evidence.
- A concrete reproduction scenario (not "might happen").
- A failing test (or test outline) — the test is part of the bug report (rule 9 in [`../test-strategy.md`](../test-strategy.md)).

For citations: `category: <slug> in docs/best-practices-project/bug-categories.md`.

## Categories

### `category: race-conditions` -- async + React state

Hot files: `src/hooks/useFileWatcher.ts`, `src/hooks/useFileContent.ts`, `src/components/comments/CommentInput.tsx`, `src/hooks/useSearch.ts`.

Failure modes:
- File watcher fires → frontend updates state → component unmounts mid-update.
- Multiple rapid file changes causing out-of-order state updates.
- Comment save races with file reload (does re-render clobber unsaved comment text?).
- Search debounce + file-change event arriving simultaneously.

### `category: async-error-handling` -- silent failure

Hot files: every consumer of `src/lib/tauri-commands.ts`, every `useEffect` that calls `listen()`.

Failure modes:
- `invoke()` calls without `.catch()` or try/catch — silently fail; user sees stale UI.
- Tauri event listeners that throw — does the error propagate or get swallowed?
- File read errors (permission denied, file deleted) — are they surfaced to the user, or only logged?

### `category: subscription-leaks` -- memory and listener leaks

Hot files: `src/hooks/*.ts`, `src/components/viewers/mermaid/MermaidRenderer.tsx`, `src/components/viewers/mermaid/MermaidCanvas.tsx`, anything using `ResizeObserver` / `IntersectionObserver`.

Failure modes:
- `listen()` subscriptions in `useEffect` without `unlisten()` in cleanup.
- Mermaid diagrams — does the renderer clean up its DOM nodes / themes on unmount?
- Resize / intersection observers without cleanup.
- Event listeners attached to `window` / `document` not removed on unmount.

### `category: anchoring-edge-cases` -- comment re-anchoring

Hot files: `src-tauri/src/core/anchors.rs`, `src-tauri/src/core/matching.rs`, the legacy `src/lib/comment-anchors.ts` and `src/lib/comment-matching.ts`.

Failure modes:
- Lines added/removed at the top of file → anchor offsets shift; does fuzzy match still find the line?
- File completely replaced (agent rewrites the whole file) → all anchors become orphans; orphan UI must surface them.
- Empty file, file with only whitespace, file with Windows line endings (CRLF) — every code path must handle these.
- Unicode / multi-byte characters in the anchor span — does hash computation match between TS and Rust?

### `category: ipc-type-mismatch` -- Rust ↔ TypeScript drift

Hot files: `src-tauri/src/commands/*.rs` paired with the auto-generated `src/lib/bindings.ts` and the façade `src/lib/tauri-commands.ts`.

Failure modes:
- Rust command returns `Option<T>` → caller forgets the `null` branch when consuming the generated wrapper. (Compile-only catch: TS will type the field as `T | null`; runtime catch: tests that exercise both arms.)
- Rust adds a variant to a `#[serde(tag = "kind")]` tagged enum → TS callers with a non-exhaustive `switch` silently render the new variant as raw JSON. Mitigation: `assertNeverAnchorKind` (`src/lib/anchor-derive.ts`) — every Anchor-shape switch lands in `default` → `assertNever(_: never)` so a new wire variant fails type-check until consumers add a branch.
- ~~Field renamed in Rust struct, TypeScript wrapper not updated → silent runtime undefined.~~ (Now a CI failure, not a runtime failure.) Field-rename and command-shape drift are mechanically blocked by the `bindings-drift` CI job (`.github/workflows/ci.yml`) which runs `cargo test --features codegen --test specta_codegen` and then `git diff --exit-code src/lib/bindings.ts`. Any divergence between the Rust IPC surface and the committed `bindings.ts` fails the PR before review.

### `category: tauri-lifecycle` -- v2 lifecycle pitfalls

Hot files: `src-tauri/src/lib.rs`, `src/App.tsx`, `src/store/index.ts` (updater + watcher init).

Failure modes:
- `plugin-updater` check fires during active review — does it interrupt the user?
- File dialog closing without selection — is `null`/`undefined` handled?
- App closing with unsaved comments — is there a beforeunload guard / save-on-blur?
- `tauri-plugin-single-instance`: second-launch CLI args route through the same handler as initial-launch args (avoid two code paths).

### `category: csp-inline-style-leak` -- index.html nonce trigger

Hot files: `index.html`, `src-tauri/tauri.conf.json`.

Failure modes:
- A new inline `<style>` element (or a tooling change that re-introduces one) in `index.html` or any other shipped HTML triggers Tauri's `inject_nonce_token` codegen pass, which appends a runtime nonce to `style-src` and (per CSP3) ignores `'unsafe-inline'` — silently breaking Shiki, KaTeX, Mermaid, and React inline-style outputs in production. Canonical: rule 17a in [`../security.md`](../security.md).
- Lifting a hard-coded background color from `index.html` into `src/styles/app.css` should preserve the FOUC contract (`html, body { background-color: var(--color-bg) }` per `[data-theme]`); regressing this to a non-`var` color or removing the rule entirely re-creates issue #265's first-paint flash. Canonical: rule 17a in [`../security.md`](../security.md).

## How to read for bugs

1. Read every file in `src/hooks/` — focus on `useEffect` cleanup and error paths.
2. Read `src-tauri/src/core/anchors.rs` and `src-tauri/src/core/matching.rs` fully.
3. Read every `src-tauri/src/commands/*.rs` — check `Result<>` error variants and how each is surfaced through the auto-generated `src/lib/bindings.ts` and consumed by callers (the façade in `src/lib/tauri-commands.ts` unwraps `Result<T, E>` to `Promise<T>` so error variants surface as thrown values).
4. Grep for `listen(` across `src/` and verify each call has cleanup.
