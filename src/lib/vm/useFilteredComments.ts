import { useMemo } from "react";
import { useComments } from "@/lib/vm/use-comments";
import type { CommentThread } from "@/lib/tauri-commands";
import { deriveAnchor, assertNeverAnchorKind } from "@/types/comments";

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

/**
 * Returns true if the thread's root comment has an anchor kind that
 * should be shown in the CommentsPanel. Excludes "unknown" anchors
 * (deleted viewer-specific anchor types like image_rect, csv_cell, etc.).
 */
function threadIsDisplayable(t: CommentThread): boolean {
  const anchor = deriveAnchor(t.root);
  switch (anchor.kind) {
    case "line":
    case "file":
    case "word_range":
      return true;
    case "unknown":
      return false;
    default:
      assertNeverAnchorKind(anchor);
  }
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
      .filter(({ thread }) => threadIsDisplayable(thread))
      .filter(({ thread }) => filters.showResolved || !threadIsAllResolved(thread))
      .sort((a, b) => {
        const la = a.thread.root.matchedLineNumber ?? a.thread.root.line ?? 0;
        const lb = b.thread.root.matchedLineNumber ?? b.thread.root.line ?? 0;
        return la - lb;
      });
  }, [activeFilePath, activeThreads, filters]);
}
