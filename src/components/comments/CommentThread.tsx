import { useState } from "react";
import { useStore } from "@/store";
import type { CommentWithOrphan } from "@/store";
import "@/styles/comments.css";

interface Props {
  comment: CommentWithOrphan;
}

export function CommentThread({ comment }: Props) {
  const { editComment, deleteComment, resolveComment, unresolveComment } = useStore();
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(comment.text);

  const handleSaveEdit = () => {
    if (editText.trim()) {
      editComment(comment.id, editText.trim());
      setEditing(false);
    }
  };

  const date = new Date(comment.createdAt).toLocaleString();

  return (
    <div className={`comment-thread${comment.resolved ? " comment-resolved" : ""}`}>
      <div className={`comment-header${comment.resolved ? " comment-header-resolved" : ""}`}>
        <span className="comment-timestamp">{date}</span>
        {comment.isOrphaned && (
          <span className="comment-orphaned-icon" title="This comment's block was not found in the current document">⚠</span>
        )}
      </div>
      {editing ? (
        <div className="comment-edit">
          <textarea
            className="comment-textarea"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={3}
          />
          <div className="comment-input-actions">
            <button className="comment-btn comment-btn-primary" onClick={handleSaveEdit}>Save</button>
            <button className="comment-btn" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <p className="comment-text">{comment.text}</p>
      )}
      {comment.responses && comment.responses.length > 0 && (
        <div className="comment-responses">
          {comment.responses.map((r, i) => (
            <div key={i} className="comment-response">
              <span className="comment-response-author">{r.author}</span>
              <span className="comment-response-time">{new Date(r.createdAt).toLocaleString()}</span>
              <p className="comment-response-text">{r.text}</p>
            </div>
          ))}
        </div>
      )}
      <div className="comment-actions">
        {!editing && (
          <button className="comment-action-btn" onClick={() => { setEditing(true); setEditText(comment.text); }}>
            Edit
          </button>
        )}
        <button className="comment-action-btn" onClick={() => deleteComment(comment.id)}>
          Delete
        </button>
        {comment.resolved ? (
          <button className="comment-action-btn" onClick={() => unresolveComment(comment.id)}>
            Unresolve
          </button>
        ) : (
          <button className="comment-action-btn" onClick={() => resolveComment(comment.id)}>
            Resolve
          </button>
        )}
      </div>
    </div>
  );
}
