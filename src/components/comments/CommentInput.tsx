import { useRef, useEffect, useState } from "react";
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
      if (text.trim()) onSave(text.trim());
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

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
      <div className="comment-input-actions">
        <button
          className="comment-btn comment-btn-primary"
          onClick={() => text.trim() && onSave(text.trim())}
          disabled={!text.trim()}
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
