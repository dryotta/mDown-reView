import { useMemo } from "react";
import { escapeHtml } from "@/hooks/useSourceHighlighting";
import type { CommentThread, FoldRegion } from "@/lib/tauri-commands";

/** Stable empty-threads sentinel — preserves reference identity across renders
 *  so React.memo on SourceLine does not see a fresh `[]` for every line. */
const EMPTY_THREADS: CommentThread[] = [];

export interface SearchMatchInLine {
  startCol: number;
  endCol: number;
  isCurrent: boolean;
}

export interface SourceLineModelInput {
  lines: string[];
  threadsByLine: Map<number, CommentThread[]>;
  foldStartMap: Map<number, FoldRegion>;
  collapsedLines: Set<number>;
  query: string;
  matchesByLine: Map<number, SearchMatchInLine[]>;
  highlightedLines: string[];
  expandedLine: number | null;
  commentingLine: number | null;
}

export interface LineModel {
  idx: number;
  lineNum: number;
  line: string;
  contentHtml: string;
  foldRegion: FoldRegion | undefined;
  isCollapsed: boolean;
  lineThreads: CommentThread[];
  isCommenting: boolean;
  isExpanded: boolean;
}

function extractInnerCode(html: string): string {
  const match = /<code[^>]*>([\s\S]*?)<\/code>/.exec(html);
  return match ? match[1] : html;
}

function highlightSearchInLine(line: string, lineMatches: SearchMatchInLine[]): string {
  const parts: string[] = [];
  let last = 0;
  for (const { startCol, endCol, isCurrent } of lineMatches) {
    parts.push(escapeHtml(line.slice(last, startCol)));
    const cls = isCurrent ? "search-match-current" : "search-match";
    parts.push(`<mark class="${cls}">${escapeHtml(line.slice(startCol, endCol))}</mark>`);
    last = endCol;
  }
  parts.push(escapeHtml(line.slice(last)));
  return parts.join("");
}

/**
 * Pure VM hook — collapses fold-skip iteration, content-html selection, and
 * per-line state lookups into an array of `LineModel` items ready for a flat
 * `.map()` in the render layer. Skipped (collapsed-interior) lines are omitted.
 *
 * Memoised on every input; output array identity is stable across renders
 * unless inputs change. This is the foundation that lets `React.memo` on
 * `SourceLine` keep re-renders to O(changed lines) rather than O(N) on every
 * keystroke.
 */
export function useSourceLineModel(input: SourceLineModelInput): LineModel[] {
  const {
    lines,
    threadsByLine,
    foldStartMap,
    collapsedLines,
    query,
    matchesByLine,
    highlightedLines,
    expandedLine,
    commentingLine,
  } = input;

  return useMemo(() => {
    const out: LineModel[] = [];
    let idx = 0;
    while (idx < lines.length) {
      const lineNum = idx + 1;
      const line = lines[idx];
      const foldRegion = foldStartMap.get(lineNum);
      const isCollapsed = foldRegion !== undefined && collapsedLines.has(lineNum);

      const lineMatches = matchesByLine.get(idx);
      let contentHtml: string;
      if (query && lineMatches) {
        contentHtml = highlightSearchInLine(line, lineMatches);
      } else if (highlightedLines[idx]) {
        contentHtml = extractInnerCode(highlightedLines[idx]);
      } else {
        contentHtml = escapeHtml(line);
      }

      out.push({
        idx,
        lineNum,
        line,
        contentHtml,
        foldRegion,
        isCollapsed,
        lineThreads: threadsByLine.get(lineNum) ?? EMPTY_THREADS,
        isCommenting: commentingLine === lineNum,
        isExpanded: expandedLine === lineNum,
      });

      if (isCollapsed && foldRegion) {
        idx = foldRegion.endLine - 1;
      } else {
        idx++;
      }
    }
    return out;
  }, [
    lines,
    threadsByLine,
    foldStartMap,
    collapsedLines,
    query,
    matchesByLine,
    highlightedLines,
    expandedLine,
    commentingLine,
  ]);
}
