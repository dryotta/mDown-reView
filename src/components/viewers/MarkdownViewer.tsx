import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkGithubAlerts } from "@/lib/remark-github-alerts";
import remarkMath from "remark-math";
import rehypeSlug from "rehype-slug";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import { getSharedHighlighter } from "@/lib/shiki";
import { openExternalUrl } from "@/lib/tauri-commands";
import { warn, info } from "@/logger";
import { resolveWorkspacePath, dirname } from "@/lib/path-utils";
import { EXTERNAL_LINK_SCHEME, BLOCKED_LINK_SCHEME } from "@/lib/url-policy";
import { sanitizeSchema } from "./markdown/sanitizeSchema";
import { rehypeFootnotePrefix } from "./markdown/rehype-footnote-prefix";
import { rehypeKatexStyle } from "./markdown/rehype-katex-style";
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
import { useZoom } from "@/hooks/useZoom";
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

// B3: cheap pre-scan for KaTeX-capable syntax. Inline `$…$` requires a
// non-space char immediately after the opening `$` AND immediately before
// the closing `$`. Currency-only spans like `$5 and $10` (digits without
// math operators) are rejected; valid digit-starting math like `$2^n$` or
// `$100 + x$` is admitted because operator chars (^_\\{}=+-*/<>|) appear
// inside the span. Fenced `$$…$$` may span multiple lines.
const INLINE_MATH_RE = /\$(?![\d\s][^$\n]*\$)(?![\s])[^$\n]*[^$\s]\$/;
const BLOCK_MATH_RE = /\$\$[\s\S]+?\$\$/;
const DIGIT_INLINE_MATH_RE = /\$\d[^$\n]*[\^_\\{}=+\-*/<>|][^$\n]*\$/;
export const HAS_MATH_RE = {
  test: (s: string): boolean =>
    BLOCK_MATH_RE.test(s) || INLINE_MATH_RE.test(s) || DIGIT_INLINE_MATH_RE.test(s),
};

// One-shot, idempotent loader for KaTeX's stylesheet. We inject a `<link>`
// rather than a static `import "katex/dist/katex.min.css"` so the ~50 KB
// CSS (and the ~280 KB of @font-face woff2 it references on first paint)
// stays out of the initial bundle. Subsequent calls are cheap no-ops.
let katexCssPromise: Promise<void> | null = null;
async function ensureKatexCssLoaded(): Promise<void> {
  if (katexCssPromise) return katexCssPromise;
  katexCssPromise = (async () => {
    const mod = await import("katex/dist/katex.min.css?url");
    const href = mod.default;
    if (typeof document === "undefined") return;
    if (document.querySelector(`link[data-katex-css="1"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.katexCss = "1";
    document.head.appendChild(link);
  })();
  return katexCssPromise;
}

// R3: stable module-scope remark plugin tuple — no plugin closes over per-render
// state, so this never needs to be rebuilt per render.
const REMARK_PLUGINS = [remarkGfm, remarkMath, remarkGithubAlerts] as const;

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
        if (lang?.toLowerCase() === "mermaid") {
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
// per click. Hoisted to `@/lib/url-policy` so MarkdownViewer, HtmlPreviewView,
// and the openExternalUrl chokepoint share one definition.

function makeAnchorComponent(filePath: string, workspaceRoot: string) {
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
      // Case 4: workspace-relative path — open inside the app, but ONLY if
      // the resolved target is contained within the workspace root. Defends
      // against `[x](/etc/passwd)` and `[x](../../../../etc/passwd)`.
      e.preventDefault();
      if (!baseDir) return;
      const resolved = resolveWorkspacePath(workspaceRoot, baseDir, href);
      if (!resolved) {
        warn(`MarkdownViewer: dropped link outside workspace: ${href}`);
        return;
      }
      // Capture the "from" tab so back/forward works even when the source
      // tab was opened outside any pushHistory site (e.g. sidebar click).
      // History recording is centralized in `tabs.openFile` (B2).
      useStore.getState().openFile(resolved.path);
      if (resolved.fragment) {
        // Fragment scroll on the freshly opened tab is deferred — the new
        // viewer mounts after a tick. Logging keeps the behaviour visible.
        info(`MarkdownViewer: link fragment "#${resolved.fragment}" not yet scrolled`);
      }
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
  // Per-filetype zoom (#65 D1/D2/D3). Same `.md` key shared by source-mode
  // and visual-mode viewers so the EnhancedViewer toolbar drives both.
  const { zoom } = useZoom(".md");
  const [commentingLine, setCommentingLine] = useState<number | null>(null);
  const [expandedLine, setExpandedLine] = useState<number | null>(null);

  const lines = useMemo(() => body.split("\n"), [body]);

  const { threads } = useComments(filePath);
  const { addComment, commitMoveAnchor } = useCommentActions();

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
  const workspaceRoot = useStore((s) => s.root) ?? "";
  const components = useMemo(() => {
    const a = makeAnchorComponent(filePath, workspaceRoot);
    return { ...MD_COMPONENTS, a, img };
  }, [filePath, img, workspaceRoot]);

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

  // B3: detect math syntax in the body. Cheap regex pre-scan so we only
  // pay the KaTeX cost on documents that actually use math.
  const hasMath = useMemo(() => HAS_MATH_RE.test(body), [body]);
  // L4: lazy-load `rehype-katex` so its ~200 KB JS lands in a separate chunk
  // and only when a doc actually uses math. Plugin is `null` until loaded.
  const [rehypeKatexPlugin, setRehypeKatexPlugin] = useState<unknown | null>(null);
  useEffect(() => {
    if (!hasMath) return;
    ensureKatexCssLoaded();
    if (rehypeKatexPlugin) return;
    let cancelled = false;
    import("rehype-katex").then((m) => {
      if (!cancelled) setRehypeKatexPlugin(() => m.default);
    });
    return () => {
      cancelled = true;
    };
  }, [hasMath, rehypeKatexPlugin]);

  // Rehype plugin order matters:
  //   1. rehype-raw                 → re-parse inline HTML from the markdown AST
  //   2. rehype-footnote-prefix     → S1: strip pre-existing user-content- so
  //                                   sanitize can re-apply it cleanly on ids.
  //   3. rehype-katex (lazy)        → math nodes → KaTeX HTML+MathML, before
  //                                   sanitize so its output flows through the
  //                                   schema rather than around it.
  //   4. rehype-katex-style         → S2: drop `style` from non-KaTeX <span>/<math>
  //                                   so the schema's KaTeX-only style allowance
  //                                   cannot be abused via raw markdown HTML.
  //   5. rehype-sanitize            → strip anything not in `sanitizeSchema`.
  //   6. rehype-slug + autolink     → assign ids and prepend anchors.
  // Sanitization MUST happen between any HTML-injecting plugin and any
  // downstream plugin that consumes it, so user/plugin HTML cannot piggy-back
  // through with attributes the schema doesn't allow.
  const rehypePlugins = useMemo(
    () => {
      const plugins: unknown[] = [rehypeRaw, rehypeFootnotePrefix];
      if (rehypeKatexPlugin) plugins.push(rehypeKatexPlugin);
      plugins.push(rehypeKatexStyle);
      plugins.push([rehypeSanitize, sanitizeSchema]);
      plugins.push(rehypeSlug);
      plugins.push([
        rehypeAutolinkHeadings,
        {
          behavior: "prepend",
          properties: { className: ["heading-anchor"], ariaHidden: "true", tabIndex: -1 },
          content: { type: "text", value: "#" },
        },
      ]);
      return plugins;
    },
    [rehypeKatexPlugin],
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
    // Move-anchor mode: any click in the body re-anchors the active thread to
    // the clicked source line. Read via getState() (rule 9 — imperative path).
    const moveTarget = useStore.getState().moveAnchorTarget;
    if (moveTarget !== null) {
      const lineEl = (e.target as HTMLElement).closest("[data-source-line]");
      const lineNumStr = lineEl?.getAttribute("data-source-line");
      if (lineNumStr) {
        const line = parseInt(lineNumStr, 10);
        if (line > 0) {
          void commitMoveAnchor(filePath, moveTarget, { kind: "line", line });
          useStore.getState().setMoveAnchorTarget(null);
          e.stopPropagation();
        }
      }
      // No clickable line under the cursor → leave move mode active so a
      // missed click does not silently exit. Esc / Cancel button still cancels.
      return;
    }

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
  }, [handleLineClick, commitMoveAnchor, filePath]);

  return (
    <div className="markdown-viewer" data-zoom={zoom} style={{ fontSize: `${zoom * 100}%` }}>
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
            remarkPlugins={REMARK_PLUGINS as never}
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
