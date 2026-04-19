import { useEffect, useState } from "react";
import { createHighlighter, type Highlighter } from "shiki";
import { extname } from "@/lib/path-utils";
import "@/styles/source-viewer.css";

const SIZE_WARN_THRESHOLD = 500 * 1024;

interface Props {
  content: string;
  path: string;
  fileSize?: number;
}

let highlighterInstance: Highlighter | null = null;

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterInstance) {
    highlighterInstance = await createHighlighter({
      themes: ["github-light", "github-dark"],
      langs: [],
    });
  }
  return highlighterInstance;
}

function langFromPath(path: string): string {
  const ext = extname(path).slice(1); // remove leading dot
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "c",
    css: "css",
    html: "html",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    sh: "bash",
    bash: "bash",
    md: "markdown",
    sql: "sql",
    rb: "ruby",
    php: "php",
    swift: "swift",
    kt: "kotlin",
    cs: "csharp",
  };
  return map[ext] ?? "text";
}

export function SourceViewer({ content, path, fileSize }: Props) {
  const [html, setHtml] = useState<string>("");
  const [plainMode, setPlainMode] = useState(false);
  const showSizeWarning = fileSize !== undefined && fileSize > SIZE_WARN_THRESHOLD;

  // Track data-theme attribute for reactive re-highlighting
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
    if (plainMode) {
      setHtml("");
      return;
    }
    const theme = currentTheme === "dark" ? "github-dark" : "github-light";
    const lang = langFromPath(path);

    getHighlighter()
      .then((hl) => {
        const rendered = hl.codeToHtml(content, { lang, theme });
        setHtml(rendered);
      })
      .catch(() => setHtml(""));
  }, [content, path, plainMode, currentTheme]);

  return (
    <div className="source-viewer">
      {showSizeWarning && (
        <div className="size-warning">
          This file is large ({Math.round((fileSize ?? 0) / 1024)} KB) — rendering may be slow.{" "}
          <button onClick={() => setPlainMode((v) => !v)}>
            {plainMode ? "Show with highlighting" : "Show as plain text"}
          </button>
        </div>
      )}
      {plainMode || !html ? (
        <pre className="source-plain">
          <code data-lang={langFromPath(path)}>{content}</code>
        </pre>
      ) : (
        <div
          className="source-highlighted"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
