# Design Patterns & Idioms — rules for mdownreview

**Status:** Canonical. Cite violations as "violates rule N in `docs/design-patterns.md`".
**Charter:** [`docs/principles.md`](principles.md)
**Last updated:** 2026-04-23

> **Stack note:** `package.json` pins **React 19.1**. Any remaining doc references to React 18 are stale and will be corrected as encountered.

## Principles

1. **Single entry per subsystem.** Every cross-layer concern (Tauri IPC, logging, persistence) has exactly one module that every other file depends on.
   **Pillars:** Architecturally Sound, Reliable, Lean.
   **Rationale:** A single chokepoint eliminates divergent call sites, makes mocking trivial, and is grep-able in review.

2. **Hooks are wires, not state owners.** Hooks subscribe to external state (DOM events, Tauri events, the Zustand store) and mirror it; durable state lives in Zustand or in Rust.
   **Pillars:** Architecturally Sound, Reliable.
   **Rationale:** Keeps effects cancellable and idempotent; eliminates double-source-of-truth bugs when a tab reopens or the watcher replays.

3. **Deterministic keys from source positions.** Every per-block React key, `data-*` attribute, or anchor is derived from `node.position.start.line` or an equivalent stable identifier, never from array index or render order.
   **Pillars:** Reliable, Architecturally Sound.
   **Rationale:** Prevents React error #185 in concurrent mode and keeps comment anchors stable across re-renders.

4. **Persist UI, not content.** The Zustand `persist` middleware stores only UI/workspace state; every byte of user-authored content lives in Rust-owned sidecar files.
   **Pillars:** Reliable, Lean.
   **Rationale:** A corrupt or stale localStorage can never damage comments; sidecars are portable and tool-interoperable (MRSF spec).

5. **Errors are captured before the first render.** Global error handlers are installed at module scope in `main.tsx` before `ReactDOM.createRoot()` so module-load and first-render failures are logged.
   **Pillars:** Reliable, Professional.
   **Rationale:** Most user-facing crashes happen during bootstrap; installing handlers in a `useEffect` would miss those.

6. **Rust-first for data work.** File I/O, comment matching, hashing, scans are Rust commands; React receives typed IPC results and renders.
   **Pillars:** Performant, Architecturally Sound.
   **Rationale:** Keeps hot paths off the JS thread and centralizes validation/scope enforcement.

## Rules

1. All `invoke()` calls MUST go through `src/lib/tauri-commands.ts`. **Evidence:** only non-test `invoke` importer in the tree.
2. All logging MUST go through `src/logger.ts`; never import `@tauri-apps/plugin-log` outside the logger or its test. **Evidence:** `src/logger.ts:1-13`; only other import is the logger's own test.
3. Every log message from the web layer MUST flow through the wrappers, which guarantee the `[web]` prefix. **Evidence:** `src/logger.ts:9` — `_error(`[web] ${msg}`)`.
4. Global error handlers MUST be installed at module scope in `src/main.tsx` before `ReactDOM.createRoot`. **Evidence:** `src/main.tsx:8-19` then `:21`.
5. CLI launch args MUST be pulled via the `get_launch_args` command on React mount, not pushed via a startup event. **Evidence:** `src/App.tsx:96-100`; second-instance uses `listen("args-received", ...)` at `:102`.
6. Rust state shared with the setup hook MUST use `Arc<Mutex<Option<T>>>` managed via `app.manage()`. **Evidence:** `src-tauri/src/lib.rs:130-131`.
7. Rust MUST emit window-scoped events, not app-wide. **Evidence:** `src-tauri/src/commands.rs:44-48, 290`; `src-tauri/src/watcher.rs:94` all use `emit_to("main", ...)`.
8. React components that render markdown MUST define the `components` map at module scope. **Evidence:** `MarkdownViewer.tsx:140-183` `MD_COMPONENTS`. Only per-render extension (`img`) uses `useMemo([filePath])` at `:299-312`.
9. Per-block identity MUST be derived from `node.position.start.line` supplied by react-markdown. **Evidence:** `MarkdownViewer.tsx:106,123`.
10. `MarkdownViewer` MUST NOT pass `className` via `components.p/li/hN` — commentable wrappers own the class. **Evidence:** `MarkdownViewer.tsx:104-137`.
11. Tauri `listen()` subscriptions MUST always return an unlisten cleanup from their `useEffect`. **Evidence pattern:** `src/App.tsx:107-109`; `useFileWatcher.ts:75-78`; `useUnresolvedCounts.ts:46,53`.
12. In-flight async work in effects MUST use a `cancelled` flag. **Evidence:** `useFileContent.ts:44-59`; `useUnresolvedCounts.ts:22-41`.
13. Debounced timers in hooks MUST be stored in a `useRef` and cleared on unmount. **Evidence:** `useFileWatcher.ts:16,77`.
14. Store reads inside imperative handlers MUST use `useStore.getState()`; subscriptions use `useStore((s) => ...)` with `useShallow` for multi-field selectors. **Evidence:** `src/App.tsx:3,55-62,159,164`.
15. DOM-attribute external stores MUST be read with `useSyncExternalStore`, not `useEffect`-polled state. **Evidence:** `useTheme.ts:1-22`.
16. Expensive derived values from text input MUST be guarded by `useDeferredValue` before the `useMemo` that consumes them. **Evidence:** `useSearch.ts:12-31`; `useSourceHighlighting.ts:1,28`.
17. The Zustand `partialize` allowlist MUST include only UI/workspace fields. **Evidence:** `src/store/index.ts:224-235`. `ghostEntries`, `lastSaveByPath`, `updateStatus` are runtime-only.
18. Rehydrated `tabs` MUST be validated against the filesystem via `check_path_exists` before use. **Evidence:** `src/store/index.ts:236-264`.
19. Single-file mock of `@tauri-apps/api/core` drives every Vitest test; its `InvokeResult` union MUST be a subset of types imported from `tauri-commands.ts`. **Evidence:** `src/__mocks__/@tauri-apps/api/core.ts:2-27`.
20. `src/__mocks__/logger.ts` MUST expose `vi.fn()` for every real logger export. **Evidence:** `src/__mocks__/logger.ts:3-7`.
21. Cross-hook communication MUST go through DOM `CustomEvent` on `window` with the `mdownreview:*` namespace. **Evidence:** `useFileWatcher.ts:62-66` dispatch; `useFileContent.ts:26` listen.
22. File-watcher save-loop prevention MUST compare against the `lastSaveByPathRef` (the ref, not the reactive value). **Evidence:** `useFileWatcher.ts:53-59`; ref mirrored at `:18-20`.
23. Every `scanReviewFiles` trigger MUST be behind the debounced helper. **Evidence:** `useFileWatcher.ts:23-39, 71`.
24. Image sources in markdown MUST go through `convertFileSrc`. **Evidence:** `MarkdownViewer.tsx:308`.
25. Native menu events and global key handlers MUST be registered from the same effect lifecycle as the handlers they invoke, with dependencies listed. **Evidence:** `src/App.tsx:218-250,142-186`.
26. Every `useEffect` that subscribes to a `Promise<UnlistenFn>` MUST `.catch(() => {})` the unlisten rejection to avoid unhandled-rejection noise on hot-reload. **Evidence:** `src/App.tsx:108,248`.
27. `ErrorBoundary` MUST wrap every independently-rendered region (toolbar, folder tree, viewer, comments panel). **Evidence:** `src/App.tsx:278,315,325,335`.
28. Legitimate non-error-path warnings MUST use `console.warn` (or migrate to `logger.warn`) and MUST NEVER use `console.error`. `test-setup.ts` fails tests on `console.error`. **Evidence:** `useFileWatcher.ts:35,45,94`; `src/test-setup.ts:13-14`.

## Gaps (unenforced, backlog)

- **AGENTS.md / CLAUDE.md doc drift: React 18 → 19.** `package.json` pins `react: ^19.1.0`; docs still say React 18. Update docs and audit for React 19 opportunities (`use()`, ref-as-prop, `useActionState`).
- **No lint rule bars `forwardRef` reintroduction.** Current codebase has zero usages (correct for React 19), but nothing enforces it.
- **`useOptimistic` opportunity.** `CommentInput` currently waits on an IPC round-trip. React 19's `useOptimistic` would show a pending comment immediately.
- **Rust-First violation: frontmatter parsing.** `MarkdownViewer.tsx:44-62` (`parseFrontmatter`) reimplements YAML-ish parsing in TS on every markdown open. Move to a `#[tauri::command] fn parse_frontmatter` (real YAML via `serde_yaml`, off main thread).
- **Rust-First violation: search.** `useSearch.ts:15-31` scans the entire file in JS per query. Move to a Rust `search_in_document` streaming results.
- **Rust-First violation: `commentCountByLine`.** `MarkdownViewer.tsx:323-334` recomputes per render. Extend `get_unresolved_counts` to return per-line counts, memoize by sidecar-mtime.
- **Dead abstraction: `readBinaryFile`.** `src/lib/tauri-commands.ts:47-48` is exported but only referenced by mocks; delete if no caller exists (Lean).
- **`updater.createUpdaterArtifacts: "v1Compatible"`** (`src-tauri/tauri.conf.json:29`) is a v1-compat setting; once all released clients are v2, drop to default to reduce artifact size.
- **No capability ACL per window.** Commands are registered via `tauri::generate_handler!` (`src-tauri/src/lib.rs:222-240`); v2's capability system is bypassed. Add a `default.json` capability enumerating exactly which commands each window can invoke.
- **`ErrorBoundary` is a class component** (required — React 19 still mandates it). Add a CI check: `grep -r "extends Component" src/ | wc -l` must equal 1.
