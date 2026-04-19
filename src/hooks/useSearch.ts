import { useState, useMemo, useCallback } from "react";

export interface SearchMatch {
  lineIndex: number;
  startCol: number;
  endCol: number;
}

export function useSearch(content: string) {
  const [query, setQueryRaw] = useState("");
  const [currentIndex, setCurrentIndex] = useState(-1);

  const matches = useMemo(() => {
    if (!query) return [];
    const results: SearchMatch[] = [];
    const lines = content.split("\n");
    const lowerQuery = query.toLowerCase();
    for (let i = 0; i < lines.length; i++) {
      const lowerLine = lines[i].toLowerCase();
      let pos = 0;
      while (pos <= lowerLine.length - lowerQuery.length) {
        const idx = lowerLine.indexOf(lowerQuery, pos);
        if (idx === -1) break;
        results.push({ lineIndex: i, startCol: idx, endCol: idx + query.length });
        pos = idx + 1;
      }
    }
    return results;
  }, [content, query]);

  const setQuery = useCallback((q: string) => {
    setQueryRaw(q);
    setCurrentIndex(q ? 0 : -1);
  }, []);

  const next = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentIndex((i) => (i + 1) % matches.length);
  }, [matches.length]);

  const prev = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentIndex((i) => (i - 1 + matches.length) % matches.length);
  }, [matches.length]);

  return { query, setQuery, matches, currentIndex, next, prev };
}
