import { useMemo } from "react";
import type { CommentThread, MatchedComment } from "@/lib/tauri-commands";
import { deriveAnchor } from "@/lib/anchor-derive";

/**
 * Canonical filter site for per-line gutter bucketing — Rule 31 in
 * `docs/architecture.md`. Threads MUST be excluded from the gutter when:
 *
 *   - `t.root.isOrphaned` — re-anchoring failed; surfaces in the orphan
 *     banner / file-level toolbar pile, not at any line.
 *   - `t.root.matchedLineNumber <= 0` — `Anchor::Unknown` and unresolved
 *     `Anchor::WordRange` sentinel (matched_line_number == 0). Should not
 *     bucket; it has no file-line representation.
 *   - `deriveAnchor(t.root).kind === 'file'` — file-anchored comments
 *     (`Anchor::File`, matched_line_number == 1 sentinel) belong on the
 *     file-level toolbar pill (iter 3), not at line 1's gutter.
 *
 * Routes through `deriveAnchor()` (NOT raw `anchor_kind` string equality)
 * so the in-memory tagged-union helper remains the single discriminator
 * surface — see `src/lib/anchor-derive.ts`.
 */
function shouldExcludeFromGutter(t: CommentThread): boolean {
  if (t.root.isOrphaned) return true;
  // Defensive: production MatchedComment always carries a number here, but
  // legacy / fixture data may set it to 0 or omit it. Treat anything that
  // is not a strictly-positive integer as "no file-line representation".
  if (typeof t.root.matchedLineNumber !== "number" || t.root.matchedLineNumber <= 0) {
    return true;
  }
  if (deriveAnchor(t.root).kind === "file") return true;
  return false;
}

/**
 * Derive view-layer indexes from the loaded comment threads.
 * Both maps share the same `threads` input so they're computed together
 * and stay reference-stable when `threads` is reference-stable.
 *
 * - `threadsByLine`: every (gutter-eligible) thread (resolved or not)
 *   grouped by its anchor line, used to render line popovers.
 * - `commentCountByLine`: count of unresolved comments (root + replies)
 *   per line, used by the gutter badges.
 *
 * File-anchored, orphan, and Unknown-anchor threads are filtered out by
 * `shouldExcludeFromGutter` and surface elsewhere (toolbar pill / orphan
 * banner) per Rule 31.
 */
export function useThreadsByLine(threads: CommentThread[]): {
  threadsByLine: Map<number, CommentThread[]>;
  commentCountByLine: Map<number, number>;
} {
  return useMemo(() => {
    const threadsByLine = new Map<number, CommentThread[]>();
    const commentCountByLine = new Map<number, number>();

    for (const t of threads) {
      if (shouldExcludeFromGutter(t)) continue;
      // Invariant after the filter: matchedLineNumber > 0 and not file-anchor.
      const ln = t.root.matchedLineNumber;
      const arr = threadsByLine.get(ln) ?? [];
      arr.push(t);
      threadsByLine.set(ln, arr);

      if (!t.root.resolved) {
        commentCountByLine.set(ln, (commentCountByLine.get(ln) ?? 0) + 1);
      }
      for (const r of t.replies) {
        if (r.resolved) continue;
        // Replies inherit their thread's gutter eligibility (filtered at
        // the root above). Bucket each reply at its OWN matchedLineNumber
        // so re-anchored replies don't double-count on the root's line.
        // If the reply lacks a positive matched line (legacy or unresolved
        // anchor), fall back to the root's line — never the dead `?? 1`
        // sentinel.
        const replyLine = replyLineFor(r, ln);
        if (replyLine <= 0) continue;
        commentCountByLine.set(
          replyLine,
          (commentCountByLine.get(replyLine) ?? 0) + 1,
        );
      }
    }

    return { threadsByLine, commentCountByLine };
  }, [threads]);
}

function replyLineFor(r: MatchedComment, rootLine: number): number {
  if (typeof r.matchedLineNumber === "number" && r.matchedLineNumber > 0) {
    return r.matchedLineNumber;
  }
  return rootLine;
}
