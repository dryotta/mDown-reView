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
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
} from "react";
import type { ExtraProps } from "react-markdown";
import { FrontmatterBlock } from "./FrontmatterBlock";
import { TableOfContents, extractHeadings } from "./TableOfContents";
import { CommentMargin } from "@/components/comments/CommentMargin";
import { useStore } from "@/store";
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

// FNV-1a hash — 8 hex chars, same algorithm as the Rust side
function fnv1a8(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// Extract plain text from React nodes (for block hash computation)
function extractText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement(node))
    return extractText((node.props as { children?: ReactNode }).children);
  return "";
}

// Build map: line number → nearest preceding heading slug
function buildHeadingContextMap(content: string): Map<number, string | null> {
  const lines = content.split("\n");
  const map = new Map<number, string | null>();
  let current: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^#{1,6}\s+(.+)$/.exec(lines[i]);
    if (m) {
      current = m[1]
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    }
    map.set(i + 1, current);
  }
  return map;
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

// Static components that don't need filePath or heading context — kept at module scope
const MD_COMPONENTS_STATIC = {
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
};

// Build comment-aware block components, memoized by filePath + headingContextMap
function useMarkdownComponents(
  filePath: string,
  headingContextMap: Map<number, string | null>
) {
  return useMemo(() => {
    const makeAnchor = (children: ReactNode, startLine: number) => ({
      blockHash: fnv1a8(extractText(children).replace(/\s+/g, " ").trim()),
      headingContext: headingContextMap.get(startLine) ?? null,
      fallbackLine: startLine,
    });

    type BlockTag = "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

    // Shared inner content for any commentable block
    function BlockContent({
      anchor,
      openTrigger,
      setOpenTrigger,
      contextMenuPos,
      setContextMenuPos,
    }: {
      anchor: ReturnType<typeof makeAnchor>;
      openTrigger: number;
      setOpenTrigger: React.Dispatch<React.SetStateAction<number>>;
      contextMenuPos: { x: number; y: number } | null;
      setContextMenuPos: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
    }) {
      return (
        <>
          <CommentMargin filePath={filePath} anchor={anchor} openTrigger={openTrigger} />
          {contextMenuPos && (
            <>
              <div className="comment-ctx-backdrop" onClick={() => setContextMenuPos(null)} />
              <div className="comment-ctx-menu" style={{ top: contextMenuPos.y, left: contextMenuPos.x }}>
                <button
                  className="comment-ctx-item"
                  onClick={() => {
                    setContextMenuPos(null);
                    setOpenTrigger((t) => t + 1);
                  }}
                >
                  Add comment
                </button>
              </div>
            </>
          )}
        </>
      );
    }

    // p / h1–h6: wrap in a div (valid HTML for these tags)
    function makeBlock(Tag: BlockTag) {
      return function BlockWithComment({
        children,
        node,
        ...props
      }: ComponentPropsWithoutRef<BlockTag> & ExtraProps) {
        const line = node?.position?.start.line ?? 0;
        const anchor = makeAnchor(children, line);
        const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
        const [openTrigger, setOpenTrigger] = useState(0);

        return (
          <div
            className="comment-block-wrapper"
            data-block-hash={anchor.blockHash}
            onContextMenu={(e) => { e.preventDefault(); setContextMenuPos({ x: e.clientX, y: e.clientY }); }}
          >
            <Tag {...(props as ComponentPropsWithoutRef<typeof Tag>)}>{children}</Tag>
            <BlockContent
              anchor={anchor}
              openTrigger={openTrigger}
              setOpenTrigger={setOpenTrigger}
              contextMenuPos={contextMenuPos}
              setContextMenuPos={setContextMenuPos}
            />
          </div>
        );
      };
    }

    // li: the li itself becomes the wrapper (div around li would be invalid HTML)
    function ListItemWithComment({
      children,
      node,
      ...props
    }: ComponentPropsWithoutRef<"li"> & ExtraProps) {
      const line = node?.position?.start.line ?? 0;
      const anchor = makeAnchor(children, line);
      const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
      const [openTrigger, setOpenTrigger] = useState(0);

      return (
        <li
          className="comment-block-wrapper"
          data-block-hash={anchor.blockHash}
          onContextMenu={(e) => { e.preventDefault(); setContextMenuPos({ x: e.clientX, y: e.clientY }); }}
          {...(props as ComponentPropsWithoutRef<"li">)}
        >
          {children}
          <BlockContent
            anchor={anchor}
            openTrigger={openTrigger}
            setOpenTrigger={setOpenTrigger}
            contextMenuPos={contextMenuPos}
            setContextMenuPos={setContextMenuPos}
          />
        </li>
      );
    }

    const fileDir = dirname(filePath);

    return {
      ...MD_COMPONENTS_STATIC,
      img: ({ src, alt, node: _node, ...props }: ComponentPropsWithoutRef<"img"> & ExtraProps) => {
        let resolvedSrc = src;
        if (src && !src.startsWith("http://") && !src.startsWith("https://") && !src.startsWith("data:")) {
          // Resolve relative paths against the markdown file's directory
          const absolute = src.startsWith("/") || src.startsWith("\\") || /^[a-zA-Z]:/.test(src)
            ? src
            : `${fileDir}/${src}`;
          resolvedSrc = convertFileSrc(absolute);
        }
        return <img src={resolvedSrc} alt={alt ?? ""} {...props} />;
      },
      p: makeBlock("p"),
      h1: makeBlock("h1"),
      h2: makeBlock("h2"),
      h3: makeBlock("h3"),
      h4: makeBlock("h4"),
      h5: makeBlock("h5"),
      h6: makeBlock("h6"),
      li: ListItemWithComment,
    };
  }, [filePath, headingContextMap]);
}

export function MarkdownViewer({ content, filePath, fileSize }: Props) {
  const { body, data } = useMemo(() => parseFrontmatter(content), [content]);
  const headings = useMemo(() => extractHeadings(body), [body]);
  const headingContextMap = useMemo(() => buildHeadingContextMap(body), [body]);
  const components = useMarkdownComponents(filePath, headingContextMap);

  const setFileComments = useStore((s) => s.setFileComments);
  const comments = useStore((s) => s.commentsByFile[filePath]);
  const loadedRef = useRef<string | null>(null);

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

  // Auto-save comments to sidecar (debounced, only after initial load)
  useEffect(() => {
    if (loadedRef.current !== filePath) return;
    const timer = setTimeout(() => {
      saveReviewComments(filePath, comments ?? []).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [comments, filePath]);

  // Single selectionchange listener → add/remove .has-selection CSS class on DOM nodes
  useEffect(() => {
    function onSelectionChange() {
      document
        .querySelectorAll<HTMLElement>(".comment-block-wrapper.has-selection")
        .forEach((el) => el.classList.remove("has-selection"));
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      let node: Node | null = sel.anchorNode;
      while (node && node !== document.body) {
        if (node instanceof HTMLElement && node.classList.contains("comment-block-wrapper")) {
          node.classList.add("has-selection");
          break;
        }
        node = node.parentNode;
      }
    }
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  // Ctrl+Shift+M: open comment input for the block under the cursor / selection.
  // Works with a collapsed caret (single click to position cursor) or a text selection.
  // Uses e.code so it's keyboard-layout independent.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "KeyM") {
        e.preventDefault();
        const sel = window.getSelection();
        // anchorNode is set for both a cursor position (collapsed) and a text selection
        const anchor = sel?.anchorNode ?? null;
        if (!anchor) return;
        let node: Node | null = anchor;
        while (node && node !== document.body) {
          if (node instanceof HTMLElement && node.classList.contains("comment-block-wrapper")) {
            node.querySelector<HTMLButtonElement>(".comment-plus-btn")?.click();
            break;
          }
          node = node.parentNode;
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const showSizeWarning = fileSize !== undefined && fileSize > SIZE_WARN_THRESHOLD;

  return (
    <div className="markdown-viewer">
      {showSizeWarning && (
        <div className="size-warning" role="alert">
          This file is large ({Math.round((fileSize ?? 0) / 1024)} KB) — rendering may be slow
        </div>
      )}
      {data && <FrontmatterBlock data={data} />}
      <TableOfContents headings={headings} />
      <div className="markdown-body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSlug]}
          components={components as never}
        >
          {body}
        </ReactMarkdown>
      </div>
    </div>
  );
}
