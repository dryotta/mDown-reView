import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import { createHighlighter } from "shiki";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl as shellOpen } from "@tauri-apps/plugin-opener";
import {
  useState,
  useEffect,
  useRef,
  isValidElement,
  useMemo,
  createContext,
  useContext,
  useCallback,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
} from "react";
import type { ExtraProps } from "react-markdown";
import { FrontmatterBlock } from "./FrontmatterBlock";
import { TableOfContents, extractHeadings } from "./TableOfContents";
import { LineCommentMargin } from "@/components/comments/LineCommentMargin";
import { CommentThread } from "@/components/comments/CommentThread";
import { SelectionToolbar } from "@/components/comments/SelectionToolbar";
import { matchComments } from "@/lib/comment-matching";
import { groupCommentsIntoThreads } from "@/lib/comment-threads";
import { useStore } from "@/store";
import type { CommentWithOrphan } from "@/store";
import { loadReviewComments, saveReviewComments } from "@/lib/tauri-commands";
import { dirname } from "@/lib/path-utils";
import "@/styles/markdown.css";

const SIZE_WARN_THRESHOLD = 500 * 1024;

interface Props {
  content: string;
  filePath: string;
  fileSize?: number;
}

function parseFrontmatter(content: string): {
  body: string;
  data: Record<string, unknown> | null;
} {
  if (!content.startsWith("---")) return { body: content, data: null };
  const end = content.indexOf("\n---", 4);
  if (end === -1) return { body: content, data: null };
  const yaml = content.slice(4, end);
  const body = content.slice(end + 4).trimStart();
  const data: Record<string, unknown> = {};
  for (const line of yaml.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key) data[key] = value;
  }
  return { body, data };
}

let highlighterPromise: ReturnType<typeof createHighlighter> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-light", "github-dark"],
      langs: [],
    });
  }
  return highlighterPromise;
}

function HighlightedCode({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string | null>(null);

  // Track data-theme for reactive re-highlighting
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

  useEffect(() => {
    const theme = currentTheme === "dark" ? "github-dark" : "github-light";

    getHighlighter()
      .then(async (h) => {
        const result = await h.codeToHtml(code, { lang, theme, defaultColor: false });
        setHtml(result);
      })
      .catch(() => {});
  }, [code, lang, currentTheme]);

  if (html) {
    return <div dangerouslySetInnerHTML={{ __html: html }} />;
  }

  return (
    <pre>
      <code className={`language-${lang}`}>{code}</code>
    </pre>
  );
}

// Context for inline comment gutters in markdown blocks
interface MdCommentContextValue {
  commentCountByLine: Map<number, number>;
}

const MdCommentContext = createContext<MdCommentContextValue>({
  commentCountByLine: new Map(),
});

// Inline gutter component for commentable markdown blocks
function makeCommentableBlock(Tag: string) {
  return function CommentableBlock({ children, node, ...props }: ComponentPropsWithoutRef<any> & ExtraProps) {
    const line = node?.position?.start.line ?? 0;
    const { commentCountByLine } = useContext(MdCommentContext);
    const count = commentCountByLine.get(line) ?? 0;

    return (
      <div
        className={`md-commentable-block${count > 0 ? " has-comments" : ""}`}
        data-source-line={line}
        data-comment-count={count > 0 ? count : undefined}
      >
        {React.createElement(Tag, props, children)}
      </div>
    );
  };
}

function CommentableLi({ children, node, ...props }: ComponentPropsWithoutRef<"li"> & ExtraProps) {
  const line = node?.position?.start.line ?? 0;
  const { commentCountByLine } = useContext(MdCommentContext);
  const count = commentCountByLine.get(line) ?? 0;

  return (
    <li
      {...props}
      data-source-line={line}
      data-comment-count={count > 0 ? count : undefined}
      className={`md-commentable-li${count > 0 ? " has-comments" : ""}`}
    >
      {children}
    </li>
  );
}

// Module-scope components — no dependency on filePath or per-render state
const MD_COMPONENTS: Record<string, unknown> = {
  a: ({ href, children, node: _node, ...props }: ComponentPropsWithoutRef<"a"> & ExtraProps) => {
    const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (href) {
        e.preventDefault();
        shellOpen(href).catch(() => {});
      }
    };
    return (
      <a href={href} onClick={handleClick} {...props}>
        {children}
      </a>
    );
  },
  pre: ({ children, node: _node, ...props }: ComponentPropsWithoutRef<"pre"> & ExtraProps) => {
    if (isValidElement(children)) {
      const el = children as ReactElement<{ className?: string; children?: ReactNode }>;
      if (el.type === "code") {
        const { className, children: codeChildren } = el.props;
        const lang = /language-([\w-]+)/.exec(className ?? "")?.[1];
        if (lang) {
          return (
            <HighlightedCode
              code={String(codeChildren ?? "").replace(/\n$/, "")}
              lang={lang}
            />
          );
        }
      }
    }
    return <pre {...props}>{children}</pre>;
  },
  p: makeCommentableBlock("p"),
  h1: makeCommentableBlock("h1"),
  h2: makeCommentableBlock("h2"),
  h3: makeCommentableBlock("h3"),
  h4: makeCommentableBlock("h4"),
  h5: makeCommentableBlock("h5"),
  h6: makeCommentableBlock("h6"),
  li: CommentableLi,
};

export function MarkdownViewer({ content, filePath, fileSize }: Props) {
  const { body, data } = useMemo(() => parseFrontmatter(content), [content]);
  const headings = useMemo(() => extractHeadings(body), [body]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [commentingLine, setCommentingLine] = useState<number | null>(null);
  const [expandedLine, setExpandedLine] = useState<number | null>(null);
  const [selectionToolbar, setSelectionToolbar] = useState<{
    position: { top: number; left: number };
    lineNumber: number;
    selectedText: string;
  } | null>(null);
  const [pendingSelectionAnchor, setPendingSelectionAnchor] = useState<Record<string, unknown> | null>(null);

  const lines = useMemo(() => body.split("\n"), [body]);

  const setFileComments = useStore((s) => s.setFileComments);
  const addComment = useStore((s) => s.addComment);
  const comments = useStore((s) => s.commentsByFile[filePath]);
  const setLastSaveTimestamp = useStore((s) => s.setLastSaveTimestamp);
  const loadedRef = useRef<string | null>(null);
  const [commentReloadKey, setCommentReloadKey] = useState(0);

  const matchedComments = useMemo(() => {
    if (!comments || comments.length === 0) return [];
    return matchComments(comments, lines);
  }, [comments, lines]);

  const commentsByLine = useMemo(() => {
    const map = new Map<number, CommentWithOrphan[]>();
    for (const c of matchedComments) {
      const ln = c.matchedLineNumber ?? c.line ?? 1;
      const arr = map.get(ln) ?? [];
      arr.push(c);
      map.set(ln, arr);
    }
    return map;
  }, [matchedComments]);

  // Build components with img resolver (only img depends on filePath)
  const components = useMemo(() => ({
    ...MD_COMPONENTS,
    img: ({ src, alt, node: _node, ...props }: ComponentPropsWithoutRef<"img"> & ExtraProps) => {
      let resolvedSrc = src;
      if (src && !src.startsWith("http://") && !src.startsWith("https://") && !src.startsWith("data:")) {
        const fileDir = dirname(filePath);
        const absolute = src.startsWith("/") || src.startsWith("\\") || /^[a-zA-Z]:/.test(src)
          ? src
          : `${fileDir}/${src}`;
        resolvedSrc = convertFileSrc(absolute);
      }
      return <img src={resolvedSrc} alt={alt ?? ""} {...props} />;
    },
  }), [filePath]);

  // Load comments from sidecar on file open
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
        if (!cancelled) loadedRef.current = filePath;
      });
    return () => { cancelled = true; };
  }, [filePath, setFileComments]);

  // Listen for review sidecar changes
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path: string; kind: string };
      // The review sidecar path is filePath + ".review.json"
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
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [commentReloadKey, filePath, setFileComments]);

  // Auto-save comments to sidecar (debounced, only after initial load)
  useEffect(() => {
    if (loadedRef.current !== filePath) return;
    const timer = setTimeout(() => {
      const document = filePath.split(/[/\\]/).pop() ?? filePath;
      saveReviewComments(filePath, document, comments ?? [])
        .then(() => setLastSaveTimestamp(Date.now()))
        .catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [comments, filePath, setLastSaveTimestamp]);

  // Scroll-to-line from CommentsPanel click
  useEffect(() => {
    const handler = (e: Event) => {
      const line = (e as CustomEvent).detail.line;
      const el = bodyRef.current?.querySelector(`[data-source-line="${line}"]`);
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

  const showSizeWarning = fileSize !== undefined && fileSize > SIZE_WARN_THRESHOLD;

  const commentCountByLine = useMemo(() => {
    const map = new Map<number, number>();
    for (const [ln, cmts] of commentsByLine) {
      map.set(ln, cmts.filter(c => !c.resolved).length);
    }
    return map;
  }, [commentsByLine]);

  const handleLineClick = useCallback((line: number) => {
    const lineComments = commentsByLine.get(line) ?? [];
    if (lineComments.length > 0) {
      setExpandedLine(expandedLine === line ? null : line);
      setCommentingLine(null);
    } else {
      setCommentingLine(commentingLine === line ? null : line);
      setExpandedLine(null);
    }
  }, [commentsByLine, expandedLine, commentingLine]);

  const contextValue = useMemo(() => ({
    commentCountByLine,
  }), [commentCountByLine]);

  const handleGutterClick = useCallback((e: React.MouseEvent) => {
    const container = bodyRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const relativeX = e.clientX - containerRect.left;

    // Only handle clicks in the gutter zone (left 28px)
    if (relativeX > 28) return;

    const target = (e.target as HTMLElement).closest("[data-source-line]");
    if (!target) return;
    const line = Number(target.getAttribute("data-source-line"));
    if (line <= 0) return;

    e.stopPropagation();
    handleLineClick(line);
  }, [handleLineClick]);

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { setSelectionToolbar(null); return; }
    const range = sel.getRangeAt(0);
    const selectedText = sel.toString().trim();
    if (!selectedText) { setSelectionToolbar(null); return; }

    const startNode = range.startContainer;
    const startElement = startNode.nodeType === Node.TEXT_NODE ? startNode.parentElement : startNode as HTMLElement;
    const lineElement = startElement?.closest("[data-source-line]");
    if (!lineElement) { setSelectionToolbar(null); return; }

    const lineNumber = Number(lineElement.getAttribute("data-source-line"));
    if (!lineNumber) { setSelectionToolbar(null); return; }

    const rects = range.getClientRects();
    const lastRect = rects[rects.length - 1] || range.getBoundingClientRect();

    const toolbarHeight = 36;
    const toolbarWidth = 120;
    let top = lastRect.top - toolbarHeight - 4;
    let left = lastRect.left + (lastRect.width / 2) - (toolbarWidth / 2);

    if (top < 4) top = lastRect.bottom + 4;
    left = Math.max(4, Math.min(left, window.innerWidth - toolbarWidth - 4));

    setSelectionToolbar({ position: { top, left }, lineNumber, selectedText });
  }, []);

  const handleAddSelectionComment = useCallback(() => {
    if (!selectionToolbar) return;
    const { lineNumber, selectedText } = selectionToolbar;

    setPendingSelectionAnchor({
      line: lineNumber,
      selected_text: selectedText,
    });

    setSelectionToolbar(null);
    setCommentingLine(lineNumber);
    setExpandedLine(null);
  }, [selectionToolbar]);

  return (
    <div className="markdown-viewer">
      {showSizeWarning && (
        <div className="size-warning" role="alert">
          This file is large ({Math.round((fileSize ?? 0) / 1024)} KB) — rendering may be slow
        </div>
      )}
      {data && <FrontmatterBlock data={data} />}
      <TableOfContents headings={headings} />
      <MdCommentContext.Provider value={contextValue}>
        <div
          className="markdown-body"
          ref={bodyRef}
          onClick={handleGutterClick}
          onMouseUp={handleMouseUp}
          style={{ position: "relative" }}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSlug]}
            components={components as never}
          >
            {body}
          </ReactMarkdown>

          {/* Comment popover for expanded/commenting line */}
          {(expandedLine !== null || commentingLine !== null) && (() => {
            const activeLine = expandedLine ?? commentingLine;
            if (!activeLine) return null;
            const el = bodyRef.current?.querySelector(`[data-source-line="${activeLine}"]`);
            if (!el) return null;
            const rect = el.getBoundingClientRect();
            const containerRect = bodyRef.current!.getBoundingClientRect();
            const lineComments = commentsByLine.get(activeLine) ?? [];

            return (
              <div className="md-comment-popover" style={{
                position: "absolute",
                top: rect.top - containerRect.top + rect.height,
                left: 24,
                zIndex: 20,
              }}>
                {lineComments.length > 0 && (
                  <div className="md-comment-threads">
                    {groupCommentsIntoThreads(lineComments).map(t => <CommentThread key={t.root.id} rootComment={t.root} replies={t.replies} filePath={filePath} />)}
                  </div>
                )}

                {commentingLine === activeLine ? (
                  <LineCommentMargin
                    filePath={filePath}
                    lineNumber={activeLine}
                    lineText={lines[activeLine - 1] ?? ""}
                    fileLines={lines}
                    matchedComments={[]}
                    showInput={true}
                    onCloseInput={() => { setCommentingLine(null); setExpandedLine(null); setPendingSelectionAnchor(null); }}
                    onSaveComment={
                      pendingSelectionAnchor
                        ? (text: string) => {
                            addComment(filePath, pendingSelectionAnchor as any, text);
                            setPendingSelectionAnchor(null);
                          }
                        : undefined
                    }
                  />
                ) : (
                  <button
                    className="comment-btn comment-btn-primary"
                    style={{ marginTop: 8 }}
                    onClick={() => setCommentingLine(activeLine)}
                  >
                    Add comment
                  </button>
                )}
              </div>
            );
          })()}
        </div>
      </MdCommentContext.Provider>
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
