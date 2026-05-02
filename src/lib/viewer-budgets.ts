/**
 * Viewer perf budget constants — single canonical home.
 *
 * `SIZE_WARN_THRESHOLD` governs the soft "this file may be slow" banner shown
 * by `MarkdownViewer` and `SourceView` for files at/above 500 KB. See
 * `docs/performance.md` rule 29. Additional viewer perf budget constants
 * land here when their consumers ship — never inline in component files.
 */

/** Soft warning banner threshold — files at/above this size show "may be slow" in MarkdownViewer + SourceView. */
export const SIZE_WARN_THRESHOLD = 500 * 1024;
