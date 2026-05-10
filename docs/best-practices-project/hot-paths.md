---
tags: [performance, hot-paths, react-rendering, ipc, security]
---

# Hot Paths (mdownreview-specific)

Performance-sensitive areas of the codebase, with what each is sensitive to. Use this as the first-look checklist for any performance investigation.

> **Scope:** project-specific. Generic JS/React performance rules are bundled with `performance-expert`. Numeric budgets (debounce windows, file-size caps, memory ceilings) live in [`../performance.md`](../performance.md).

## How to apply

Every flagged hotspot needs evidence (profile, benchmark, or specific code-bound `file:line`). For citations: `hot-path: <slug> in docs/best-practices-project/hot-paths.md`.

## Hot paths

### `hot-path: markdown-viewer-render`

**File:** `src/components/viewers/MarkdownViewer.tsx`, `src/components/viewers/EnhancedViewer.tsx`, `src/lib/viewer-budgets.ts`

Sensitive to:
- Shiki syntax highlighting cost on large code blocks.
- Re-renders triggered by Zustand selectors that return new object references each call.
- `react-markdown` component map churn (recreating the components object on every render forces React to remount everything).
- **`<ReactMarkdown>` parse blocking the main thread** — the hot path MUST feed `useDeferredValue(content)` into the React-Markdown render. The cheap regex pre-scans (frontmatter, math, remote-image refs) MUST stay on raw `content` so the surrounding chrome reacts immediately.
- **Markdown ≥ 1 MB visual mode** — `EnhancedViewer` MUST clamp `.md` files at/above `MARKDOWN_VISUAL_CAP_BYTES` to source-mode-only. Removing the clamp regresses to multi-second freezes on cold open.

First-look checks: memoization on the Markdown element, `useDeferredValue(content)` on the source text passed to `<ReactMarkdown>`, stable references for the `components` prop, the 1 MB visual cap is enforced in `EnhancedViewer.tsx`.

### `hot-path: source-view-shiki`

**File:** `src/components/viewers/SourceView.tsx`, `src/hooks/useSourceHighlighting.ts`, `src/lib/idle.ts`, `src/lib/viewer-budgets.ts`

Sensitive to:
- Per-line `codeToHtml` calls (one Shiki invocation per line of source) — degrades quadratically vs document-level highlighting.
- Singleton highlighter not reused across mounts.
- **Idle chunking regressions**: a single `codeToHtml(deferredContent, …)` call against a 5 MB file blocks the main thread for many seconds. The hook MUST chunk via `requestIdleCallback` (polyfilled in `src/lib/idle.ts` for WKWebView) at `SOURCE_HIGHLIGHT_CHUNK_LINES` per chunk and yield when `timeRemaining()` falls below `SOURCE_HIGHLIGHT_IDLE_BUDGET_MS`.
- **Virtualisation regressions**: `SourceView` MUST mount only viewport-visible rows + `SOURCE_OVERSCAN` via `@tanstack/react-virtual`. A flat `model.map(...)` over the full line model regresses to O(N) DOM nodes for N-line files.

First-look checks: confirm Shiki runs idle-chunked (search for `requestIdle`/`splitShikiHtmlByLine`); confirm `useVirtualizer` is the row-mounting path in `SourceView.tsx`; confirm budget constants come from `lib/viewer-budgets.ts` (no inline numbers).

### `hot-path: mermaid-render`

**File:** `src/components/viewers/mermaid/MermaidRenderer.tsx` (render hot path); pan/zoom hot loop in `src/components/viewers/mermaid/MermaidCanvas.tsx`

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

Cross-ref: `rerender-defer-reads` and `rerender-split-combined-hooks` rules in `performance-expert`'s bundled knowledge.

### `hot-path: file-watcher`

**File:** `src-tauri/src/watcher.rs`, `src/hooks/useFileWatcher.ts`

Sensitive to:
- Debounce window — canonical value in rule 5 of `../performance.md`.
- Event flood on large repos — debouncer must coalesce per-path before emitting.
- Frontend handler must throttle UI updates separately from the Rust debounce.

### `hot-path: ipc-payload-size`

**File:** `src-tauri/src/commands/fs/read.rs` (`read_text_file`), `src-tauri/src/commands/comments.rs`

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

### `hot-path: index-html-csp-trigger`

**File:** `index.html`

Sensitive to:
- This file is the SOLE input to Tauri's `inject_nonce_token` (`tauri-utils html.rs`). Any inline `<style>` element added here propagates a fresh nonce to the production `style-src` directive, which (per CSP3) disables `'unsafe-inline'` and breaks every inline `style=` consumer in the renderer. Adding inline CSS for any reason — vendor snippets, debug overlays, FOUC mitigation, font-face declarations — must instead route through `src/styles/`. Canonical: rule 17a in [`../security.md`](../security.md). Regression test: `src/__tests__/index-html-no-inline-style.test.ts`.

## Rust-first prompt

For any flagged hotspot, ask: does this computation need to happen in React, or can Rust do it and return a result? Text search, anchor matching, hash computation, path manipulation, CRLF normalization, file-size checks — all default to Rust.
