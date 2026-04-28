import { useComments } from "@/lib/vm/use-comments";
import "@/styles/comments.css";

interface Props {
  filePath: string;
}

export function DeletedFileViewer({ filePath }: Props) {
  const { comments } = useComments(filePath);

  const fileName = filePath.split(/[/\\]/).pop() ?? filePath;

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

      <p style={{ fontSize: 13, color: "var(--color-muted)", marginBottom: 16 }}>
        {comments.length === 0
          ? "No comments found in the review sidecar."
          : `${comments.length} comment${comments.length > 1 ? "s" : ""} — open the comments panel to view.`}
      </p>
    </div>
  );
}