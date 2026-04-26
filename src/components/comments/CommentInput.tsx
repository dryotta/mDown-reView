import { useRef, useEffect, useState } from "react";
import { TEXT_MAX_LENGTH } from "@/lib/comment-utils";
import { readDraft, writeDraft, clearDraft } from "@/lib/comment-drafts";
import "@/styles/comments.css";

interface Props {
  onSave: (text: string) => void;
  onClose: () => void;
  placeholder?: string;
  // Optional localStorage key for persisting the in-progress draft. When
  // present, the textarea is hydrated from `localStorage[draftKey]` on
  // mount and the slot is updated on every change. The key is cleared on
  // both Save and Cancel. Recommended key shape:
  //   `${filePath}::reply::${commentId}`
  //   `${filePath}::new::${fingerprintAnchor(anchor)}`
  // For the file-level "+" composer (Group B / CommentsPanel), use:
  //   `${filePath}::new::${fingerprintAnchor({ kind: "file" })}`
  draftKey?: string;
}

export function CommentInput({ onSave, onClose, placeholder, draftKey }: Props) {
  const [text, setText] = useState<string>(() => (draftKey ? readDraft(draftKey) : ""));
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Persist on every change so a hard reload mid-typing still recovers.
  useEffect(() => {
    if (!draftKey) return;
    writeDraft(draftKey, text);
  }, [draftKey, text]);

  const handleSave = (value: string) => {
    if (draftKey) clearDraft(draftKey);
    onSave(value);
  };

  const handleClose = () => {
    if (draftKey) clearDraft(draftKey);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (text.trim() && text.length <= TEXT_MAX_LENGTH) handleSave(text.trim());
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleClose();
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
          onClick={() => text.trim() && !overLimit && handleSave(text.trim())}
          disabled={!text.trim() || overLimit}
        >
          Save
        </button>
        <button className="comment-btn" onClick={handleClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
