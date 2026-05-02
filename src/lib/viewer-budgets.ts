/**
 * Viewer perf budget constants — single canonical home.
 *
 * Each constant maps to a documented rule in docs/performance.md (or to a
 * placeholder rule that lands in iter 3 of the #252 PR). New viewer perf
 * budgets land here, never inline in component files (per docs/architecture.md
 * rule 23 spirit applied to runtime constants).
 *
 * Constant → governing doc:
 *   MARKDOWN_SOURCE_CLAMP_BYTES → docs/performance.md (added in iter 3 of PR for #252)
 *                                 docs/features/viewer-consistency.md "Large-file degradation"
 *   MARKDOWN_DEFER_BYTES        → docs/performance.md rule 29 (existing)
 *                                 paired with useDeferredValue in MarkdownViewer (iter 3)
 *   SOURCE_CHUNK_LINES          → docs/performance.md (added in iter 3) — idle Shiki chunk cap
 *   SOURCE_CHUNK_BYTES          → docs/performance.md (added in iter 3) — idle Shiki byte cap
 *   SOURCE_LONG_LINE_BYTES      → docs/performance.md (added in iter 3) — skip Shiki on this line
 *   SOURCE_BASE_LINE_PX         → docs/performance.md (added in iter 3) — virtualizer estimateSize base
 *   SOURCE_OVERSCAN             → docs/performance.md (added in iter 3) — virtualizer overscan
 *   IDLE_BUDGET_MS              → docs/performance.md (added in iter 3) — advisory; one chunk per slot
 *   SIZE_WARN_THRESHOLD         → docs/performance.md rule 29 (existing — large-file warning banner)
 *                                 migrated from src/lib/comment-utils.ts in iter 1 of #252.
 */

/** Markdown files at/above this byte size auto-clamp to source mode; visual toggle disabled. */
export const MARKDOWN_SOURCE_CLAMP_BYTES = 1_000_000;

/** Lower bound of the band where MarkdownViewer wraps body in useDeferredValue (smoothing only). */
export const MARKDOWN_DEFER_BYTES = 500 * 1024;

/** Idle Shiki chunk cap in lines (used by shiki-idle helper in iter 2). */
export const SOURCE_CHUNK_LINES = 500;

/** Idle Shiki chunk cap in bytes — guards against single-chunk pathologies (e.g. minified bundle on one line). */
export const SOURCE_CHUNK_BYTES = 32 * 1024;

/** Lines longer than this skip Shiki entirely — codeToHtml is super-linear in line length on some grammars. */
export const SOURCE_LONG_LINE_BYTES = 256 * 1024;

/** Pre-zoom base line height in CSS px; SourceView virtualizer estimateSize multiplies this by current zoom. */
export const SOURCE_BASE_LINE_PX = 22;

/** Tanstack-virtual overscan (rows kept rendered above/below viewport). Default 1 is too low for keyboard PgDn. */
export const SOURCE_OVERSCAN = 20;

/**
 * Advisory cushion for requestIdleCallback's deadline.timeRemaining(). NOT a hard
 * per-chunk runtime budget — once Shiki's codeToHtml runs on a chunk it takes
 * 10-30 ms regardless. The honest contract is "schedule one chunk per idle slot,
 * even on didTimeout". See useSourceHighlighting / shiki-idle.ts (iter 2).
 */
export const IDLE_BUDGET_MS = 4;

/** Soft warning banner threshold — files at/above this size show "may be slow" in MarkdownViewer + SourceView. */
export const SIZE_WARN_THRESHOLD = 500 * 1024;
