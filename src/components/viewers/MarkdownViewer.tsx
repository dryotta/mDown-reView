import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import { getSharedHighlighter } from "@/lib/shiki";
import { openExternalUrl } from "@/lib/tauri-commands";
import { useTheme } from "@/hooks/useTheme";
import {
  useState,
  useEffect,
  useRef,
  isValidElement,
  useMemo,
  useCallback,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
} from "react";
import type { ExtraProps } from "react-markdown";
import { FrontmatterBlock } from "./FrontmatterBlock";
import { TableOfContents, extractHeadings } from "./TableOfContents";
import { SelectionToolbar } from "@/components/comments/SelectionToolbar";
import { useComments } from "@/lib/vm/use-comments";
import { useCommentActions } from "@/lib/vm/use-comment-actions";
import {
  MdCommentContext,
  makeCommentableBlock,
  CommentableLi,
  MdCommentPopover,
} from "./markdown/CommentableBlocks";
import { useImgResolver } from "./markdown/useImgResolver";
import { ReadingWidthHandle } from "./ReadingWidthHandle";
import { useStore } from "@/store";
import { parseFrontmatter } from "@/lib/frontmatter";
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

// Module-scope components — no dependency on filePath or per-render state
const MD_COMPONENTS: Record<string, unknown> = {
  a: ({ href, children, node: _node, ...props }: ComponentPropsWithoutRef<"a"> & ExtraProps) => {
    const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (href) {
        e.preventDefault();
        // Only open http/https URLs in external browser (security: block file://, javascript:, etc.)
        if (/^https?:\/\//i.test(href)) {
          openExternalUrl(href).catch(() => {});
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

export function MarkdownViewer({ content, filePath, fileSize }: Props) {
  const { body, data } = useMemo(() => parseFrontmatter(content), [content]);
  const headings = useMemo(() => extractHeadings(body), [body]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const readingContainerRef = useRef<HTMLDivElement>(null);
  const readingWidth = useStore((s) => s.readingWidth);
  const [commentingLine, setCommentingLine] = useState<number | null>(null);
  const [expandedLine, setExpandedLine] = useState<number | null>(null);

  const lines = useMemo(() => body.split("\n"), [body]);

  const { threads } = useComments(filePath);
  const { addComment } = useCommentActions();

  const { threadsByLine, commentCountByLine } = useThreadsByLine(threads);

  const {
    selectionToolbar,
    setSelectionToolbar,
    pendingSelectionAnchor,
    handleMouseUp,
    handleAddSelectionComment,
    clearSelection,
  } = useSelectionToolbar("data-source-line", 0);

  // Stable img resolver — only changes when filePath changes
  const { img } = useImgResolver(filePath);
  const components = useMemo(() => ({ ...MD_COMPONENTS, img }), [img]);

  // Scroll-to-line from CommentsPanel click
  const handleScrollTo = useCallback((line: number) => {
    setExpandedLine(line);
    setCommentingLine(null);
  }, []);
  useScrollToLine(bodyRef, "data-source-line", undefined, handleScrollTo);

  const showSizeWarning = fileSize !== undefined && fileSize > SIZE_WARN_THRESHOLD;

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
      <div
        className="reading-width"
        ref={readingContainerRef}
        style={{ ["--reading-width" as string]: `${readingWidth}px` }}
      >
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
        <ReadingWidthHandle containerRef={readingContainerRef} />
      </div>
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
