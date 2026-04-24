import { useMemo } from "react";
import type { CommentThread } from "@/lib/tauri-commands";

function lineFor(thread: CommentThread): number {
  return thread.root.matchedLineNumber ?? thread.root.line ?? 1;
}

/**
 * Derive view-layer indexes from the loaded comment threads.
 * Both maps share the same `threads` input so they're computed together
 * and stay reference-stable when `threads` is reference-stable.
 *
 * - `threadsByLine`: every thread (resolved or not) grouped by its
 *   anchor line, used to render line popovers.
 * - `commentCountByLine`: count of unresolved comments (root + replies)
 *   per line, used by the gutter badges.
 */
export function useThreadsByLine(threads: CommentThread[]): {
  threadsByLine: Map<number, CommentThread[]>;
  commentCountByLine: Map<number, number>;
} {
  return useMemo(() => {
    const threadsByLine = new Map<number, CommentThread[]>();
    const commentCountByLine = new Map<number, number>();

    for (const t of threads) {
      const ln = lineFor(t);
      const arr = threadsByLine.get(ln) ?? [];
      arr.push(t);
      threadsByLine.set(ln, arr);

      if (!t.root.resolved) {
        commentCountByLine.set(ln, (commentCountByLine.get(ln) ?? 0) + 1);
      }
      for (const r of t.replies) {
        if (!r.resolved) {
          const replyLine = r.matchedLineNumber ?? r.line ?? ln;
          commentCountByLine.set(
            replyLine,
            (commentCountByLine.get(replyLine) ?? 0) + 1,
          );
        }
      }
    }

    return { threadsByLine, commentCountByLine };
  }, [threads]);
}
