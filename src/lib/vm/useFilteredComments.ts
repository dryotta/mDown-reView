import { useMemo } from "react";
import { useComments } from "@/lib/vm/use-comments";
import type { CommentThread } from "@/lib/tauri-commands";

export interface CommentFilters {
  showResolved: boolean;             // false hides fully-resolved threads
}

export interface FilteredThread {
  filePath: string;
  thread: CommentThread;
}

function threadIsAllResolved(t: CommentThread): boolean {
  if (!t.root.resolved) return false;
  return t.replies.every((r) => r.resolved);
}

/** Filtered, ordered list of threads to render in the panel.
 *  Always carries the source filePath alongside each thread. */
export function useFilteredComments(
  activeFilePath: string | null,
  filters: CommentFilters,
): FilteredThread[] {
  const { threads: activeThreads } = useComments(activeFilePath);

  return useMemo(() => {
    if (!activeFilePath) return [];
    const collected: FilteredThread[] = activeThreads.map((t) => ({
      filePath: activeFilePath,
      thread: t,
    }));
    return collected
      .filter(({ thread }) => filters.showResolved || !threadIsAllResolved(thread))
      .sort((a, b) => {
        const la = a.thread.root.matchedLineNumber ?? a.thread.root.line ?? 0;
        const lb = b.thread.root.matchedLineNumber ?? b.thread.root.line ?? 0;
        return la - lb;
      });
  }, [activeFilePath, activeThreads, filters]);
}
