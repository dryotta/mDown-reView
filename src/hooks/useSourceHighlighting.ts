import { useState, useEffect, useMemo, useDeferredValue } from "react";
import { type BundledLanguage, type ThemedToken } from "shiki";
import { getSharedHighlighter } from "@/lib/shiki";
import { getShikiLanguage } from "@/lib/file-types";
import { useTheme } from "@/hooks/useTheme";
import kqlGrammar from "@/lib/kql.tmLanguage.json";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Shiki's `fontStyle` is a bitmask: 1=italic, 2=bold, 4=underline, 8=strikethrough.
// (See shiki/packages/core/src/types/tokens.ts — FontStyle enum.)
const FS_ITALIC = 1;
const FS_BOLD = 2;
const FS_UNDERLINE = 4;
const FS_STRIKETHROUGH = 8;

// Render a single Shiki token as a coloured `<span>`. Mirrors what
// `codeToHtml` produces per token (one span per token), but without the
// surrounding `<pre>`/`<code>`/`<span class="line">` wrappers — those are
// owned by the SourceView so each line becomes one row in the gutter table.
function tokenToSpan(token: ThemedToken): string {
  const styles: string[] = [];
  if (token.color) styles.push(`color:${token.color}`);
  if (token.bgColor) styles.push(`background-color:${token.bgColor}`);
  if (token.fontStyle && token.fontStyle > 0) {
    if (token.fontStyle & FS_ITALIC) styles.push("font-style:italic");
    if (token.fontStyle & FS_BOLD) styles.push("font-weight:bold");
    if (token.fontStyle & FS_UNDERLINE) styles.push("text-decoration:underline");
    if (token.fontStyle & FS_STRIKETHROUGH) styles.push("text-decoration:line-through");
  }
  const style = styles.join(";");
  return style
    ? `<span style="${style}">${escapeHtml(token.content)}</span>`
    : escapeHtml(token.content);
}

export function useSourceHighlighting(content: string, path: string) {
  const [shikiLines, setShikiLines] = useState<string[]>([]);
  const deferredContent = useDeferredValue(content);
  const deferredLines = useMemo(() => deferredContent.split("\n"), [deferredContent]);

  const currentTheme = useTheme();
  const lang = useMemo(() => getShikiLanguage(path), [path]);

  // `text` is a no-op for Shiki — skip the round-trip entirely and just
  // escape per line. Computed via `useMemo` (not `setState` in an effect)
  // to satisfy `react-hooks/set-state-in-effect`. This is also the fallback
  // when an unmapped file type reaches us (`getShikiLanguage` returns
  // `text`).
  const textLines = useMemo<string[] | null>(
    () => (lang === "text" ? deferredLines.map(escapeHtml) : null),
    [lang, deferredLines],
  );

  // Syntax highlighting: single tokenisation for the whole document, then
  // serialise per-line. `codeToTokens` returns `ThemedToken[][]` (outer index
  // = line, inner = tokens within that line) so there is no fragile HTML
  // post-processing — every token becomes one span, every line is one entry
  // in the array, which the SourceView renders as one row in its gutter
  // table. Replaces an earlier regex-based extractor that truncated
  // multi-token lines at the first inner `</span>`.
  useEffect(() => {
    if (lang === "text") return;   // text path handled by `textLines` memo
    let cancelled = false;
    const theme = currentTheme === "dark" ? "github-dark" : "github-light";

    getSharedHighlighter()
      .then(async (hl) => {
        if (cancelled) return;
        const loaded = hl.getLoadedLanguages();
        if (!loaded.includes(lang)) {
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
          const result = hl.codeToTokens(deferredContent || " ", {
            lang: lang as BundledLanguage,
            theme,
          });
          const htmlLines = result.tokens.map((lineTokens) =>
            lineTokens.map(tokenToSpan).join(""),
          );
          // Empty content produced one synthetic blank line — keep alignment
          // with `deferredLines` so the gutter row count matches.
          if (deferredContent === "" && htmlLines.length === 1) {
            setShikiLines([""]);
          } else {
            setShikiLines(htmlLines);
          }
        } catch {
          setShikiLines(deferredLines.map(escapeHtml));
        }
      })
      .catch(() => { if (!cancelled) setShikiLines([]); });
    return () => { cancelled = true; };
  }, [deferredContent, deferredLines, path, currentTheme, lang]);

  return { highlightedLines: textLines ?? shikiLines };
}
