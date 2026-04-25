import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { useCommentActions } from "@/lib/vm/use-comment-actions";
import { useStore } from "@/store";
import type { MatchedComment } from "@/lib/tauri-commands";
import { deriveAnchor } from "@/types/comments";
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
function CommentItem({ comment, variant, filePath, onStartReply }: {
  comment: MatchedComment;
  variant: "root" | "reply";
  filePath: string;
  onStartReply?: () => void;
}) {
  const { editComment, deleteComment, resolveComment, unresolveComment } = useCommentActions();
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(comment.text);
  const isMoveActive = useStore((s) => s.moveAnchorTarget === comment.id);
  // Move-anchor mode targets a source line. Only Line and File anchors map
  // cleanly onto a clicked line; typed anchors (image rect, csv cell, etc.)
  // would silently demote to Line on commit, which loses information. Hide
  // the button entirely for those — users edit/delete to re-anchor instead.
  const anchorKind = deriveAnchor(comment).kind;
  const canMoveAnchor = anchorKind === "line" || anchorKind === "file";

  const handleSaveEdit = () => {
    if (editText.trim()) {
      editComment(filePath, comment.id, editText.trim()).catch(() => {});
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
        <div className="comment-text"><ReactMarkdown>{comment.text}</ReactMarkdown></div>
      )}
      <div className="comment-actions" onClick={(e) => e.stopPropagation()}>
        {!editing && (
          <button className="comment-action-btn" onClick={() => { setEditing(true); setEditText(comment.text); }}>
            Edit
          </button>
        )}
        <button className="comment-action-btn" onClick={() => deleteComment(filePath, comment.id).catch(() => {})}>
          Delete
        </button>
        {variant === "root" && onStartReply && (
          <button className="comment-action-btn" onClick={onStartReply}>
            Reply
          </button>
        )}
        {variant === "root" && (
          comment.resolved ? (
            <button className="comment-action-btn" onClick={() => unresolveComment(filePath, comment.id).catch(() => {})}>
              Unresolve
            </button>
          ) : (
            <button className="comment-action-btn" onClick={() => resolveComment(filePath, comment.id).catch(() => {})}>
              Resolve
            </button>
          )
        )}
        {variant === "root" && canMoveAnchor && (
          <button
            className="comment-action-btn"
            onClick={() => {
              if (isMoveActive) useStore.getState().setMoveAnchorTarget(null);
              else useStore.getState().setMoveAnchorTarget(comment.id);
            }}
          >
            {isMoveActive ? "Cancel move" : "Move"}
          </button>
        )}
      </div>
    </div>
  );
}

// --- Thread container (root + replies + reply composer) ---
interface CommentThreadProps {
  rootComment: MatchedComment;
  replies?: MatchedComment[];
  filePath: string;
}

export function CommentThread({ rootComment, replies = [], filePath }: CommentThreadProps) {
  const { addReply } = useCommentActions();
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
      addReply(filePath, rootComment.id, replyText.trim()).catch(() => {});
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
      <CommentItem comment={rootComment} variant="root" filePath={filePath} onStartReply={() => setReplying(true)} />
      {replies.length > 0 && (
        <div className="comment-thread-replies">
          {replies.map(reply => (
            <CommentItem key={reply.id} comment={reply} variant="reply" filePath={filePath} />
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
