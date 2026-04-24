import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import { getSharedHighlighter } from "@/lib/shiki";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl as shellOpen } from "@tauri-apps/plugin-opener";
import { useTheme } from "@/hooks/useTheme";
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
import { useComments } from "@/lib/vm/use-comments";
import { useCommentActions } from "@/lib/vm/use-comment-actions";
import type { CommentThread as CommentThreadType, CommentAnchor } from "@/lib/tauri-commands";
import { dirname } from "@/lib/path-utils";
import { SIZE_WARN_THRESHOLD } from "@/lib/comment-utils";
import { useThreadsByLine } from "@/hooks/useThreadsByLine";
import { useScrollToLine } from "@/hooks/useScrollToLine";
import { useSelectionToolbar } from "@/hooks/useSelectionToolbar";
import "@/styles/markdown.css";

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
  const nlIdx = content.indexOf("\n");
  if (nlIdx === -1) return { body: content, data: null };
  const end = content.indexOf("\n---", nlIdx + 1);
  if (end === -1) return { body: content, data: null };
  const yaml = content.slice(nlIdx + 1, end);
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

// Shiki highlighter is shared via @/lib/shiki

function HighlightedCode({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string | null>(null);

  // Track data-theme for reactive re-highlighting
  const currentTheme = useTheme();

  useEffect(() => {
    const theme = currentTheme === "dark" ? "github-dark" : "github-light";

    getSharedHighlighter()
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
  return function CommentableBlock({ children, node, ...props }: ComponentPropsWithoutRef<"div"> & ExtraProps) {
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
        // Only open http/https URLs in external browser (security: block file://, javascript:, etc.)
        if (/^https?:\/\//i.test(href)) {
          shellOpen(href).catch(() => {});
        }
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

// Extracted to avoid reading refs during render in the parent component
function MdCommentPopover({
  expandedLine,
  commentingLine,
  bodyRef,
  threadsByLine,
  filePath,
  lines,
  pendingSelectionAnchor,
  addComment,
  setCommentingLine,
  setExpandedLine,
  clearSelection,
}: {
  expandedLine: number | null;
  commentingLine: number | null;
  bodyRef: React.RefObject<HTMLDivElement | null>;
  threadsByLine: Map<number, CommentThreadType[]>;
  filePath: string;
  lines: string[];
  pendingSelectionAnchor: CommentAnchor | null;
  addComment: (filePath: string, text: string, anchor?: CommentAnchor) => Promise<void>;
  setCommentingLine: (v: number | null) => void;
  setExpandedLine: (v: number | null) => void;
  clearSelection: () => void;
}) {
  const activeLine = expandedLine ?? commentingLine;
  const [position, setPosition] = useState<{ top: number } | null>(null);

  useEffect(() => {
    if (!activeLine || !bodyRef.current) {
      setPosition(null);
      return;
    }
    const el = bodyRef.current.querySelector(`[data-source-line="${activeLine}"]`);
    if (!el) {
      setPosition(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    const containerRect = bodyRef.current.getBoundingClientRect();
    setPosition({ top: rect.top - containerRect.top + rect.height });
  }, [activeLine, bodyRef]);

  if (!activeLine || !position) return null;

  const lineThreads = threadsByLine.get(activeLine) ?? [];
  return (
    <div className="md-comment-popover" style={{
      position: "absolute",
      top: position.top,
      left: 24,
      zIndex: 20,
    }}>
      {lineThreads.length > 0 && (
        <div className="md-comment-threads">
          {lineThreads.map(t => <CommentThread key={t.root.id} rootComment={t.root} replies={t.replies} filePath={filePath} />)}
        </div>
      )}

      {commentingLine === activeLine ? (
        <LineCommentMargin
          filePath={filePath}
          lineNumber={activeLine}
          lineText={lines[activeLine - 1] ?? ""}
          threads={[]}
          showInput={true}
          onCloseInput={() => { setCommentingLine(null); setExpandedLine(null); clearSelection(); }}
          onSaveComment={
            pendingSelectionAnchor
              ? (text: string) => {
                  addComment(filePath, text, pendingSelectionAnchor).catch(() => {});
                  clearSelection();
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
}

export function MarkdownViewer({ content, filePath, fileSize }: Props) {
  const { body, data } = useMemo(() => parseFrontmatter(content), [content]);
  const headings = useMemo(() => extractHeadings(body), [body]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [commentingLine, setCommentingLine] = useState<number | null>(null);
  const [expandedLine, setExpandedLine] = useState<number | null>(null);

  const lines = useMemo(() => body.split("\n"), [body]);

  const { threads } = useComments(filePath);
  const { addComment } = useCommentActions();

  const threadsByLine = useThreadsByLine(threads);

  const {
    selectionToolbar,
    setSelectionToolbar,
    pendingSelectionAnchor,
    handleMouseUp,
    handleAddSelectionComment,
    clearSelection,
  } = useSelectionToolbar("data-source-line", 0);

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

  // Scroll-to-line from CommentsPanel click
  const handleScrollTo = useCallback((line: number) => {
    setExpandedLine(line);
    setCommentingLine(null);
  }, []);
  useScrollToLine(bodyRef, "data-source-line", undefined, handleScrollTo);

  const showSizeWarning = fileSize !== undefined && fileSize > SIZE_WARN_THRESHOLD;

  const commentCountByLine = useMemo(() => {
    const map = new Map<number, number>();
    for (const t of threads) {
      if (!t.root.resolved) {
        const line = t.root.matchedLineNumber;
        map.set(line, (map.get(line) ?? 0) + 1);
      }
      for (const r of t.replies) {
        if (!r.resolved) {
          const line = r.matchedLineNumber;
          map.set(line, (map.get(line) ?? 0) + 1);
        }
      }
    }
    return map;
  }, [threads]);

  const handleLineClick = useCallback((line: number) => {
    const lineThreads = threadsByLine.get(line) ?? [];
    if (lineThreads.length > 0) {
      setExpandedLine(expandedLine === line ? null : line);
      setCommentingLine(null);
    } else {
      setCommentingLine(commentingLine === line ? null : line);
      setExpandedLine(null);
    }
  }, [threadsByLine, expandedLine, commentingLine]);

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
          {(expandedLine !== null || commentingLine !== null) && (
            <MdCommentPopover
              expandedLine={expandedLine}
              commentingLine={commentingLine}
              bodyRef={bodyRef}
              threadsByLine={threadsByLine}
              filePath={filePath}
              lines={lines}
              pendingSelectionAnchor={pendingSelectionAnchor}
              addComment={addComment}
              setCommentingLine={setCommentingLine}
              setExpandedLine={setExpandedLine}
              clearSelection={clearSelection}
            />
          )}
        </div>
      </MdCommentContext.Provider>
      {selectionToolbar && (
        <SelectionToolbar
          position={selectionToolbar.position}
          onAddComment={() => handleAddSelectionComment((line) => {
            setCommentingLine(line);
            setExpandedLine(null);
          })}
          onDismiss={() => setSelectionToolbar(null)}
        />
      )}
    </div>
  );
}
