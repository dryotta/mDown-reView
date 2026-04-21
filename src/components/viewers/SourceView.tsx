import { useEffect, useState, useRef, useMemo } from "react";
import { createHighlighter, type Highlighter } from "shiki";
import { extname } from "@/lib/path-utils";
import { matchComments } from "@/lib/comment-matching";
import { computeSelectedTextHash } from "@/lib/comment-anchors";
import { truncateSelectedText } from "@/lib/comment-utils";
import { useStore } from "@/store";
import { loadReviewComments } from "@/lib/tauri-commands";
import { useAutoSaveComments } from "@/hooks/useAutoSaveComments";
import { LineCommentMargin } from "@/components/comments/LineCommentMargin";
import { SelectionToolbar } from "@/components/comments/SelectionToolbar";
import { computeFoldRegions, type FoldRegion } from "@/lib/fold-regions";
import { useSearch } from "@/hooks/useSearch";
import { SearchBar } from "./SearchBar";
import kqlGrammar from "@/lib/kql.tmLanguage.json";
import "@/styles/source-viewer.css";

const SIZE_WARN_THRESHOLD = 500 * 1024;

interface Props {
  content: string;
  path: string;
  filePath: string;
  fileSize?: number;
  wordWrap?: boolean;
}

let highlighterInstance: Highlighter | null = null;

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterInstance) {
    highlighterInstance = await createHighlighter({
      themes: ["github-light", "github-dark"],
      langs: [],
    });
  }
  return highlighterInstance;
}

function langFromPath(path: string): string {
  const ext = extname(path).slice(1);
  const map: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
    py: "python", rs: "rust", go: "go", java: "java",
    c: "c", cpp: "cpp", h: "c", css: "css", html: "html",
    json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
    sh: "bash", bash: "bash", md: "markdown", sql: "sql",
    rb: "ruby", php: "php", swift: "swift", kt: "kotlin", cs: "csharp",
    xml: "xml", kql: "kql", csl: "kql",
  };
  return map[ext] ?? "text";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function extractInnerCode(html: string): string {
  const match = /<code[^>]*>([\s\S]*?)<\/code>/.exec(html);
  return match ? match[1] : html;
}

export function SourceView({ content, path, filePath, fileSize, wordWrap }: Props) {
  const [highlightedLines, setHighlightedLines] = useState<string[]>([]);
  const [commentingLine, setCommentingLine] = useState<number | null>(null);
  const [expandedLine, setExpandedLine] = useState<number | null>(null);
  const [collapsedLines, setCollapsedLines] = useState<Set<number>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectionToolbar, setSelectionToolbar] = useState<{
    position: { top: number; left: number };
    lineNumber: number;
    selectedText: string;
    startOffset: number;
    endLine: number;
    endOffset: number;
  } | null>(null);
  const [pendingSelectionAnchor, setPendingSelectionAnchor] = useState<{
    line: number;
    end_line: number;
    start_column: number;
    end_column: number;
    selected_text: string;
    selected_text_hash?: string;
  } | null>(null);
  const [highlightedSelectionLines, setHighlightedSelectionLines] = useState<Set<number>>(new Set());
  const { query, setQuery, matches, currentIndex, next, prev } = useSearch(content);

  const setFileComments = useStore((s) => s.setFileComments);
  const comments = useStore((s) => s.commentsByFile[filePath]);
  const addComment = useStore((s) => s.addComment);
  const loadedRef = useRef<string | null>(null);
  const [commentReloadKey, setCommentReloadKey] = useState(0);
  const [commentLoadKey, setCommentLoadKey] = useState(0);

  const lines = content.split("\n");

  const foldRegions = useMemo(() => computeFoldRegions(lines), [content]);

  const foldStartMap = useMemo(() => {
    const m = new Map<number, FoldRegion>();
    foldRegions.forEach((r) => {
      if (!m.has(r.startLine) || m.get(r.startLine)!.endLine < r.endLine) {
        m.set(r.startLine, r);
      }
    });
    return m;
  }, [foldRegions]);

  const toggleFold = (lineNum: number) => {
    setCollapsedLines((prev) => {
      const next = new Set(prev);
      if (next.has(lineNum)) next.delete(lineNum);
      else next.add(lineNum);
      return next;
    });
  };

  // Load comments from sidecar
  useEffect(() => {
    let cancelled = false;
    loadedRef.current = null;
    loadReviewComments(filePath)
      .then((result) => {
        if (!cancelled && result?.comments) {
          setFileComments(filePath, result.comments);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          loadedRef.current = filePath;
          setCommentLoadKey((k) => k + 1);
        }
      });
    return () => { cancelled = true; };
  }, [filePath, setFileComments]);

  // Listen for review sidecar changes
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path: string; kind: string };
      if (detail.kind === "review" && (detail.path === `${filePath}.review.yaml` || detail.path === `${filePath}.review.json`)) {
        setCommentReloadKey((k) => k + 1);
      }
    };
    window.addEventListener("mdownreview:file-changed", handler);
    return () => window.removeEventListener("mdownreview:file-changed", handler);
  }, [filePath]);

  // Reload comments when sidecar changes
  useEffect(() => {
    if (commentReloadKey === 0) return; // Skip initial — handled by main load effect
    let cancelled = false;
    loadReviewComments(filePath)
      .then((result) => {
        if (!cancelled && result?.comments) {
          setFileComments(filePath, result.comments);
          setCommentLoadKey((k) => k + 1);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [commentReloadKey, filePath, setFileComments]);

  // Reset folds when file changes
  useEffect(() => { setCollapsedLines(new Set()); setPendingSelectionAnchor(null); }, [filePath]);

  // Auto-save comments to sidecar (shared hook with flush-on-unmount)
  useAutoSaveComments(filePath, comments, commentLoadKey);

  // Theme tracking
  const [currentTheme, setCurrentTheme] = useState(
    () => document.documentElement.getAttribute("data-theme") ?? "light"
  );
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setCurrentTheme(document.documentElement.getAttribute("data-theme") ?? "light");
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

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

  const matchedComments = useMemo(() => {
    if (!comments || comments.length === 0) return [];
    return matchComments(comments, lines);
  }, [comments, lines]);

  const commentsByLine = useMemo(() => {
    const map = new Map<number, typeof matchedComments>();
    for (const c of matchedComments) {
      const ln = c.matchedLineNumber ?? c.line ?? 1;
      const arr = map.get(ln) ?? [];
      arr.push(c);
      map.set(ln, arr);
    }
    return map;
  }, [matchedComments]);

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

  // Syntax highlighting per line
  useEffect(() => {
    const theme = currentTheme === "dark" ? "github-dark" : "github-light";
    const lang = langFromPath(path);
    getHighlighter()
      .then(async (hl) => {
        const loaded = hl.getLoadedLanguages();
        if (!loaded.includes(lang) && lang !== "text") {
          if (lang === "kql") {
            await hl.loadLanguage({
              name: "kql",
              ...kqlGrammar,
            }).catch(() => {});
          } else {
            await hl.loadLanguage(lang as any).catch(() => {});
          }
        }
        const htmlLines = lines.map((line) => {
          try {
            return hl.codeToHtml(line || " ", { lang, theme });
          } catch {
            return `<pre><code>${escapeHtml(line)}</code></pre>`;
          }
        });
        setHighlightedLines(htmlLines);
      })
      .catch(() => setHighlightedLines([]));
  }, [content, path, currentTheme]);

  const showSizeWarning = fileSize !== undefined && fileSize > SIZE_WARN_THRESHOLD;

  const handleMouseUp = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) { setSelectionToolbar(null); return; }
    const range = sel.getRangeAt(0);
    const selectedText = sel.toString();
    if (!selectedText.trim()) { setSelectionToolbar(null); return; }

    const startEl = range.startContainer.parentElement?.closest("[data-line-idx]");
    const endEl = range.endContainer.parentElement?.closest("[data-line-idx]");
    if (!startEl || !endEl) { setSelectionToolbar(null); return; }

    const startIdx = Number(startEl.getAttribute("data-line-idx"));
    const endIdx = Number(endEl.getAttribute("data-line-idx"));

    // Use last client rect for positioning near selection end
    const rects = range.getClientRects();
    const lastRect = rects[rects.length - 1] || range.getBoundingClientRect();

    // Position above selection, clamped to viewport
    const toolbarHeight = 36;
    const toolbarWidth = 120;
    let top = lastRect.top - toolbarHeight - 4;
    let left = lastRect.left + (lastRect.width / 2) - (toolbarWidth / 2);

    // Flip below if no room above
    if (top < 4) {
      top = lastRect.bottom + 4;
    }

    // Clamp horizontal
    left = Math.max(4, Math.min(left, window.innerWidth - toolbarWidth - 4));

    setSelectionToolbar({
      position: { top, left },
      lineNumber: startIdx + 1,
      selectedText,
      startOffset: range.startOffset,
      endLine: endIdx + 1,
      endOffset: range.endOffset,
    });
  };

  const handleAddSelectionComment = async () => {
    if (!selectionToolbar) return;
    const { lineNumber, selectedText, startOffset, endLine, endOffset } = selectionToolbar;

    const truncated = truncateSelectedText(selectedText);
    const hash = await computeSelectedTextHash(truncated);

    setPendingSelectionAnchor({
      line: lineNumber,
      end_line: endLine,
      start_column: startOffset,
      end_column: endOffset,
      selected_text: truncated,
      selected_text_hash: hash,
    });

    // Highlight selected lines
    const startLine = lineNumber;
    const endLineNum = endLine ?? lineNumber;
    const highlighted = new Set<number>();
    for (let i = startLine; i <= endLineNum; i++) highlighted.add(i);
    setHighlightedSelectionLines(highlighted);

    setSelectionToolbar(null);
    setCommentingLine(lineNumber);
  };

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
            const lineComments = commentsByLine.get(lineNum) ?? [];
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
                          const lineComments = commentsByLine.get(lineNum) ?? [];
                          if (lineComments.length > 0 && expandedLine !== lineNum) {
                            setExpandedLine(lineNum);
                            setCommentingLine(null);
                            setPendingSelectionAnchor(null);
                          } else {
                            setPendingSelectionAnchor(null);
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
                {(commentingLine === lineNum || expandedLine === lineNum || lineComments.length > 0) && (
                  <LineCommentMargin
                    filePath={filePath}
                    lineNumber={lineNum}
                    lineText={line}
                    matchedComments={lineComments}
                    showInput={commentingLine === lineNum}
                    forceExpanded={expandedLine === lineNum}
                    onCloseInput={() => { setCommentingLine(null); setExpandedLine(null); setPendingSelectionAnchor(null); setHighlightedSelectionLines(new Set()); }}
                    onRequestInput={() => setCommentingLine(lineNum)}
                    onSaveComment={
                      pendingSelectionAnchor && commentingLine === lineNum
                        ? (text: string) => {
                            addComment(filePath, pendingSelectionAnchor, text);
                            setPendingSelectionAnchor(null);
                            setHighlightedSelectionLines(new Set());
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
          onAddComment={handleAddSelectionComment}
          onDismiss={() => setSelectionToolbar(null)}
        />
      )}
    </div>
  );
}
