import type { CommentWithOrphan } from "@/store";

export interface CommentThreadGroup {
  root: CommentWithOrphan;
  replies: CommentWithOrphan[];
}

/**
 * Group flat comments into threads: root comments (no reply_to) with their replies.
 * Replies to non-existent parents are promoted to root threads.
 * Replies are sorted by timestamp ascending.
 */
export function groupCommentsIntoThreads(comments: CommentWithOrphan[]): CommentThreadGroup[] {
  const rootIds = new Set(comments.filter(c => !c.reply_to).map(c => c.id));
  const repliesByParent = new Map<string, CommentWithOrphan[]>();
  const orphanedReplies: CommentWithOrphan[] = [];

  for (const c of comments) {
    if (c.reply_to) {
      if (rootIds.has(c.reply_to)) {
        const arr = repliesByParent.get(c.reply_to) ?? [];
        arr.push(c);
        repliesByParent.set(c.reply_to, arr);
      } else {
        orphanedReplies.push(c);
      }
    }
  }

  for (const [, replies] of repliesByParent) {
    replies.sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""));
  }

  const roots = comments.filter(c => !c.reply_to);
  const allRoots = [...roots, ...orphanedReplies];

  return allRoots.map(root => ({
    root,
    replies: repliesByParent.get(root.id) ?? [],
  }));
}
