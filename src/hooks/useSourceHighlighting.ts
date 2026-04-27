import { useState, useEffect, useMemo, useDeferredValue } from "react";
import { type BundledLanguage } from "shiki";
import { getSharedHighlighter } from "@/lib/shiki";
import { getShikiLanguage } from "@/lib/file-types";
import { useTheme } from "@/hooks/useTheme";
import kqlGrammar from "@/lib/kql.tmLanguage.json";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
    const lang = getShikiLanguage(path);
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
          // Shiki wraps each line in <span class="line">…</span> with nested
          // token <span>s inside. A regex with lazy .*? truncates at the first
          // inner </span>, so we split on the line-span boundary instead.
          const parts = fullHtml.split('<span class="line">');
          const htmlLines: string[] = [];
          for (let i = 1; i < parts.length; i++) {
            // Strip the closing </span> that belongs to the line wrapper.
            // Each part ends with </span> (line close) possibly followed by
            // </code></pre> or more line spans.
            const endIdx = parts[i].lastIndexOf('</span>');
            htmlLines.push(endIdx >= 0 ? parts[i].substring(0, endIdx) : parts[i]);
          }
          // Fallback: if split found no line spans (unexpected format), use plain escape
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
