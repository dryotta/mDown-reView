import { useState, useRef, useEffect } from "react";
import { useStore } from "@/store";
import type { CommentWithOrphan } from "@/store";
import "@/styles/comments.css";

// --- Type/severity badge maps ---
const TYPE_BADGE_CLASSES: Record<string, string> = {
  suggestion: "comment-type-badge--suggestion",
  issue: "comment-type-badge--issue",
  question: "comment-type-badge--question",
  accuracy: "comment-type-badge--accuracy",
  style: "comment-type-badge--style",
  clarity: "comment-type-badge--clarity",
};

const SEVERITY_BADGE_CLASSES: Record<string, string> = {
  high: "comment-severity-badge--high",
  medium: "comment-severity-badge--medium",
  low: "comment-severity-badge--low",
};

// --- Single comment item (shared between root and reply rendering) ---
function CommentItem({ comment, variant, onStartReply }: {
  comment: CommentWithOrphan;
  variant: "root" | "reply";
  onStartReply?: () => void;
}) {
  const editComment = useStore((s) => s.editComment);
  const deleteComment = useStore((s) => s.deleteComment);
  const resolveComment = useStore((s) => s.resolveComment);
  const unresolveComment = useStore((s) => s.unresolveComment);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(comment.text);

  const handleSaveEdit = () => {
    if (editText.trim()) {
      editComment(comment.id, editText.trim());
      setEditing(false);
    }
  };

  const date = new Date(comment.timestamp).toLocaleString();

  return (
    <div className={`comment-item comment-item--${variant}`}>
      <div className="comment-item-header">
        <span className="comment-author-badge">{comment.author ?? "Unknown"}</span>
        {variant === "root" && comment.type && (
          <span className={`comment-type-badge ${TYPE_BADGE_CLASSES[comment.type] ?? ""}`}>
            {comment.type}
          </span>
        )}
        {variant === "root" && comment.severity && (
          <span className={`comment-severity-badge ${SEVERITY_BADGE_CLASSES[comment.severity] ?? ""}`}>
            {comment.severity}
          </span>
        )}
        <span className="comment-timestamp">{date}</span>
      </div>
      {editing ? (
        <div className="comment-edit">
          <textarea
            className="comment-textarea"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={2}
          />
          <div className="comment-input-actions">
            <button className="comment-btn comment-btn-primary" onClick={handleSaveEdit}>Save</button>
            <button className="comment-btn" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <p className="comment-text">{comment.text}</p>
      )}
      <div className="comment-actions" onClick={(e) => e.stopPropagation()}>
        {!editing && (
          <button className="comment-action-btn" onClick={() => { setEditing(true); setEditText(comment.text); }}>
            Edit
          </button>
        )}
        <button className="comment-action-btn" onClick={() => deleteComment(comment.id)}>
          Delete
        </button>
        {variant === "root" && onStartReply && (
          <button className="comment-action-btn" onClick={onStartReply}>
            Reply
          </button>
        )}
        {variant === "root" && (
          comment.resolved ? (
            <button className="comment-action-btn" onClick={() => unresolveComment(comment.id)}>
              Unresolve
            </button>
          ) : (
            <button className="comment-action-btn" onClick={() => resolveComment(comment.id)}>
              Resolve
            </button>
          )
        )}
      </div>
    </div>
  );
}

// --- Thread container (root + replies + reply composer) ---
interface CommentThreadProps {
  rootComment: CommentWithOrphan;
  replies?: CommentWithOrphan[];
  filePath: string;
}

export function CommentThread({ rootComment, replies = [], filePath }: CommentThreadProps) {
  const addReply = useStore((s) => s.addReply);
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState("");
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (replying && replyTextareaRef.current) {
      replyTextareaRef.current.focus();
    }
  }, [replying]);

  const handleSendReply = () => {
    if (replyText.trim()) {
      addReply(filePath, rootComment.id, replyText.trim());
      setReplyText("");
      setReplying(false);
    }
  };

  const resolvedClass = rootComment.resolved ? " comment-thread--resolved" : "";

  return (
    <div className={`comment-thread${resolvedClass}`}>
      {rootComment.isOrphaned && (
        <div className="comment-orphan-banner">
          ⚠ Original location not found — comment may need manual review
        </div>
      )}
      <CommentItem comment={rootComment} variant="root" onStartReply={() => setReplying(true)} />
      {replies.length > 0 && (
        <div className="comment-thread-replies">
          {replies.map(reply => (
            <CommentItem key={reply.id} comment={reply} variant="reply" />
          ))}
        </div>
      )}
      {replying && (
        <div className="comment-thread-reply-input" onClick={(e) => e.stopPropagation()}>
          <textarea
            ref={replyTextareaRef}
            className="comment-textarea"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Write a reply..."
            rows={2}
            aria-label="Reply"
          />
          <div className="comment-input-actions">
            <button className="comment-btn comment-btn-primary" onClick={handleSendReply}>Send</button>
            <button className="comment-btn" onClick={() => { setReplyText(""); setReplying(false); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
