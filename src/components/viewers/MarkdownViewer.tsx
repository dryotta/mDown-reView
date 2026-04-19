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
import { LineCommentMargin } from "@/components/comments/LineCommentMargin";
import { matchComments } from "@/lib/comment-matching";
import { useStore } from "@/store";
import type { CommentWithOrphan } from "@/store";
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

// Simple line-tracking components: add data-source-line to rendered elements
function makeSourceLineBlock(Tag: string) {
  return function SourceLineBlock({ children, node, ...props }: ComponentPropsWithoutRef<any> & ExtraProps) {
    const line = node?.position?.start.line ?? 0;
    return <Tag {...props} data-source-line={line}>{children}</Tag>;
  };
}

function SourceLineLi({ children, node, ...props }: ComponentPropsWithoutRef<"li"> & ExtraProps) {
  const line = node?.position?.start.line ?? 0;
  return <li {...props} data-source-line={line}>{children}</li>;
}

// Module-scope components — no dependency on filePath or per-render state
const MD_COMPONENTS: Record<string, unknown> = {
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
  p: makeSourceLineBlock("p"),
  h1: makeSourceLineBlock("h1"),
  h2: makeSourceLineBlock("h2"),
  h3: makeSourceLineBlock("h3"),
  h4: makeSourceLineBlock("h4"),
  h5: makeSourceLineBlock("h5"),
  h6: makeSourceLineBlock("h6"),
  li: SourceLineLi,
};

export function MarkdownViewer({ content, filePath, fileSize }: Props) {
  const { body, data } = useMemo(() => parseFrontmatter(content), [content]);
  const headings = useMemo(() => extractHeadings(body), [body]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [commentingLine, setCommentingLine] = useState<number | null>(null);
  const [blockPositions, setBlockPositions] = useState<{ line: number; top: number }[]>([]);

  const lines = useMemo(() => body.split("\n"), [body]);

  const setFileComments = useStore((s) => s.setFileComments);
  const comments = useStore((s) => s.commentsByFile[filePath]);
  const loadedRef = useRef<string | null>(null);

  const matchedComments = useMemo(() => {
    if (!comments || comments.length === 0) return [];
    return matchComments(comments, lines);
  }, [comments, lines]);

  const commentsByLine = useMemo(() => {
    const map = new Map<number, CommentWithOrphan[]>();
    for (const c of matchedComments) {
      const ln = c.matchedLineNumber ?? c.lineNumber ?? 1;
      const arr = map.get(ln) ?? [];
      arr.push(c);
      map.set(ln, arr);
    }
    return map;
  }, [matchedComments]);

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

  // Scroll-to-line from CommentsPanel click
  useEffect(() => {
    const handler = (e: Event) => {
      const line = (e as CustomEvent).detail.line;
      const el = bodyRef.current?.querySelector(`[data-source-line="${line}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("comment-flash");
        setTimeout(() => el.classList.remove("comment-flash"), 1500);
      }
    };
    window.addEventListener("scroll-to-line", handler);
    return () => window.removeEventListener("scroll-to-line", handler);
  }, []);

  // Measure block positions after render
  useEffect(() => {
    function measure() {
      if (!bodyRef.current) return;
      const container = bodyRef.current;
      const containerRect = container.getBoundingClientRect();
      const elements = container.querySelectorAll<HTMLElement>("[data-source-line]");
      const result: { line: number; top: number }[] = [];
      const seen = new Set<number>();
      elements.forEach((el) => {
        const line = Number(el.getAttribute("data-source-line"));
        if (line > 0 && !seen.has(line)) {
          seen.add(line);
          const rect = el.getBoundingClientRect();
          result.push({ line, top: rect.top - containerRect.top });
        }
      });
      setBlockPositions(result);
    }
    if (!bodyRef.current) return;
    const observer = new MutationObserver(() => measure());
    observer.observe(bodyRef.current, { childList: true, subtree: true });
    measure();
    return () => observer.disconnect();
  }, [body]);

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
      <div className="markdown-body-with-gutter">
        <div className="markdown-comment-gutter" style={{ position: "relative" }}>
          {blockPositions.map(({ line, top }) => {
            const lineComments = commentsByLine.get(line) ?? [];
            return (
              <div key={line} style={{ position: "absolute", top, left: 0 }}>
                <button
                  className="comment-plus-btn"
                  aria-label="Add comment"
                  onClick={() => setCommentingLine(commentingLine === line ? null : line)}
                >
                  +
                </button>
                {(commentingLine === line || lineComments.length > 0) && (
                  <LineCommentMargin
                    filePath={filePath}
                    lineNumber={line}
                    lineText={lines[line - 1] ?? ""}
                    fileLines={lines}
                    matchedComments={lineComments}
                    showInput={commentingLine === line}
                    onCloseInput={() => setCommentingLine(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="markdown-body" ref={bodyRef}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSlug]}
            components={components as never}
          >
            {body}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
