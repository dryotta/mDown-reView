# Hot Paths (mdownreview-specific)

Performance-sensitive areas of the codebase, with what each is sensitive to. Use this as the first-look checklist for any performance investigation.

> **Scope:** project-specific. Generic JS/React performance rules live in [`../best-practices-common/general/javascript-performance.md`](../best-practices-common/general/javascript-performance.md), [`../best-practices-common/react/rerender-optimization.md`](../best-practices-common/react/rerender-optimization.md), and [`../best-practices-common/react/rendering-performance.md`](../best-practices-common/react/rendering-performance.md). Numeric budgets (debounce windows, file-size caps, memory ceilings) live in [`../performance.md`](../performance.md).

## How to apply

Every flagged hotspot needs evidence (profile, benchmark, or specific code-bound `file:line`). For citations: `hot-path: <slug> in docs/best-practices-project/hot-paths.md`.

## Hot paths

### `hot-path: markdown-viewer-render`

**File:** `src/components/viewers/MarkdownViewer.tsx`

Sensitive to:
- Shiki syntax highlighting cost on large code blocks.
- Re-renders triggered by Zustand selectors that return new object references each call.
- `react-markdown` component map churn (recreating the components object on every render forces React to remount everything).

First-look checks: memoization on the Markdown element, `useDeferredValue` on the source text, stable references for the `components` prop.

### `hot-path: source-view-shiki`

**File:** `src/components/viewers/SourceView.tsx`, `src/hooks/useSourceHighlighting.ts`

Sensitive to:
- Per-line `codeToHtml` calls (one Shiki invocation per line of source) — degrades quadratically vs document-level highlighting.
- Singleton highlighter not reused across mounts.

First-look checks: confirm Shiki is highlighting per-document, not per-line; confirm the highlighter instance is reused.

### `hot-path: mermaid-render`

**File:** `src/components/viewers/MermaidView.tsx`

Sensitive to:
- Mermaid render is synchronous and blocks the main thread — large diagrams freeze the UI.
- Re-renders on theme switch must dispose the previous SVG to avoid a memory leak.

First-look checks: render off the main thread or behind a `useTransition`; cleanup on unmount.

### `hot-path: comments-panel`

**File:** `src/components/comments/CommentsPanel.tsx`

Sensitive to:
- Re-renders on every keystroke when typing in `CommentInput`.
- Selector returning the full comments array (vs only the current file's threads).

First-look checks: split selectors per concern; confirm draft text is local state, not store state.

### `hot-path: zustand-selectors`

**File:** `src/store/index.ts` and every consumer.

Sensitive to:
- Selectors that return new object/array references each call cause every consumer to re-render.
- Combined hooks pulling many fields when only one is needed.

Cross-ref: [`../best-practices-common/react/rerender-optimization.md`](../best-practices-common/react/rerender-optimization.md) — `rerender-defer-reads`, `rerender-split-combined-hooks`.

### `hot-path: file-watcher`

**File:** `src-tauri/src/watcher.rs`, `src/hooks/useFileWatcher.ts`

Sensitive to:
- Debounce window — canonical value in rule 5 of `../performance.md`.
- Event flood on large repos — debouncer must coalesce per-path before emitting.
- Frontend handler must throttle UI updates separately from the Rust debounce.

### `hot-path: ipc-payload-size`

**File:** `src-tauri/src/commands/fs.rs` (`read_text_file`), `src-tauri/src/commands/comments.rs`

Sensitive to:
- Sending entire file content on every change instead of a diff.
- Large MRSF sidecar payloads on every save.

First-look checks: payload size proportional to delta, not full document; confirm the IPC channel is not the bottleneck.

### `hot-path: file-content-hook`

**File:** `src/hooks/useFileContent.ts`

Sensitive to:
- Re-fetch frequency — does opening the same tab re-read from disk?
- Caching strategy — is content cached by path+mtime?

### `hot-path: comment-anchoring`

**File:** `src-tauri/src/core/anchors.rs`, `src-tauri/src/core/matching.rs` (and any legacy TS in `src/lib/comment-anchors.ts`)

Sensitive to:
- O(n) scans over file lines per comment per anchor recomputation.
- Hash recompute on every keystroke if not debounced.

First-look checks: confirm anchoring runs in Rust (Rust-First); confirm batched recompute on file change, not per keystroke.

## Rust-first prompt

For any flagged hotspot, ask: does this computation need to happen in React, or can Rust do it and return a result? Text search, anchor matching, hash computation, path manipulation, CRLF normalization, file-size checks — all default to Rust.
