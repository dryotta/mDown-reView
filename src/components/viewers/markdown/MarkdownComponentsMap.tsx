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
import { openExternalUrl } from "@/lib/tauri-commands";
import { warn } from "@/logger";
import { dirname } from "@/lib/path-utils";
import { assertNeverLinkRoute, routeLinkClick } from "@/lib/url-policy";
import { tooltipForRoute } from "@/lib/html-anchor-titles";
import { useStore } from "@/store";
import { lazyWithSuspense } from "../lazy";
import {
  CommentableLi,
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

// Anchor handler closes over filePath/workspaceRoot for relative-path
// resolution and external-scheme dispatch. See MarkdownViewer for the original
// rationale: openExternalUrl already enforces an allowlist, but we should not
// even call it for known-bad schemes.
//
// Also computes a `title` tooltip per link via the shared `tooltipForRoute`
// chokepoint so hover on a relative-path link shows the resolved workspace
// path rather than just `./other.md`. Mirrors the behaviour the HTML preview
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
    const route = href
      ? routeLinkClick(href, { baseDir: baseDir || undefined, workspaceRoot })
      : null;
    // Don't override an author-supplied title (markdown's `[label](url "title")`).
    const computedTitle =
      title ?? (route ? tooltipForRoute(route, workspaceRoot) ?? undefined : undefined);
    const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (!route) return;
      switch (route.kind) {
        case "fragment":
          // In-document scroll — let the browser handle it natively.
          return;
        case "absolute-blocked":
        case "scheme-blocked":
        case "other-blocked": {
          // Iter 1 of #338 keeps the prior "warn + drop" UX for every
          // blocked variant; Group C wires the tier-3 popover. Reason field
          // varies per kind so we log the discriminator + the per-kind
          // detail uniformly.
          e.preventDefault();
          const detail =
            route.kind === "scheme-blocked" ? route.scheme :
            route.kind === "absolute-blocked" ? route.flavor :
            route.reason;
          void warn(`MarkdownViewer: blocked link (${route.kind}/${detail}): ${route.href}`);
          return;
        }
        case "external":
          e.preventDefault();
          openExternalUrl(route.href).catch((err) =>
            warn(`[MarkdownViewer] link open failed: ${err}`),
          );
          return;
        case "workspace":
        case "workspace-outside":
          // `workspace-outside` is reserved for Group B's IPC classifier and
          // is not yet emitted by `routeLinkClick` in iter 1; treat it like
          // `workspace` for now to preserve the prior behavior under the
          // missed-UNC bug A4 just fixed.
          e.preventDefault();
          if (route.path === filePath) {
            // Same-file link — file is already active; openFile would be a
            // no-op. Scroll directly to the requested heading id (rehype-slug
            // emits `id="…"` on every heading; ids are document-unique).
            if (route.fragment) scrollToFragment(route.fragment);
          } else {
            // Cross-file link — stash the fragment for the destination viewer
            // to consume on first render, then open the file.
            if (route.fragment) {
              useStore.getState().setPendingFragment({
                path: route.path,
                fragment: route.fragment,
              });
            }
            useStore.getState().openFile(route.path);
          }
          return;
        default:
          assertNeverLinkRoute(route);
      }
    };
    return (
      <a href={href} title={computedTitle} onClick={handleClick} {...props}>
        {children}
      </a>
    );
  };
}

function scrollToFragment(fragment: string): void {
  let id = fragment;
  try {
    id = decodeURIComponent(fragment);
  } catch {
    /* keep raw on malformed input */
  }
  const el = document.getElementById(id);
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
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
  } as unknown as Components;
}
