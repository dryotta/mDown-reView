import { useState, useEffect, useCallback, useDeferredValue } from "react";
import { searchInDocument } from "@/lib/tauri-commands";

export interface SearchMatch {
  lineIndex: number;
  startCol: number;
  endCol: number;
}

export function useSearch(content: string) {
  const [query, setQueryRaw] = useState("");
  const [currentIndex, setCurrentIndex] = useState(-1);
  const deferredQuery = useDeferredValue(query);
  const isPending = query !== deferredQuery;

  const [matches, setMatches] = useState<SearchMatch[]>([]);

  useEffect(() => {
    let cancelled = false;
    searchInDocument(content, deferredQuery).then(rustMatches => {
      if (!cancelled) {
        setMatches(rustMatches.map(m => ({
          lineIndex: m.line_index,
          startCol: m.start_col,
          endCol: m.end_col,
        })));
      }
    });
    return () => { cancelled = true; };
  }, [content, deferredQuery]);

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

  return { query, setQuery, matches, currentIndex, next, prev, isPending };
}
