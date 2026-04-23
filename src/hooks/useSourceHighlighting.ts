import { useState, useEffect, useMemo, useDeferredValue } from "react";
import { type BundledLanguage } from "shiki";
import { getSharedHighlighter } from "@/lib/shiki";
import { extname } from "@/lib/path-utils";
import { useTheme } from "@/hooks/useTheme";
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

  const currentTheme = useTheme();

  // Syntax highlighting: single call for the whole document, then split by line
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
        try {
          const fullHtml = hl.codeToHtml(deferredContent || " ", { lang, theme });
          // Shiki wraps each line in <span class="line">...</span>
          // Extract the inner HTML of each line span
          const lineRegex = /<span class="line">(.*?)<\/span>/gs;
          const htmlLines: string[] = [];
          let match;
          while ((match = lineRegex.exec(fullHtml)) !== null) {
            htmlLines.push(match[1]);
          }
          // Fallback: if regex didn't match (unexpected format), use plain escape
          if (htmlLines.length === 0) {
            for (const line of deferredLines) {
              htmlLines.push(escapeHtml(line));
            }
          }
          setHighlightedLines(htmlLines);
        } catch {
          setHighlightedLines(deferredLines.map(l => escapeHtml(l)));
        }
      })
      .catch(() => { if (!cancelled) setHighlightedLines([]); });
    return () => { cancelled = true; };
  }, [deferredContent, deferredLines, path, currentTheme]);

  return { highlightedLines };
}
