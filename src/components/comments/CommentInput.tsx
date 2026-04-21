import { useRef, useEffect, useState } from "react";
import { TEXT_MAX_LENGTH } from "@/lib/comment-utils";
import "@/styles/comments.css";

interface Props {
  onSave: (text: string) => void;
  onClose: () => void;
  placeholder?: string;
}

export function CommentInput({ onSave, onClose, placeholder }: Props) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (text.trim() && text.length <= TEXT_MAX_LENGTH) onSave(text.trim());
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const overLimit = text.length > TEXT_MAX_LENGTH;
  const showCounter = text.length > TEXT_MAX_LENGTH - 1000;

  return (
    <div className="comment-input">
      <textarea
        ref={textareaRef}
        className="comment-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? "Add a comment… (Ctrl+Enter to save, Escape to cancel)"}
        rows={3}
      />
      {showCounter && (
        <div className={`comment-char-count${overLimit ? " over-limit" : ""}`}>
          {text.length.toLocaleString()} / {TEXT_MAX_LENGTH.toLocaleString()}
        </div>
      )}
      <div className="comment-input-actions">
        <button
          className="comment-btn comment-btn-primary"
          onClick={() => text.trim() && !overLimit && onSave(text.trim())}
          disabled={!text.trim() || overLimit}
        >
          Save
        </button>
        <button className="comment-btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
