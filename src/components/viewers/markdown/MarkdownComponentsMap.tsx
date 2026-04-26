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
import { warn, info } from "@/logger";
import { resolveWorkspacePath, dirname } from "@/lib/path-utils";
import { EXTERNAL_LINK_SCHEME, BLOCKED_LINK_SCHEME } from "@/lib/url-policy";
import { useStore } from "@/store";
import { useTheme } from "@/hooks/useTheme";
import { lazyWithSuspense } from "../lazy";
import {
  CommentableLi,
  CommentableTableCell,
  CommentableWrapper,
  makeCommentableBlock,
} from "./CommentableBlocks";

type ImgComponent = ComponentType<ComponentPropsWithoutRef<"img"> & ExtraProps>;

// Shiki-backed code block. Re-highlights on theme change and degrades to a
// plain `<pre><code>` while the highlighter loads.
function HighlightedCode({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string | null>(null);
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

// Embedded ```mermaid fenced blocks render inline via the existing MermaidView
// (lazy chunk shared with the .mmd file viewer route).
const MermaidEmbed = lazyWithSuspense<{ content: string }>(() =>
  import("../MermaidView").then((m) => ({ default: m.MermaidView })),
);

// Anchor handler closes over filePath/workspaceRoot for relative-path
// resolution and external-scheme dispatch. See MarkdownViewer for the original
// rationale: openExternalUrl already enforces an allowlist, but we should not
// even call it for known-bad schemes.
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
      // the resolved target is contained within the workspace root.
      e.preventDefault();
      if (!baseDir) return;
      const resolved = resolveWorkspacePath(workspaceRoot, baseDir, href);
      if (!resolved) {
        warn(`MarkdownViewer: dropped link outside workspace: ${href}`);
        return;
      }
      useStore.getState().openFile(resolved.path);
      if (resolved.fragment) {
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

  const pre = ({
    children,
    node,
    ...props
  }: ComponentPropsWithoutRef<"pre"> & ExtraProps) => {
    let inner: ReactNode;
    if (isValidElement(children)) {
      const el = children as ReactElement<{ className?: string; children?: ReactNode }>;
      if (el.type === "code") {
        const { className, children: codeChildren } = el.props;
        const lang = /language-([\w-]+)/.exec(className ?? "")?.[1];
        if (lang?.toLowerCase() === "mermaid") {
          const source = String(codeChildren ?? "").replace(/\n$/, "");
          inner = <MermaidEmbed content={source} />;
        } else if (lang) {
          inner = (
            <HighlightedCode
              code={String(codeChildren ?? "").replace(/\n$/, "")}
              lang={lang}
            />
          );
        }
      }
    }
    if (inner === undefined) {
      inner = <pre {...props}>{children}</pre>;
    }
    return <CommentableWrapper node={node}>{inner}</CommentableWrapper>;
  };

  // Wrap the per-doc `img` resolver in the commentable envelope so the gutter
  // and selection layer see images alongside text blocks. The resolver itself
  // is responsible for asset:// / blob: / placeholder dispatch. Use a `span`
  // wrapper because images frequently render inside `<p>`, where a `<div>`
  // child would be invalid HTML and trigger hydration warnings.
  const wrappedImg = ({
    node,
    ...props
  }: ComponentPropsWithoutRef<"img"> & ExtraProps) => (
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
