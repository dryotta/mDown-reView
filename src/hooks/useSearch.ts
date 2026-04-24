import { useState, useEffect, useCallback, useDeferredValue } from "react";
import { searchInDocument, type SearchMatch } from "@/lib/tauri-commands";

export type { SearchMatch };

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
        setMatches(rustMatches);
      }
    }).catch(() => {
      if (!cancelled) setMatches([]);
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
