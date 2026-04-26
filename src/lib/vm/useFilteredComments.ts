import { useMemo } from "react";
import { useComments } from "@/lib/vm/use-comments";
import { useWorkspaceComments } from "@/lib/vm/useWorkspaceComments";
import type { CommentThread } from "@/lib/tauri-commands";

/** Wire severity enum (`core::severity::Severity`) + `"none"` for comments
 *  with no severity. Iter 9 F3. */
export type SeverityFilter = "none" | "low" | "medium" | "high";

export interface CommentFilters {
  search: string;                    // case-insensitive substring vs any comment text
  severities: Set<SeverityFilter>;   // empty = all
  showResolved: boolean;             // false hides fully-resolved threads
  workspaceWide: boolean;            // false = only activeFilePath
}

export interface FilteredThread {
  filePath: string;
  thread: CommentThread;
}

function severityKey(sev: string | undefined): SeverityFilter {
  return sev === "low" || sev === "medium" || sev === "high" ? sev : "none";
}

function threadMatchesSeverity(t: CommentThread, sev: Set<SeverityFilter>): boolean {
  if (sev.size === 0) return true;
  for (const c of [t.root, ...t.replies]) {
    if (sev.has(severityKey(c.severity))) return true;
  }
  return false;
}

function threadMatchesSearch(t: CommentThread, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  for (const c of [t.root, ...t.replies]) {
    if (c.text.toLowerCase().includes(needle)) return true;
  }
  return false;
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
  const { threads: activeThreads } = useComments(
    filters.workspaceWide ? null : activeFilePath,
  );
  const workspace = useWorkspaceComments(filters.workspaceWide);

  return useMemo(() => {
    const collected: FilteredThread[] = [];
    if (filters.workspaceWide) {
      const paths = Object.keys(workspace).sort();
      for (const p of paths) {
        for (const t of workspace[p]) collected.push({ filePath: p, thread: t });
      }
    } else if (activeFilePath) {
      for (const t of activeThreads) collected.push({ filePath: activeFilePath, thread: t });
    }
    return collected
      .filter(({ thread }) => filters.showResolved || !threadIsAllResolved(thread))
      .filter(({ thread }) => threadMatchesSeverity(thread, filters.severities))
      .filter(({ thread }) => threadMatchesSearch(thread, filters.search))
      .sort((a, b) => {
        if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
        const la = a.thread.root.matchedLineNumber ?? a.thread.root.line ?? 0;
        const lb = b.thread.root.matchedLineNumber ?? b.thread.root.line ?? 0;
        return la - lb;
      });
  }, [activeFilePath, activeThreads, workspace, filters]);
}
