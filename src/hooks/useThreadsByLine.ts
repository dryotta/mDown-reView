import { useMemo } from "react";
import type { CommentThread } from "@/lib/tauri-commands";

export function useThreadsByLine(threads: CommentThread[]) {
  return useMemo(() => {
    const map = new Map<number, CommentThread[]>();
    for (const t of threads) {
      const ln = t.root.matchedLineNumber ?? t.root.line ?? 1;
      const arr = map.get(ln) ?? [];
      arr.push(t);
      map.set(ln, arr);
    }
    return map;
  }, [threads]);
}
