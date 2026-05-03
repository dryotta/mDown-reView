import React, {
  isValidElement,
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";
import type { Components, ExtraProps } from "react-markdown";
import { getSharedHighlighter } from "@/lib/shiki";
import { dirname } from "@/lib/path-utils";
import { routeLinkClick } from "@/lib/url-policy";
import { tooltipForRoute } from "@/lib/html-anchor-titles";
import { useLinkRouter } from "@/hooks/useLinkRouter";
import { lazyWithSuspense } from "../lazy";
import {
  CommentableDetails,
  CommentableLi,
  CommentableSummary,
  CommentableTableCell,
  CommentableWrapper,
  makeCommentableBlock,
} from "./CommentableBlocks";
import { CodeBlockHost } from "./CodeBlockHost";

type ImgComponent = ComponentType<ComponentPropsWithoutRef<"img"> & ExtraProps>;

// Shiki-backed code block. Emits dual-theme output (light + dark) where the
// colors are encoded as CSS variables (`--shiki-light` / `--shiki-dark`).
// `markdown.css` selects which set is active via the document `data-theme`,
// and `print.css` (#65 G3) forces the light variant inside `@media print` so
// printed code blocks render in black-on-white regardless of the on-screen
// theme. Degrades to a plain `<pre><code>` while the highlighter loads.
function HighlightedCode({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSharedHighlighter()
      .then(async (h) => {
        if (cancelled) return;
        // Load the language on demand — the shared highlighter starts with
        // langs:[] so every grammar is loaded lazily. Without this,
        // codeToHtml throws "Language not found" and the catch below
        // swallows it, leaving the block un-highlighted (#181).
        const loaded = h.getLoadedLanguages();
        if (!loaded.includes(lang)) {
          await h.loadLanguage(lang as import("shiki").BundledLanguage).catch(() => {});
          if (!h.getLoadedLanguages().includes(lang)) {
            // Language not available — render plain
            return;
          }
        }
        if (cancelled) return;
        const result = h.codeToHtml(code, {
          lang,
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: false,
        });
        setHtml(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  if (html) {
    return <div dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return (
    <pre>
      <code className={`language-${lang}`}>{code}</code>
    </pre>
  );
}

// Embedded ```mermaid fenced blocks render inline via MermaidEmbedded
// (issue #276 — adds a hover-revealed pop-out button on top of the existing
// SVG render). MermaidEmbedded shares the lazy `mermaid` chunk with the
// dedicated `.mmd` viewer route since both paths route through
// `MermaidRenderer` → `renderMermaid` (singleton).
const MermaidEmbed = lazyWithSuspense<{ content: string }>(() =>
  import("../mermaid/MermaidEmbedded").then((m) => ({ default: m.MermaidEmbedded }))
);

// Anchor handler delegates click dispatch to `useLinkRouter` (issue #338 /
// AC6) — the consumer-facing reduction. The component still computes a
// synchronous `title` tooltip via the shared `tooltipForRoute` chokepoint
// so hover on a relative-path link shows the resolved workspace path
// rather than just `./other.md`. Mirrors the behaviour the HTML preview
// gets via `injectAnchorTitles` in its asset-resolve pipeline.
function makeAnchorComponent(filePath: string, workspaceRoot: string) {
  const baseDir = filePath ? dirname(filePath) : "";
  return function MarkdownAnchor({
    href,
    children,
    node: _node,
    title,
    ...props
  }: ComponentPropsWithoutRef<"a"> & ExtraProps) {
    const dispatch = useLinkRouter();
    // Tooltip is still synchronous — no IPC needed. We re-use the same
    // `routeLinkClick` shape classifier the dispatcher uses internally so
    // the tooltip mirrors the route the click will actually take.
    const route = href
      ? routeLinkClick(href, { baseDir: baseDir || undefined, workspaceRoot })
      : null;
    // Don't override an author-supplied title (markdown's `[label](url "title")`).
    const computedTitle =
      title ?? (route ? tooltipForRoute(route, workspaceRoot) ?? undefined : undefined);
    const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (!href) return;
      e.preventDefault();
      void dispatch(href, { filePath: filePath || null });
    };
    return (
      <a href={href} title={computedTitle} onClick={handleClick} {...props}>
        {children}
      </a>
    );
  };
}

// Build the components map for ReactMarkdown. The `pre`, `img`, and anchor
// callbacks close over per-render state (filePath / workspaceRoot / resolver),
// so this factory is invoked from MarkdownViewer's useMemo with stable inputs.
export interface BuildMarkdownComponentsOpts {
  filePath: string;
  workspaceRoot: string;
  img: ImgComponent;
}

export function buildMarkdownComponents({
  filePath,
  workspaceRoot,
  img,
}: BuildMarkdownComponentsOpts): Components {
  const a = makeAnchorComponent(filePath, workspaceRoot);

  const pre = ({ children, node, ...props }: ComponentPropsWithoutRef<"pre"> & ExtraProps) => {
    let inner: ReactNode;
    // #65 G2: every fenced code block (except mermaid) gets a hover-revealed
    // copy button. We capture the raw source string here so the button
    // writes the original text — not the shiki-highlighted HTML — to the
    // clipboard. Mermaid blocks render as diagrams and are intentionally
    // excluded.
    let copySource: string | null = null;
    if (isValidElement(children)) {
      const el = children as ReactElement<{ className?: string; children?: ReactNode }>;
      if (el.type === "code") {
        const { className, children: codeChildren } = el.props;
        const lang = /language-([\w-]+)/.exec(className ?? "")?.[1];
        const sourceText = String(codeChildren ?? "").replace(/\n$/, "");
        if (lang?.toLowerCase() === "mermaid") {
          inner = <MermaidEmbed content={sourceText} />;
          // mermaid → no copy button
        } else if (lang) {
          inner = <HighlightedCode code={sourceText} lang={lang} />;
          copySource = sourceText;
        } else {
          // plain ``` block (no language tag) — still copyable; let the
          // default <pre> below render the content.
          copySource = sourceText;
        }
      }
    }
    if (inner === undefined) {
      inner = <pre {...props}>{children}</pre>;
    }
    const wrapped =
      copySource !== null ? <CodeBlockHost source={copySource}>{inner}</CodeBlockHost> : inner;
    return <CommentableWrapper node={node}>{wrapped}</CommentableWrapper>;
  };

  // Wrap the per-doc `img` resolver in the commentable envelope so the gutter
  // and selection layer see images alongside text blocks. The resolver itself
  // is responsible for asset:// / blob: / placeholder dispatch. Use a `span`
  // wrapper because images frequently render inside `<p>`, where a `<div>`
  // child would be invalid HTML and trigger hydration warnings.
  const wrappedImg = ({ node, ...props }: ComponentPropsWithoutRef<"img"> & ExtraProps) => (
    <CommentableWrapper node={node} as="span">
      {React.createElement(img, props)}
    </CommentableWrapper>
  );

  return {
    a,
    pre,
    img: wrappedImg,
    p: makeCommentableBlock("p"),
    h1: makeCommentableBlock("h1"),
    h2: makeCommentableBlock("h2"),
    h3: makeCommentableBlock("h3"),
    h4: makeCommentableBlock("h4"),
    h5: makeCommentableBlock("h5"),
    h6: makeCommentableBlock("h6"),
    li: CommentableLi,
    table: makeCommentableBlock("table"),
    blockquote: makeCommentableBlock("blockquote"),
    hr: makeCommentableBlock("hr"),
    td: CommentableTableCell("td"),
    th: CommentableTableCell("th"),
    // <details>/<summary> need inline-attribute wrappers (not div
    // wrappers) — the HTML5 disclosure parser requires `<summary>` to
    // be a direct child of `<details>`, so the makeCommentableBlock
    // div wrapper would break the toggle behaviour.
    details: CommentableDetails,
    summary: CommentableSummary,
  } as unknown as Components;
}
