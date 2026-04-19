import { useState } from "react";
import { useStore } from "@/store";
import { CommentThread } from "./CommentThread";
import type { CommentWithOrphan } from "@/store";
import "@/styles/comments.css";

interface Props {
  filePath: string;
  onScrollToLine?: (lineNumber: number) => void;
}

export function CommentsPanel({ filePath, onScrollToLine }: Props) {
  const { commentsByFile } = useStore();
  const [showResolved, setShowResolved] = useState(false);

  const allComments = commentsByFile[filePath] ?? [];
  const sorted = [...allComments].sort(
    (a, b) => (a.matchedLineNumber ?? a.lineNumber ?? 0) - (b.matchedLineNumber ?? b.lineNumber ?? 0)
  );
  const unresolved = sorted.filter((c) => !c.resolved);
  const resolved = sorted.filter((c) => c.resolved);
  const displayed = showResolved ? sorted : unresolved;

  const handleClick = (comment: CommentWithOrphan) => {
    const line = comment.matchedLineNumber ?? comment.lineNumber ?? 1;
    onScrollToLine?.(line);
    window.dispatchEvent(new CustomEvent("scroll-to-line", { detail: { line } }));
  };

  return (
    <div className="comments-panel">
      <div className="comments-panel-header">
        <span className="comments-panel-title">Comments ({unresolved.length})</span>
        <button className="comment-btn" onClick={() => setShowResolved((v) => !v)}>
          {showResolved ? "Hide resolved" : `Show resolved (${resolved.length})`}
        </button>
      </div>
      <div className="comments-panel-body">
        {displayed.length === 0 ? (
          <div className="comments-empty">No comments yet</div>
        ) : (
          displayed.map((comment) => (
            <div
              key={comment.id}
              className="comment-panel-item"
              onClick={() => handleClick(comment)}
            >
              <div className="comment-panel-item-line">
                Line {comment.matchedLineNumber ?? comment.lineNumber ?? "?"}
                {comment.isOrphaned && <span className="comment-orphaned-icon" title="Orphaned">⚠</span>}
              </div>
              <CommentThread comment={comment} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
