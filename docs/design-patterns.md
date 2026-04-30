# Design Patterns & Idioms

Canonical for React 19 + Tauri v2 idioms and hook composition. Cite violations as "violates rule N in `docs/design-patterns.md`". Charter: [`docs/principles.md`](principles.md).

`package.json` pins React 19.1. Tauri layer is v2.

## Principles

Structural chokepoints (IPC, logger) are canonical in [`docs/architecture.md`](architecture.md); Rust-First is a charter meta-principle.

1. **Hooks are wires, not state owners.** Hooks mirror external state (DOM events, Tauri events, Zustand); durable state lives in Zustand or in Rust. Keeps effects cancellable and idempotent.
2. **Deterministic keys from source positions.** Every per-block React key, `data-*` attribute, or anchor derives from `node.position.start.line` — never from array index or render order. Prevents React error #185 and keeps comment anchors stable.
3. **Persist UI, not content.** Zustand `persist` stores only UI state (canonical allowlist: rule 15 in [`docs/architecture.md`](architecture.md)); user-authored content lives in Rust-owned sidecars.
4. **Errors captured before first render.** Global error handlers install at module scope before `ReactDOM.createRoot()` so module-load and first-render failures are logged.

## Rules

### Error capture & crash surfaces
1. `window.onerror` and `window.onunhandledrejection` install at module scope in `src/main.tsx` **before** `ReactDOM.createRoot`. (`src/main.tsx:8-19,21`.)
2. Every independently-rendered region (toolbar, folder tree, viewer, comments panel) is wrapped in `<ErrorBoundary>`; the boundary forwards to the logger. (`App.tsx:278,306,315,325,335`; `ErrorBoundary.tsx:22`.)

### Tauri v2 idioms
3. Rust state shared with the Tauri `setup` hook uses `Arc<Mutex<Option<T>>>` managed via `app.manage()`. (`lib.rs:130-131`.)
4. Rust emits window-scoped events (`emit_to("main", …)`), not app-wide. (`commands/comments.rs:13-33`; `watcher.rs:94`.)
5. Every Tauri `listen()` subscription in a `useEffect` returns an unlisten cleanup. (`App.tsx:107-109`; `useFileWatcher.ts:75-78`.)
6. Every `useEffect` subscribing to a `Promise<UnlistenFn>` adds `.catch(() => {})` on the unlisten rejection to avoid unhandled-rejection noise on hot-reload. (`App.tsx:108,248`.)

### React 19 idioms
7. In-flight async work in effects uses a `cancelled` flag to drop stale responses. (`useFileContent.ts:44-59`; `useFileBadges.ts:20-44`.)
8. Debounced timers in hooks live in a `useRef` and clear on unmount. (`useFileWatcher.ts:16,77`.)
9. Store reads inside imperative handlers use `useStore.getState()`; subscriptions use narrow selectors or `useShallow`. (`App.tsx:3,55-62,159,164`.)
10. DOM-attribute external stores are read with `useSyncExternalStore`, not `useEffect`-polled state. (`useTheme.ts:1-22`.)
11. Expensive derived values from text input are guarded by `useDeferredValue` before the consuming `useMemo`. (`useSearch.ts:12-31`; `useSourceHighlighting.ts:1,28`.)
12. Rehydrated `tabs` are validated against the filesystem via `check_path_exists` before use. (`store/index.ts:236-264`.)

### Per-block identity (markdown)
13. Per-block identity derives from `node.position.start.line` supplied by react-markdown. (`MarkdownViewer.tsx:106,123`.)
14. `MarkdownViewer` does not pass `className` via `components.p/li` — the commentable wrappers (`makeCommentableBlock`, `CommentableLi`) own the class. Headings (`h1`–`h6`) render as plain HTML elements (not wrapped). (`MarkdownComponentsMap.tsx:203-209`.)

### Cross-hook communication
15. Cross-hook communication uses `window` `CustomEvent` with the `mdownreview:*` namespace. (`useFileWatcher.ts:62-66` dispatch; `useFileContent.ts:26` listen.)
16. File-watcher save-loop prevention compares against `useStore.getState().lastSaveByPath[sourcePath]` read imperatively inside the `file-changed` listener (Hot-tier discipline per `docs/architecture.md` rule 30). The sidecar path emitted by the watcher is normalized to the source path via `sourcePathFromEvent` before lookup. (`src/hooks/useFileWatcher.ts:22-26,74-87`.)
17. Every `scanReviewFiles` trigger is behind the debounced helper. (`useFileWatcher.ts:23-39,71`.)

### Mock-file idioms (testing)
18. The single-file mock of `@tauri-apps/api/core` drives every Vitest test; its `InvokeResult` union is a subset of types imported from `bindings.ts` (re-exported via `tauri-commands.ts`). (`src/__mocks__/@tauri-apps/api/core.ts:2-27`.)
19. `src/__mocks__/logger.ts` exposes `vi.fn()` for every real logger export. (`src/__mocks__/logger.ts:3-7`.)

### Handler lifecycle
20. Native menu events and global key handlers register from the same effect lifecycle as the handlers they invoke, with dependencies listed. (`App.tsx:218-250,142-186`.)

### Console hygiene
21. Legitimate non-error warnings use `console.warn` (or migrate to `logger.warn`) — never `console.error`. The Vitest `test-setup.ts:13-14` fails tests on any `console.error`.

### Cross-component handoff
22. **Pending-target store handoff.** Cross-file scroll-to-line uses a `pendingScrollTarget` field on `commentsSlice` (`src/store/comments.ts`) — the producer (`CommentsPanel`) writes it, the destination viewer's `useScrollToLine` (`src/hooks/useScrollToLine.ts`) consumes it on mount via `consumePendingScrollTarget(filePath)` which atomically clears the field iff the queued path matches. Replaces the iter 9 `setTimeout`/rAF race-the-mount hack. Producers do not block on consumer readiness; rapid producer writes supersede earlier targets via plain overwrite. (`src/store/comments.ts:36-128`; `src/hooks/useScrollToLine.ts:40-53`.)
23. **HTML-preview iframe is `allow-same-origin` only — no postMessage bridge.** Because the sandbox forbids script execution (rule 12a in [`docs/security.md`](security.md)), the host can reach into `contentDocument` directly to install a click handler that routes anchors through `routeLinkClick` (`src/lib/url-policy.ts`). No `postMessage` channel is needed and none exists. (`src/components/viewers/HtmlPreviewView.tsx`.)

### Cross-doc references
- Module-scope `MD_COMPONENTS`: rules 9-10 in [`docs/performance.md`](performance.md).
- `convertFileSrc` for local images: rule 14 in [`docs/security.md`](security.md).
- Shiki singleton: rule 7 in [`docs/performance.md`](performance.md).
- Zustand `persist` allowlist: rule 15 in [`docs/architecture.md`](architecture.md).
- React 19 API choices (`use`, `useTransition`, `useDeferredValue`, ref-as-prop, `useOptimistic`): [`docs/best-practices-common/react/react19-apis.md`](best-practices-common/react/react19-apis.md).
- Composition over boolean props, compound components, lifted state: [`docs/best-practices-common/react/composition-patterns.md`](best-practices-common/react/composition-patterns.md).
- Re-render hygiene (selector granularity, derived state without effects, transient refs): [`docs/best-practices-common/react/rerender-optimization.md`](best-practices-common/react/rerender-optimization.md).

## Gaps

- **`useOptimistic` opportunity.** `CommentInput` waits on an IPC round-trip before updating UI; React 19's `useOptimistic` would show a pending comment immediately.
- **No lint rule blocks `forwardRef` reintroduction.** Codebase has zero usages (correct for React 19); nothing enforces it.
- **`updater.createUpdaterArtifacts: "v1Compatible"`** (`tauri.conf.json:29`) is v1-compat; drop to default once all released clients are v2.
- **No per-window capability ACL.** Commands register via `tauri::generate_handler!` (`lib.rs:222-240`), bypassing v2's capability system. Add a `default.json` capability enumerating commands per window.
- **`ErrorBoundary` as only class component.** Required by React 19; CI should grep-check that `extends Component` appears exactly once.
