import { useState, useMemo, useEffect } from "react";
import { computeFoldRegions, type FoldRegion } from "@/lib/tauri-commands";
import { getFoldLanguage } from "@/lib/file-types";

export function useFolding(content: string, filePath: string) {
  const [collapsedLines, setCollapsedLines] = useState<Set<number>>(new Set());
  const [foldRegions, setFoldRegions] = useState<FoldRegion[]>([]);

  // Re-compute fold regions in Rust whenever the content or file changes.
  useEffect(() => {
    let cancelled = false;
    const language = getFoldLanguage(filePath);
    computeFoldRegions(content, language)
      .then((regions) => {
        if (!cancelled) setFoldRegions(Array.isArray(regions) ? regions : []);
      })
      .catch(() => {
        if (!cancelled) setFoldRegions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [content, filePath]);

  const foldStartMap = useMemo(() => {
    const m = new Map<number, FoldRegion>();
    foldRegions.forEach((r) => {
      if (!m.has(r.startLine) || m.get(r.startLine)!.endLine < r.endLine) {
        m.set(r.startLine, r);
      }
    });
    return m;
  }, [foldRegions]);

  const toggleFold = (lineNum: number) => {
    setCollapsedLines((prev) => {
      const next = new Set(prev);
      if (next.has(lineNum)) next.delete(lineNum);
      else next.add(lineNum);
      return next;
    });
  };

  // Reset folds when file changes
  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset when filePath prop changes
  useEffect(() => { setCollapsedLines(new Set()); }, [filePath]);

  return { collapsedLines, foldStartMap, toggleFold };
}
