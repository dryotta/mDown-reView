import { useEffect, useState, useRef, useMemo } from "react";
import { createHighlighter, type Highlighter } from "shiki";
import { extname } from "@/lib/path-utils";
import { matchComments } from "@/lib/comment-matching";
import { computeLineHash, captureContext } from "@/lib/comment-anchors";
import { useStore } from "@/store";
import { loadReviewComments, saveReviewComments } from "@/lib/tauri-commands";
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
  const { query, setQuery, matches, currentIndex, next, prev } = useSearch(content);

  const setFileComments = useStore((s) => s.setFileComments);
  const comments = useStore((s) => s.commentsByFile[filePath]);
  const addComment = useStore((s) => s.addComment);
  const loadedRef = useRef<string | null>(null);

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
      .finally(() => { if (!cancelled) loadedRef.current = filePath; });
    return () => { cancelled = true; };
  }, [filePath, setFileComments]);

  // Reset folds when file changes
  useEffect(() => { setCollapsedLines(new Set()); }, [filePath]);

  // Auto-save comments
  useEffect(() => {
    if (loadedRef.current !== filePath) return;
    const timer = setTimeout(() => {
      saveReviewComments(filePath, comments ?? []).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [comments, filePath]);

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
      const ln = c.matchedLineNumber ?? c.lineNumber ?? 1;
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
              scopeName: "source.kql",
              ...kqlGrammar,
            }).catch(() => {});
          } else {
            await hl.loadLanguage(lang).catch(() => {});
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
    const rect = range.getBoundingClientRect();

    setSelectionToolbar({
      position: { top: rect.top - 40, left: rect.left },
      lineNumber: startIdx + 1,
      selectedText,
      startOffset: range.startOffset,
      endLine: endIdx + 1,
      endOffset: range.endOffset,
    });
  };

  const handleAddSelectionComment = () => {
    if (!selectionToolbar) return;
    const { lineNumber, selectedText, startOffset, endLine, endOffset } = selectionToolbar;
    const idx = lineNumber - 1;
    const ctx = captureContext(lines, idx);
    addComment(filePath, {
      anchorType: "selection",
      lineHash: computeLineHash(lines[idx] ?? ""),
      lineNumber,
      contextBefore: ctx.contextBefore,
      contextAfter: ctx.contextAfter,
      selectedText,
      selectionStartOffset: startOffset,
      selectionEndLine: endLine,
      selectionEndOffset: endOffset,
    }, "");
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
                <div className="source-line" data-line-idx={idx}>
                  <span className="source-line-gutter">
                    <span className="source-line-comment-zone">
                      <button
                        className="comment-plus-btn"
                        aria-label="Add comment"
                        onClick={() => setCommentingLine(
                          commentingLine === lineNum ? null : lineNum
                        )}
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
                {(commentingLine === lineNum || lineComments.length > 0) && (
                  <LineCommentMargin
                    filePath={filePath}
                    lineNumber={lineNum}
                    lineText={line}
                    fileLines={lines}
                    matchedComments={lineComments}
                    showInput={commentingLine === lineNum}
                    onCloseInput={() => setCommentingLine(null)}
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
