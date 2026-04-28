import { useStore } from "@/store";
import { useComments } from "@/lib/vm/use-comments";
import "@/styles/file-comment-badge.css";

interface FileCommentBadgeProps {
  filePath: string;
}

/**
 * File-level comment indicator. Shows comment count for the file.
 * At count 0, shows "💬 Add comment" for discoverability.
 * Click opens CommentsPanel via Zustand store action.
 */
export function FileCommentBadge({ filePath }: FileCommentBadgeProps) {
  const { threads } = useComments(filePath);
  const toggleCommentsPane = useStore((s) => s.toggleCommentsPane);

  // Count unresolved file-level threads (all comments show in panel)
  const unresolvedCount = threads.filter((t) => !t.root.resolved).length;

  return (
    <button
      className="file-comment-badge"
      onClick={() => toggleCommentsPane()}
      aria-label={unresolvedCount > 0 ? `${unresolvedCount} file comments` : "Add comment"}
      type="button"
    >
      💬 {unresolvedCount > 0 ? `${unresolvedCount} file comment${unresolvedCount !== 1 ? "s" : ""}` : "Add comment"}
    </button>
  );
}
