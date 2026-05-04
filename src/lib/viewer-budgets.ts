/**
 * Viewer perf budget constants — single canonical home.
 *
 * Every constant below is the *only* place in the codebase that defines its
 * value; consumers import from here. Inlining a number in a component file
 * would split the budget across two surfaces — explicitly forbidden by
 * `docs/architecture.md` rule 23 (single canonical home).
 *
 * Constant → governing rule:
 *   - SIZE_WARN_THRESHOLD             → docs/performance.md rule 29
 *   - MARKDOWN_VISUAL_CAP_BYTES       → docs/performance.md (large-file rule, iter 3 of #252)
 *   - SOURCE_HIGHLIGHT_CHUNK_LINES    → docs/performance.md (idle Shiki rule, iter 2 of #252)
 *   - SOURCE_HIGHLIGHT_IDLE_BUDGET_MS → docs/performance.md (idle Shiki rule, iter 2 of #252)
 *   - SOURCE_OVERSCAN                 → docs/performance.md (virtualisation rule, iter 2 of #252)
 *   - SOURCE_BASE_LINE_PX             → docs/performance.md (virtualisation rule, iter 2 of #252)
 */

/** Soft warning banner threshold — files at/above this size show "may be slow" in MarkdownViewer + SourceView. */
export const SIZE_WARN_THRESHOLD = 500 * 1024;

/**
 * Hard cap above which `.md` / `.mdx` files open in source mode and the
 * visual toggle is disabled. Markdown rendering at 1 MB+ blocks the main
 * thread for many seconds in Tauri's WebView2/WKWebView; source mode (with
 * row virtualisation) is responsive at any size up to the 10 MB Rust cap.
 */
export const MARKDOWN_VISUAL_CAP_BYTES = 1 * 1024 * 1024;

/**
 * Lines per Shiki `codeToHtml` chunk. The chunk size trades token-correctness
 * (bigger = better multi-line token continuity) against frame-budget pressure
 * (smaller = each `codeToHtml` call returns sooner). 500 lines is ~10 ms of
 * tokenisation work for typical languages, which fits inside one idle slot
 * even on the slowest currently-supported hardware.
 */
export const SOURCE_HIGHLIGHT_CHUNK_LINES = 500;

/**
 * Frame-time slack required before scheduling the next chunk. The polyfilled
 * `requestIdleCallback` (see `src/lib/idle.ts`) returns a synthetic
 * `timeRemaining()` of 16 ms, so this gate is effectively "skip a chunk when
 * the deadline says we have less than 4 ms left". Tuned to keep the main
 * thread responsive without starving the highlight queue.
 */
export const SOURCE_HIGHLIGHT_IDLE_BUDGET_MS = 4;

/**
 * Virtualiser overscan — rows mounted above and below the viewport so the
 * user never sees a blank gap during fast scrolls. 20 ≈ ~440 px at the base
 * line height, which masks scroll-throw on a 60 fps display.
 */
export const SOURCE_OVERSCAN = 20;

/**
 * Initial estimate (in CSS pixels) for a single source-line row before the
 * virtualiser measures the real DOM height. The virtualiser remeasures via
 * `measureElement`, so this is just a cold-start guess that picks a sensible
 * scrollbar position before the first paint.
 */
export const SOURCE_BASE_LINE_PX = 22;

/**
 * Issue #352 / iter-12 — Excalidraw autosave debounce window. After this many
 * ms with no further `onChange`, the live scene is persisted to disk via the
 * workspace-write IPC. 2000 ms balances "snappy persistence" against "every
 * keystroke triggers an IPC". Should remain ≥ `SAVE_DEBOUNCE_MS` (1500 ms in
 * `useFileWatcher.ts`) so the watcher echo of our own write always falls
 * inside the suppression window.
 */
export const EXCALIDRAW_AUTOSAVE_DEBOUNCE_MS = 2000;

/**
 * Issue #352 / iter-12 — pause auto-save after this many consecutive failures.
 * Repeated rejections from the workspace-write IPC (broken disk, readonly
 * drive, AV scan) would otherwise surface one save-error banner per
 * `EXCALIDRAW_AUTOSAVE_DEBOUNCE_MS` of editing, spamming the UI. Pausing
 * after 3 failures gives the user a single sticky banner; they click Resume
 * to re-engage the loop.
 */
export const EXCALIDRAW_AUTOSAVE_MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Issue #352 / iter-12 — transient "Saved" pill duration after a Cmd+S flush.
 * Long enough to register as feedback; short enough to clear before the next
 * save fires.
 */
export const EXCALIDRAW_SAVED_PILL_MS = 1500;
