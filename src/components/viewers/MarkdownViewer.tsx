import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import { getSharedHighlighter } from "@/lib/shiki";
import { openExternalUrl } from "@/lib/tauri-commands";
import { warn } from "@/logger";
import { resolveRelative, dirname } from "@/lib/path-utils";
import { sanitizeSchema } from "./markdown/sanitizeSchema";
import { hasRemoteImageReferences } from "./markdown/useImgResolver";
import { lazyWithSuspense } from "./lazy";
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

// Embedded ```mermaid fenced blocks render inline via the existing
// MermaidView (lazy chunk shared with the .mmd file viewer route).
const MermaidEmbed = lazyWithSuspense<{ content: string }>(() =>
  import("./MermaidView").then((m) => ({ default: m.MermaidView })),
);

// Module-scope components — no dependency on filePath or per-render state.
// The `a` override is injected per-render in MarkdownViewer because it
// closes over `filePath` for relative-path resolution.
const MD_COMPONENTS: Record<string, unknown> = {
  pre: ({ children, node: _node, ...props }: ComponentPropsWithoutRef<"pre"> & ExtraProps) => {
    if (isValidElement(children)) {
      const el = children as ReactElement<{ className?: string; children?: ReactNode }>;
      if (el.type === "code") {
        const { className, children: codeChildren } = el.props;
        const lang = /language-([\w-]+)/.exec(className ?? "")?.[1];
        if (lang === "mermaid") {
          const source = String(codeChildren ?? "").replace(/\n$/, "");
          return <MermaidEmbed content={source} />;
        }
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

// Defense-in-depth: scheme classifiers for the anchor handler. `openExternalUrl`
// already enforces an allowlist, but we should not even call it for known-bad
// schemes — keeps blocking visible at the call site and avoids a logged warn
// per click.
const EXTERNAL_LINK_SCHEME = /^(https?|mailto|tel):/i;
const BLOCKED_LINK_SCHEME = /^(javascript|file|data|vbscript):/i;

function makeAnchorComponent(filePath: string) {
  const baseDir = filePath ? dirname(filePath) : "";
  return function MarkdownAnchor({
    href,
    children,
    node: _node,
    ...props
  }: ComponentPropsWithoutRef<"a"> & ExtraProps) {
    const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (!href) return;
      // Case 1: in-document scroll — let the browser handle it natively.
      if (href.startsWith("#")) return;
      // Case 3: explicitly dangerous scheme — drop and warn.
      if (BLOCKED_LINK_SCHEME.test(href)) {
        e.preventDefault();
        warn(`MarkdownViewer: blocked link scheme: ${href}`);
        return;
      }
      // Case 2: external (http/https/mailto/tel) — defer to the OS opener.
      if (EXTERNAL_LINK_SCHEME.test(href)) {
        e.preventDefault();
        openExternalUrl(href).catch(() => {});
        return;
      }
      // Case 4: workspace-relative path — open inside the app.
      e.preventDefault();
      if (!baseDir) return;
      const resolved = resolveRelative(baseDir, href);
      useStore.getState().openFile(resolved);
    };
    return (
      <a href={href} onClick={handleClick} {...props}>
        {children}
      </a>
    );
  };
}

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

  // Stable img resolver — only changes when filePath/allowance changes.
  const { img } = useImgResolver(filePath);
  const components = useMemo(() => {
    const a = makeAnchorComponent(filePath);
    return { ...MD_COMPONENTS, a, img };
  }, [filePath, img]);

  // A1 banner: only when the doc has remote-image refs AND the user hasn't
  // already opted in for this filePath.
  const remoteImagesAllowed = useStore(
    (s) => s.allowedRemoteImageDocs[filePath] === true,
  );
  const showRemoteImageBanner = useMemo(
    () => !remoteImagesAllowed && hasRemoteImageReferences(body),
    [remoteImagesAllowed, body],
  );
  const handleAllowRemoteImages = useCallback(() => {
    useStore.getState().allowRemoteImagesForDoc(filePath);
  }, [filePath]);

  // Rehype plugin order matters:
  //   1. rehype-raw            → re-parse inline HTML from the markdown AST
  //   2. rehype-sanitize       → strip anything not in `sanitizeSchema`
  //   3. rehype-slug           → assign id="" to headings
  //   4. rehype-autolink-headings → prepend `<a class="heading-anchor">`
  // Sanitization MUST happen between raw HTML re-parse and any downstream
  // plugin that injects elements, so user HTML cannot piggy-back through.
  const rehypePlugins = useMemo(
    () => [
      rehypeRaw,
      [rehypeSanitize, sanitizeSchema],
      rehypeSlug,
      [
        rehypeAutolinkHeadings,
        {
          behavior: "prepend",
          properties: { className: ["heading-anchor"], ariaHidden: "true", tabIndex: -1 },
          content: { type: "text", value: "#" },
        },
      ],
    ],
    [],
  );

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
        {showRemoteImageBanner && (
          <div
            className="remote-image-banner"
            role="status"
            style={{
              padding: "6px 12px",
              marginBottom: 12,
              background: "var(--color-canvas-subtle, #f6f8fa)",
              border: "1px solid var(--color-border, #d0d7de)",
              borderRadius: 6,
              fontSize: 12,
            }}
          >
            This document contains remote images.{" "}
            <button
              type="button"
              className="comment-btn"
              onClick={handleAllowRemoteImages}
              aria-label="Allow remote images for this document"
            >
              Allow remote images for this document
            </button>
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
            rehypePlugins={rehypePlugins as never}
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
        <ReadingWidthHandle containerRef={readingContainerRef} side="left" />
        <ReadingWidthHandle containerRef={readingContainerRef} side="right" />
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
