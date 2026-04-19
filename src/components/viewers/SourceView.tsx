import { useEffect, useState, useRef } from "react";
import { createHighlighter, type Highlighter } from "shiki";
import { extname } from "@/lib/path-utils";
import { fnv1a8 } from "@/lib/fnv1a";
import { useStore } from "@/store";
import { loadReviewComments, saveReviewComments } from "@/lib/tauri-commands";
import { LineCommentMargin } from "@/components/comments/LineCommentMargin";
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

  const setFileComments = useStore((s) => s.setFileComments);
  const comments = useStore((s) => s.commentsByFile[filePath]);
  const loadedRef = useRef<string | null>(null);

  const lines = content.split("\n");

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

  return (
    <div className={`source-view${wordWrap ? " wrap-enabled" : ""}`}>
      {showSizeWarning && (
        <div className="size-warning" role="alert">
          This file is large ({Math.round((fileSize ?? 0) / 1024)} KB) — rendering may be slow
        </div>
      )}
      <div className="source-lines">
        {lines.map((line, idx) => {
          const lineNum = idx + 1;
          const lineHash = fnv1a8(line.trim());
          const lineComments = (comments ?? []).filter(
            (c) => c.anchorType === "line" && c.lineHash === lineHash
          );
          return (
            <div key={idx}>
              <div className="source-line">
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
                  <span className="source-line-number-zone">{lineNum}</span>
                </span>
                <span
                  className="source-line-content"
                  dangerouslySetInnerHTML={{
                    __html: highlightedLines[idx]
                      ? extractInnerCode(highlightedLines[idx])
                      : escapeHtml(line),
                  }}
                />
              </div>
              {(commentingLine === lineNum || lineComments.length > 0) && (
                <LineCommentMargin
                  filePath={filePath}
                  lineNumber={lineNum}
                  lineHash={lineHash}
                  showInput={commentingLine === lineNum}
                  onCloseInput={() => setCommentingLine(null)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
