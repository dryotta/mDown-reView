# Bug Categories (mdownreview-specific)

High-probability bug categories for the mdownreview stack: React 19 frontend + async file watcher + Tauri v2 IPC + comment anchoring. Use this as the primary checklist when bug-hunting; each category lists the file/line areas to read first and the typical failure mode.

> **Scope:** project-specific. Generic React re-render and bundling pitfalls live in [`../best-practices-common/react/`](../best-practices-common/react/). Cross-cutting Tauri v2 footguns live in [`../best-practices-common/tauri/v2-patterns.md`](../best-practices-common/tauri/v2-patterns.md).

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

Hot files: `src/hooks/*.ts`, `src/components/viewers/MermaidView.tsx`, anything using `ResizeObserver` / `IntersectionObserver`.

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

Hot files: `src-tauri/src/commands/*.rs` paired with `src/lib/tauri-commands.ts`.

Failure modes:
- Rust command returns `Option<T>` → TypeScript wrapper expects `T`, null handling forgotten.
- Rust returns a tagged enum (`#[serde(tag = "kind")]`) → TypeScript only handles one variant; other variants render as raw JSON.
- Field renamed in Rust struct, TypeScript wrapper not updated → silent runtime undefined.

### `category: tauri-lifecycle` -- v2 lifecycle pitfalls

Hot files: `src-tauri/src/lib.rs`, `src/App.tsx`, `src/store/index.ts` (updater + watcher init).

Failure modes:
- `plugin-updater` check fires during active review — does it interrupt the user?
- File dialog closing without selection — is `null`/`undefined` handled?
- App closing with unsaved comments — is there a beforeunload guard / save-on-blur?
- `tauri-plugin-single-instance`: second-launch CLI args route through the same handler as initial-launch args (avoid two code paths).

## How to read for bugs

1. Read every file in `src/hooks/` — focus on `useEffect` cleanup and error paths.
2. Read `src-tauri/src/core/anchors.rs` and `src-tauri/src/core/matching.rs` fully.
3. Read every `src-tauri/src/commands/*.rs` — check `Result<>` error variants and how each is surfaced in `tauri-commands.ts`.
4. Grep for `listen(` across `src/` and verify each call has cleanup.
