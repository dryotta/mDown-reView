import { createHighlighter, type Highlighter } from "shiki";

let highlighterPromise: Promise<Highlighter> | null = null;

/**
 * Shared Shiki highlighter singleton.
 * Both SourceView and MarkdownViewer use this instead of creating separate instances.
 * Lazy-loads languages on demand — themes are pre-loaded.
 */
export function getSharedHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-light", "github-dark"],
      langs: [],
    });
  }
  return highlighterPromise;
}
