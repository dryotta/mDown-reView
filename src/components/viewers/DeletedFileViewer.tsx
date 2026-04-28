import { useComments } from "@/lib/vm/use-comments";
import { useStore } from "@/store";
import "@/styles/comments.css";

interface Props {
  filePath: string;
}

export function DeletedFileViewer({ filePath }: Props) {
  const { comments } = useComments(filePath);

  const fileName = filePath.split(/[/\\]/).pop() ?? filePath;

  const handleShowComments = () => {
    useStore.getState().toggleCommentsPane();
  };

  return (
    <div className="deleted-file-viewer" style={{ padding: 24, maxWidth: 640, margin: "0 auto" }}>
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

      {comments.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--color-muted)", marginBottom: 16 }}>
          No comments found in the review sidecar.
        </p>
      ) : (
        <div style={{ fontSize: 13, color: "var(--color-muted)", marginBottom: 16 }}>
          <p style={{ margin: "0 0 8px" }}>
            {comments.length} comment{comments.length > 1 ? "s" : ""} in the review sidecar.
          </p>
          <button
            type="button"
            onClick={handleShowComments}
            style={{
              padding: "6px 16px",
              border: "1px solid var(--color-border, #d0d7de)",
              background: "var(--color-surface, #f6f8fa)",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Show comments
          </button>
        </div>
      )}
    </div>
  );
}