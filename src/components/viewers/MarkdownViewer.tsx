import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkGithubAlerts } from "@/lib/remark-github-alerts";
import remarkMath from "remark-math";
import rehypeSlug from "rehype-slug";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import { sanitizeSchema } from "./markdown/sanitizeSchema";
import { rehypeFootnotePrefix } from "./markdown/rehype-footnote-prefix";
import { rehypeKatexStyle } from "./markdown/rehype-katex-style";
import {
  hasRemoteImageReferences,
  useImgResolver,
} from "./markdown/useImgResolver";
import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { FrontmatterBlock } from "./FrontmatterBlock";
import { TableOfContents, extractHeadings } from "./TableOfContents";
import { MdCommentContext } from "./markdown/CommentableBlocks";
import { buildMarkdownComponents } from "./markdown/MarkdownComponentsMap";
import { MarkdownInteractionLayer } from "./markdown/MarkdownInteractionLayer";
import { useComments } from "@/lib/vm/use-comments";
import { useCommentActions } from "@/lib/vm/use-comment-actions";
import { ReadingWidthHandle } from "./ReadingWidthHandle";
import { useStore } from "@/store";
import { useZoom } from "@/hooks/useZoom";
import { parseFrontmatter } from "@/lib/frontmatter";
import { SIZE_WARN_THRESHOLD } from "@/lib/comment-utils";
import { useThreadsByLine } from "@/hooks/useThreadsByLine";
import { useScrollToLine } from "@/hooks/useScrollToLine";
import { useSelectionToolbar } from "@/hooks/useSelectionToolbar";
import { useViewerContextMenu } from "@/hooks/useViewerContextMenu";
import { useFindInPage } from "@/hooks/useFindInPage";
import { FindInPageBar } from "@/components/FindInPageBar";
import "@/styles/markdown.css";
import "@/styles/find-in-page.css";

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
  const components = useMemo(
    () => buildMarkdownComponents({ filePath, workspaceRoot, img }),
    [filePath, img, workspaceRoot],
  );

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
  useScrollToLine(bodyRef, "data-source-line", undefined, handleScrollTo, filePath);

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

  const handleSelectionAdd = useCallback(() => {
    handleAddSelectionComment((line) => {
      setCommentingLine(line);
      setExpandedLine(null);
    });
  }, [handleAddSelectionComment]);

  // F6 — right-click context menu. Markdown nodes carry `data-source-line`
  // (1-indexed). Selection-toolbar priming so "Comment on selection" routes
  // through the same code path as the mouseup-driven flow.
  // #65 G1 — Ctrl+F find-in-page. Body content drives the change signature
  // so highlights re-walk after edits/reloads. The bar's `.find-bar` class
  // is referenced by the print stylesheet to hide it on print.
  const find = useFindInPage(bodyRef, body);
  const openFindBar = find.openBar;

  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key !== "f" && e.key !== "F") return;
      if (!(e.ctrlKey || e.metaKey)) return;
      // Don't hijack when the user is typing in a textarea/input that
      // is NOT the find-bar's own input (e.g. an open comment editor).
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        const inFindBar = !!target.closest(".find-bar");
        if (!inFindBar && (tag === "TEXTAREA" || tag === "INPUT")) return;
      }
      e.preventDefault();
      openFindBar();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openFindBar]);

  const { ctxMenu, handleContextMenu, handleContextAction, closeContextMenu } = useViewerContextMenu({
    filePath,
    resolveLine: (target) => {
      const lineEl = target.closest<HTMLElement>("[data-source-line]");
      if (!lineEl) return null;
      const n = Number(lineEl.getAttribute("data-source-line"));
      return Number.isFinite(n) && n > 0 ? n : null;
    },
    primeSelection: handleMouseUp,
    startSelectionComment: handleSelectionAdd,
  });

  return (
    <div className="markdown-viewer" data-zoom={zoom} style={{ fontSize: `${zoom * 100}%` }}>
      <FindInPageBar
        open={find.open}
        query={find.query}
        matches={find.matches}
        current={find.current}
        onChange={find.setQuery}
        onNext={find.next}
        onPrev={find.prev}
        onClose={find.close}
      />
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
            className="markdown-body md-wrap-cascade"
            ref={bodyRef}
            onClick={handleGutterClick}
            onMouseUp={handleMouseUp}
            onContextMenu={handleContextMenu}
            style={{ position: "relative" }}
          >
            <ReactMarkdown
              remarkPlugins={REMARK_PLUGINS as never}
              rehypePlugins={rehypePlugins as never}
              components={components}
            >
              {body}
            </ReactMarkdown>
            <MarkdownInteractionLayer
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
              selectionToolbar={selectionToolbar}
              dismissSelectionToolbar={() => setSelectionToolbar(null)}
              onAddSelectionComment={handleSelectionAdd}
              contextMenu={{
                open: ctxMenu.state.open,
                x: ctxMenu.state.x,
                y: ctxMenu.state.y,
                hasSelection: ctxMenu.state.payload?.hasSelection ?? false,
                hasLine: ctxMenu.state.payload?.line != null,
              }}
              onContextMenuAction={handleContextAction}
              onContextMenuClose={closeContextMenu}
            />
          </div>
        </MdCommentContext.Provider>
        <ReadingWidthHandle containerRef={readingContainerRef} side="left" />
        <ReadingWidthHandle containerRef={readingContainerRef} side="right" />
      </div>
    </div>
  );
}
