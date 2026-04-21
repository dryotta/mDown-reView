import { useEffect, useRef } from "react";
import { useStore } from "@/store";
import { loadReviewComments } from "@/lib/tauri-commands";
import { CommentThread } from "@/components/comments/CommentThread";
import { groupCommentsIntoThreads } from "@/lib/comment-threads";
import type { CommentWithOrphan } from "@/store";
import "@/styles/comments.css";

interface Props {
  filePath: string;
}

export function DeletedFileViewer({ filePath }: Props) {
  const setFileComments = useStore((s) => s.setFileComments);
  const comments = useStore((s) => s.commentsByFile[filePath]) ?? [];
  const loadedRef = useRef(false);

  // Load comments from sidecar
  useEffect(() => {
    loadedRef.current = false;
    loadReviewComments(filePath)
      .then((result) => {
        if (result?.comments) {
          // Mark all comments as orphaned since file is deleted
          const orphaned: CommentWithOrphan[] = result.comments.map((c) => ({
            ...c,
            isOrphaned: true,
          }));
          setFileComments(filePath, orphaned);
        }
        loadedRef.current = true;
      })
      .catch(() => {
        loadedRef.current = true;
      });
  }, [filePath, setFileComments]);

  const fileName = filePath.split(/[/\\]/).pop() ?? filePath;

  return (
    <div style={{ padding: 24, maxWidth: 640, margin: "0 auto" }}>
      <div style={{
        background: "rgba(245, 166, 35, 0.1)",
        border: "1px solid rgba(245, 166, 35, 0.3)",
        borderRadius: 8,
        padding: "16px 20px",
        marginBottom: 20,
      }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>
          🗑️ File Deleted
        </h3>
        <p style={{ margin: 0, fontSize: 14, color: "var(--color-muted)" }}>
          <strong>{fileName}</strong> has been deleted or moved, but its review comments still exist.
        </p>
      </div>

      <p style={{ fontSize: 13, color: "var(--color-muted)", marginBottom: 16 }}>
        {comments.length === 0
          ? "No comments found in the review sidecar."
          : `${comments.length} comment${comments.length > 1 ? "s" : ""} from the review sidecar:`}
      </p>

      {groupCommentsIntoThreads(comments).map(t => (
        <CommentThread key={t.root.id} rootComment={t.root} replies={t.replies} filePath={filePath} />
      ))}
    </div>
  );
}