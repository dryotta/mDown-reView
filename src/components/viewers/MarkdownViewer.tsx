import React, { type ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { type ExtraProps } from "react-markdown";
import remarkFrontmatter from "remark-frontmatter";
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
import { hasRemoteImageReferences, useImgResolver } from "./markdown/useImgResolver";
import { useEffect, useRef, useMemo, useCallback, useDeferredValue } from "react";
import { FrontmatterBlock } from "./FrontmatterBlock";
import { TableOfContents, extractHeadings } from "./TableOfContents";
import { MdCommentContext } from "./markdown/CommentableBlocks";
import { buildMarkdownComponents } from "./markdown/MarkdownComponentsMap";
import { ViewerBanner, selectBannerVariant } from "./ViewerBanner";
import { SelectionToolbar } from "@/components/comments/SelectionToolbar";
import { useComments } from "@/lib/vm/use-comments";
import { ReadingWidthHandle } from "./ReadingWidthHandle";
import { useStore } from "@/store";
import { useZoom } from "@/hooks/useZoom";
import { parseFrontmatter } from "@/lib/frontmatter";
import { truncateSelectedText } from "@/lib/comment-utils";
import { SIZE_WARN_THRESHOLD } from "@/lib/viewer-budgets";
import { useThreadsByLine } from "@/hooks/useThreadsByLine";
import { useScrollToLine } from "@/hooks/useScrollToLine";
import { useSelectionToolbar } from "@/hooks/useSelectionToolbar";
import { useFindInPage } from "@/hooks/useFindInPage";
import { FindInPageBar } from "@/components/FindInPageBar";
import { isSidecarFile } from "@/lib/file-types";
import { emitCommentFlash } from "@/lib/comment-flash";
import { useCommentFlashListener } from "@/hooks/useCommentFlashListener";
import "@/styles/markdown.css";
import "@/styles/find-in-page.css";
import "@/styles/viewer-banner.css";

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
//
// Order is load-bearing: `remarkFrontmatter` MUST run FIRST so the YAML
// `---` fence is parsed as a frontmatter node before `remarkGfm`'s table
// parser sees it (otherwise GFM treats `---` as a table-row separator).
// Frontmatter is recognised but not rendered (no `yaml` component
// renderer is registered), which preserves the visual output while
// keeping mdast `position.start.line` aligned with FILE coordinates —
// the invariant Rule 31 (`docs/architecture.md`) and AC1 of issue #280
// depend on for `data-source-line` to match the comment line numbers
// produced by the Rust matcher.
const REMARK_PLUGINS = [remarkFrontmatter, remarkGfm, remarkMath, remarkGithubAlerts] as const;

export function MarkdownViewer({ content, filePath, fileSize }: Props) {
  // Iter 3 of #252 — defer the heavy markdown parse so React can keep
  // frames moving while interactive surfaces (find-bar, scroll, click)
  // respond instantly. `useDeferredValue` returns the previous value during
  // an interruption and the new value once React has time. Only the
  // ReactMarkdown render reads the deferred copy; the cheap regex
  // pre-scans (frontmatter, math detection, remote-image references) and
  // the line-text used by click handlers stay on the raw `content` so
  // banners and gutter clicks react immediately. `data-source-line` line
  // numbers stay file-coord because the deferred value is an identity-
  // preserved snapshot of `content`, not a transformed one (Rule 31,
  // `docs/architecture.md`).
  const deferredContent = useDeferredValue(content);

  // Iter 2 of issue #280 made the visual-viewer pipeline file-coordinate
  // end-to-end. We retain `parseFrontmatter` only to extract `data` for
  // `<FrontmatterBlock>`; the matching `body` field (frontmatter-stripped
  // content) is no longer consumed — every downstream consumer
  // (extractHeadings, lines split, ReactMarkdown, useFindInPage, the
  // remote-image scan) now receives the raw `content` so `data-source-line`
  // stamps and source-authored comment line numbers share the same
  // file-coord origin. See issue #280 / Rule 31.
  const data = useMemo(() => parseFrontmatter(content), [content]);
  const headings = useMemo(() => extractHeadings(content), [content]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const readingContainerRef = useRef<HTMLDivElement>(null);
  const readingWidth = useStore((s) => s.readingWidth);
  // Per-filetype zoom (#65 D1/D2/D3). Same `.md` key shared by source-mode
  // and visual-mode viewers so the EnhancedViewer toolbar drives both.
  const { zoom } = useZoom(".md");
  // Sidecar files (.review.yaml/.review.json) are app-managed metadata,
  // not commentable content. Suppress the gutter "+" affordance, the
  // selection toolbar, and the right-click context menu so users can't
  // attach comments to a comment-storage file.
  const commentable = !isSidecarFile(filePath);

  const lines = useMemo(() => content.split("\n"), [content]);

  const { threads } = useComments(filePath);

  const { threadsByLine, commentCountByLine } = useThreadsByLine(threads);

  const { selectionToolbar, handleMouseUp, handleAddSelectionComment, dismissToolbar } =
    useSelectionToolbar("data-source-line", 0);

  // Stable img resolver — only changes when filePath/allowance changes.
  const { img: rawImg } = useImgResolver(filePath);
  const workspaceRoot = useStore((s) => s.root) ?? "";

  // Issue #359 / iter-2 — outside-workspace asset-cache busting.
  // When the user clicks "Allow for this session" on the tier-2 banner,
  // `extendScopeForTab` grants asset-protocol scope and bumps
  // `allowedScopeGen`. The previously-mounted `<img>` nodes still hold
  // their old `asset://…` URLs which the browser has cached as failed
  // responses; without a fresh URL they stay broken even though scope
  // is now valid. We append `?scopeGen=N` to `asset:` URLs only when
  // this tab is in the outside-workspace allow set, leaving folder-
  // internal (already-working) images unbusted.
  const allowOutsideForThisTab = useStore((s) => s.allowOutsideWorkspace.has(filePath));
  const allowedScopeGen = useStore((s) => s.allowedScopeGen);
  // `rawImg` is constructed via `useCallback` inside `useImgResolver` —
  // it is always a function component. The `ImgComponent` union type
  // includes class components (which are not callable), so we narrow to
  // the function form here for the post-render src-rewrite below.
  type ImgFn = (
    props: ComponentPropsWithoutRef<"img"> & ExtraProps
  ) => React.ReactElement | null;
  const img = useMemo(() => {
    if (!allowOutsideForThisTab || allowedScopeGen === 0) return rawImg;
    const inner = rawImg as unknown as ImgFn;
    const Wrapped: ImgFn = (props) => {
      const el = inner(props);
      if (!React.isValidElement(el) || el.type !== "img") return el;
      const elProps = el.props as { src?: string };
      const src = elProps.src;
      if (!src || !src.startsWith("asset:")) return el;
      const sep = src.includes("?") ? "&" : "?";
      return React.cloneElement(el as React.ReactElement<{ src?: string }>, {
        src: `${src}${sep}scopeGen=${allowedScopeGen}`,
      });
    };
    return Wrapped as unknown as typeof rawImg;
  }, [rawImg, allowOutsideForThisTab, allowedScopeGen]);

  const components = useMemo(
    () => buildMarkdownComponents({ filePath, workspaceRoot, img }),
    [filePath, img, workspaceRoot]
  );

  // A1 banner: show when the doc has remote-image refs — both to allow and
  // to revoke. The banner stays visible in either state so the user can
  // toggle the permission.
  const remoteImagesAllowed = useStore((s) => s.allowedRemoteImageDocs[filePath] === true);
  const hasRemoteImages = useMemo(() => hasRemoteImageReferences(content), [content]);
  const handleAllowRemoteImages = useCallback(() => {
    useStore.getState().allowRemoteImagesForDoc(filePath);
  }, [filePath]);
  const handleDisallowRemoteImages = useCallback(() => {
    useStore.getState().disallowRemoteImagesForDoc(filePath);
  }, [filePath]);

  // Issue #338 / AC10 — single ViewerBanner mount (tier-3 / tier-2 /
  // external-image precedence). Iter 2 lands the contract with zero
  // counts; tier-3/tier-2 reference scanning is deliberate follow-up
  // scope (see issue #338 follow-up). The banner returns null when all
  // counts are zero, so this lands the SHAPE without altering UX.
  // (`allowOutsideForThisTab` is selected above for the asset-cache-busting
  // wrap on `img`; reused here to avoid a duplicate selector subscription.)
  const bannerVariant = useMemo(
    () =>
      selectBannerVariant({
        tier3Count: 0,
        tier2Count: 0,
        externalImageCount: 0,
        allowOutsideForThisTab,
        allowExternalImagesForThisTab: remoteImagesAllowed,
        tabPath: filePath || null,
      }),
    [allowOutsideForThisTab, remoteImagesAllowed, filePath]
  );

  // B3: detect math syntax in the body. Cheap regex pre-scan so we only
  // pay the KaTeX cost on documents that actually use math.
  const hasMath = useMemo(() => HAS_MATH_RE.test(content), [content]);
  // L4: lazy-load `rehype-katex` so its ~200 KB JS lands in a separate chunk
  // and only when a doc actually uses math. Plugin is `null` until loaded.
  const [rehypeKatexPlugin, setRehypeKatexPlugin] = React.useState<unknown | null>(null);
  useEffect(() => {
    if (!hasMath) return;
    void ensureKatexCssLoaded();
    if (rehypeKatexPlugin) return;
    let cancelled = false;
    void import("rehype-katex").then((m) => {
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
  const rehypePlugins = useMemo(() => {
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
  }, [rehypeKatexPlugin]);

  // Scroll-to-line from CommentsPanel click — handled by useScrollToLine
  // below. The panel separately emits a `comment-flash` event for the
  // visual highlight; the listener below picks that up.
  useScrollToLine(bodyRef, "data-source-line", undefined, undefined, filePath);

  // Cross-surface flash listener: extracted into `useCommentFlashListener`
  // so MarkdownViewer + SourceView share one switch and this file stays
  // under architecture rule 23's 400-line cap.
  useCommentFlashListener(filePath, bodyRef);

  // Consume cross-file fragment requests left by anchor clicks. The link
  // handler stashes `{path, fragment}` in the store, then `openFile` swaps
  // the active tab. ViewerRouter remounts this viewer (keyed on `path`) and
  // we land here with the new content already in `body`. rehype-slug emits
  // ids synchronously during ReactMarkdown's first commit, so the heading
  // exists in the DOM by the time this useEffect fires. Only the same-tab,
  // already-mounted case is handled in the click handler directly.
  useEffect(() => {
    if (!content) return;
    const fragment = useStore.getState().consumePendingFragment(filePath);
    if (!fragment) return;
    let id = fragment;
    try {
      id = decodeURIComponent(fragment);
    } catch {
      /* keep raw */
    }
    const handle = requestAnimationFrame(() => {
      const el = document.getElementById(id);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(handle);
  }, [filePath, content]);

  const showSizeWarning = fileSize !== undefined && fileSize > SIZE_WARN_THRESHOLD;

  const contextValue = useMemo(
    () => ({
      commentCountByLine,
    }),
    [commentCountByLine]
  );

  const handleGutterClick = useCallback(
    (e: React.MouseEvent) => {
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
      const lineThreads = threadsByLine.get(line) ?? [];
      if (lineThreads.length > 0) {
        // Block has comments → flash both surfaces, scroll panel to row(s).
        // Iter 3 of #280 — gutter clicks operate on a *line* (no commentId
        // / no end_line context here), so the kind is always "line".
        emitCommentFlash({ kind: "line", filePath, line });
      } else {
        // Empty block → seed a panel composer with the block's source line
        // text as the selected_text (MRSF §6.2 line-only convention).
        const lineText = lines[line - 1] ?? "";
        const selected = truncateSelectedText(lineText);
        useStore.getState().requestLineCompose({
          filePath,
          anchor: { line, selected_text: selected },
        });
      }
    },
    [filePath, lines, threadsByLine]
  );

  const handleSelectionAdd = useCallback(() => {
    void handleAddSelectionComment(filePath);
  }, [handleAddSelectionComment, filePath]);

  // F6 — right-click context menu. Markdown nodes carry `data-source-line`
  // (1-indexed). Selection-toolbar priming so "Comment on selection" routes
  // through the same code path as the mouseup-driven flow.
  // #65 G1 — Ctrl+F find-in-page. Body content drives the change signature
  // so highlights re-walk after edits/reloads. The bar's `.find-bar` class
  // is referenced by the print stylesheet to hide it on print.
  const find = useFindInPage(bodyRef, content);
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

  return (
    <div className="markdown-viewer" data-zoom={zoom} style={{ fontSize: `${zoom * 100}%` }}>
      <ViewerBanner variant={bannerVariant} />
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
        {hasRemoteImages && (
          <div className="viewer-info-banner" role="status">
            {remoteImagesAllowed
              ? "Remote images allowed for this document. "
              : "This document contains remote images. "}
            <button
              type="button"
              className="comment-btn"
              onClick={remoteImagesAllowed ? handleDisallowRemoteImages : handleAllowRemoteImages}
              aria-label={
                remoteImagesAllowed
                  ? "Disallow remote images"
                  : "Allow remote images for this document"
              }
            >
              {remoteImagesAllowed ? "Disallow remote images" : "Allow remote images"}
            </button>
          </div>
        )}
        {data && <FrontmatterBlock data={data} />}
        <TableOfContents headings={headings} />
        <MdCommentContext.Provider value={contextValue}>
          <div
            className="markdown-body md-wrap-cascade"
            ref={bodyRef}
            onClick={commentable ? handleGutterClick : undefined}
            onMouseUp={commentable ? handleMouseUp : undefined}
            style={{ position: "relative" }}
          >
            <ReactMarkdown
              remarkPlugins={REMARK_PLUGINS as never}
              rehypePlugins={rehypePlugins as never}
              components={components}
            >
              {deferredContent}
            </ReactMarkdown>
            {commentable && selectionToolbar && (
              <SelectionToolbar
                position={selectionToolbar.position}
                onAddComment={handleSelectionAdd}
                onDismiss={dismissToolbar}
              />
            )}
          </div>
        </MdCommentContext.Provider>
        <ReadingWidthHandle containerRef={readingContainerRef} side="left" />
        <ReadingWidthHandle containerRef={readingContainerRef} side="right" />
      </div>
    </div>
  );
}
