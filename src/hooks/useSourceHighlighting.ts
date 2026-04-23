import { useState, useEffect, useMemo, useDeferredValue } from "react";
import { type BundledLanguage } from "shiki";
import { getSharedHighlighter } from "@/lib/shiki";
import { extname } from "@/lib/path-utils";
import kqlGrammar from "@/lib/kql.tmLanguage.json";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function langFromPath(path: string): string {
  const ext = extname(path).slice(1);
  const map: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
    py: "python", rs: "rust", go: "go", java: "java",
    c: "c", cpp: "cpp", h: "c", css: "css", html: "html",
    json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
    sh: "bash", bash: "bash", md: "markdown", sql: "sql",
    rb: "ruby", php: "php", swift: "swift", kt: "kotlin", cs: "csharp",
    xml: "xml", kql: "kql", csl: "kql",
  };
  return map[ext] ?? "text";
}

export function useSourceHighlighting(content: string, path: string) {
  const [highlightedLines, setHighlightedLines] = useState<string[]>([]);
  const deferredContent = useDeferredValue(content);
  const deferredLines = useMemo(() => deferredContent.split("\n"), [deferredContent]);

  // Theme tracking
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

  // Syntax highlighting per line (uses deferred lines to avoid blocking during rapid updates)
  useEffect(() => {
    let cancelled = false;
    const theme = currentTheme === "dark" ? "github-dark" : "github-light";
    const lang = langFromPath(path);
    getSharedHighlighter()
      .then(async (hl) => {
        if (cancelled) return;
        const loaded = hl.getLoadedLanguages();
        if (!loaded.includes(lang) && lang !== "text") {
          if (lang === "kql") {
            await hl.loadLanguage({
              name: "kql",
              ...kqlGrammar,
            }).catch(() => {});
          } else {
            await hl.loadLanguage(lang as BundledLanguage).catch(() => {});
          }
        }
        if (cancelled) return;
        const htmlLines = deferredLines.map((line) => {
          try {
            return hl.codeToHtml(line || " ", { lang, theme });
          } catch {
            return `<pre><code>${escapeHtml(line)}</code></pre>`;
          }
        });
        setHighlightedLines(htmlLines);
      })
      .catch(() => { if (!cancelled) setHighlightedLines([]); });
    return () => { cancelled = true; };
  }, [deferredLines, path, currentTheme]);

  return { highlightedLines };
}
