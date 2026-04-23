import { useEffect, useState, useMemo } from "react";
import { useComments } from "@/lib/vm/use-comments";
import { useCommentActions } from "@/lib/vm/use-comment-actions";
import { LineCommentMargin } from "@/components/comments/LineCommentMargin";
import { SelectionToolbar } from "@/components/comments/SelectionToolbar";
import { useSearch } from "@/hooks/useSearch";
import { useSourceHighlighting, escapeHtml } from "@/hooks/useSourceHighlighting";
import { useSelectionToolbar } from "@/hooks/useSelectionToolbar";
import { useFolding } from "@/hooks/useFolding";
import { SearchBar } from "./SearchBar";
import { SIZE_WARN_THRESHOLD } from "@/lib/comment-utils";
import "@/styles/source-viewer.css";

interface Props {
  content: string;
  path: string;
  filePath: string;
  fileSize?: number;
  wordWrap?: boolean;
}

function extractInnerCode(html: string): string {
  const match = /<code[^>]*>([\s\S]*?)<\/code>/.exec(html);
  return match ? match[1] : html;
}

export function SourceView({ content, path, filePath, fileSize, wordWrap }: Props) {
  const [commentingLine, setCommentingLine] = useState<number | null>(null);
  const [expandedLine, setExpandedLine] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const { query, setQuery, matches, currentIndex, next, prev } = useSearch(content);

  const { threads } = useComments(filePath);
  const { addComment } = useCommentActions();

  const lines = useMemo(() => content.split("\n"), [content]);

  const { highlightedLines } = useSourceHighlighting(content, path);
  const {
    selectionToolbar,
    setSelectionToolbar,
    pendingSelectionAnchor,
    highlightedSelectionLines,
    handleMouseUp,
    handleAddSelectionComment,
    clearSelection,
  } = useSelectionToolbar();
  const { collapsedLines, foldStartMap, toggleFold } = useFolding(lines, filePath);

  // Reset selection when file changes
  useEffect(() => { clearSelection(); }, [filePath, clearSelection]);

  // Ctrl+F keyboard handler
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Search match lookup by line
  const matchesByLine = useMemo(() => {
    const map = new Map<number, { startCol: number; endCol: number; isCurrent: boolean }[]>();
    matches.forEach((m, i) => {
      const arr = map.get(m.lineIndex) ?? [];
      arr.push({ startCol: m.startCol, endCol: m.endCol, isCurrent: i === currentIndex });
      map.set(m.lineIndex, arr);
    });
    return map;
  }, [matches, currentIndex]);

  const threadsByLine = useMemo(() => {
    const map = new Map<number, import("@/lib/tauri-commands").CommentThread[]>();
    for (const t of threads) {
      const ln = t.root.matchedLineNumber ?? t.root.line ?? 1;
      const arr = map.get(ln) ?? [];
      arr.push(t);
      map.set(ln, arr);
    }
    return map;
  }, [threads]);

  // Auto-scroll to current match
  useEffect(() => {
    if (currentIndex < 0 || !matches[currentIndex]) return;
    const lineIdx = matches[currentIndex].lineIndex;
    const lineEl = document.querySelector(`[data-line-idx="${lineIdx}"]`);
    lineEl?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentIndex, matches]);

  // Scroll-to-line from CommentsPanel click
  useEffect(() => {
    const handler = (e: Event) => {
      const line = (e as CustomEvent).detail.line;
      const lineIdx = line - 1;
      const el = document.querySelector(`[data-line-idx="${lineIdx}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("comment-flash");
        setTimeout(() => el.classList.remove("comment-flash"), 1500);
      }
      setExpandedLine(line);
      setCommentingLine(null);
    };
    window.addEventListener("scroll-to-line", handler);
    return () => window.removeEventListener("scroll-to-line", handler);
  }, []);

  function highlightSearchInLine(lineIdx: number): string {
    const lineMatches = matchesByLine.get(lineIdx);
    if (!lineMatches) return escapeHtml(lines[lineIdx]);
    const line = lines[lineIdx];
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

  const showSizeWarning = fileSize !== undefined && fileSize > SIZE_WARN_THRESHOLD;

  return (
    <div className={`source-view${wordWrap ? " wrap-enabled" : ""}`} style={{ position: "relative" }}>
      {searchOpen && (
        <SearchBar
          query={query}
          matchCount={matches.length}
          currentIndex={currentIndex}
          onQueryChange={setQuery}
          onNext={next}
          onPrev={prev}
          onClose={() => { setSearchOpen(false); setQuery(""); }}
        />
      )}
      {showSizeWarning && (
        <div className="size-warning" role="alert">
          This file is large ({Math.round((fileSize ?? 0) / 1024)} KB) — rendering may be slow
        </div>
      )}
      <div className="source-lines" onMouseUp={handleMouseUp}>
        {(() => {
          const elements: React.ReactNode[] = [];
          let idx = 0;
          while (idx < lines.length) {
            const lineNum = idx + 1;
            const line = lines[idx];
            const lineThreads = threadsByLine.get(lineNum) ?? [];
            const foldRegion = foldStartMap.get(lineNum);
            const isCollapsed = foldRegion !== undefined && collapsedLines.has(lineNum);

            elements.push(
              <div key={idx}>
                <div className={`source-line${highlightedSelectionLines.has(lineNum) ? " selection-active" : ""}`} data-line-idx={idx}>
                  <span className="source-line-gutter">
                    <span className="source-line-comment-zone">
                      <button
                        className="comment-plus-btn"
                        aria-label="Add comment"
                        onClick={() => {
                          const lt = threadsByLine.get(lineNum) ?? [];
                          if (lt.length > 0 && expandedLine !== lineNum) {
                            setExpandedLine(lineNum);
                            setCommentingLine(null);
                            clearSelection();
                          } else {
                            clearSelection();
                            setCommentingLine(
                              commentingLine === lineNum ? null : lineNum
                            );
                          }
                        }}
                      >
                        +
                      </button>
                    </span>
                    <span className="source-line-fold-zone">
                      {foldRegion && (
                        <button
                          className="source-line-fold-toggle"
                          aria-label={isCollapsed ? "Expand" : "Collapse"}
                          onClick={() => toggleFold(lineNum)}
                        >
                          {isCollapsed ? "▸" : "▾"}
                        </button>
                      )}
                    </span>
                    <span className="source-line-number-zone">{lineNum}</span>
                  </span>
                  <span
                    className="source-line-content"
                    dangerouslySetInnerHTML={{
                      __html: (query && matchesByLine.has(idx))
                        ? highlightSearchInLine(idx)
                        : highlightedLines[idx]
                          ? extractInnerCode(highlightedLines[idx])
                          : escapeHtml(line),
                    }}
                  />
                </div>
                {(commentingLine === lineNum || expandedLine === lineNum || lineThreads.length > 0) && (
                  <LineCommentMargin
                    filePath={filePath}
                    lineNumber={lineNum}
                    lineText={line}
                    threads={lineThreads}
                    showInput={commentingLine === lineNum}
                    forceExpanded={expandedLine === lineNum}
                    onCloseInput={() => { setCommentingLine(null); setExpandedLine(null); clearSelection(); }}
                    onRequestInput={() => setCommentingLine(lineNum)}
                    onSaveComment={
                      pendingSelectionAnchor && commentingLine === lineNum
                        ? (text: string) => {
                            addComment(filePath, text, pendingSelectionAnchor).catch(() => {});
                            clearSelection();
                          }
                        : undefined
                    }
                  />
                )}
              </div>
            );

            if (isCollapsed && foldRegion) {
              const hiddenCount = foldRegion.endLine - lineNum - 1;
              elements.push(
                <div
                  key={`fold-${lineNum}`}
                  className="source-fold-placeholder"
                  onClick={() => toggleFold(lineNum)}
                >
                  ⋯ {hiddenCount} lines hidden
                </div>
              );
              // Skip to the end line (render it on the next iteration)
              idx = foldRegion.endLine - 1;
            } else {
              idx++;
            }
          }
          return elements;
        })()}
      </div>
      {selectionToolbar && (
        <SelectionToolbar
          position={selectionToolbar.position}
          onAddComment={() => handleAddSelectionComment(setCommentingLine)}
          onDismiss={() => setSelectionToolbar(null)}
        />
      )}
    </div>
  );
}
