import { useRef, useEffect, useState } from "react";
import { TEXT_MAX_LENGTH } from "@/lib/comment-utils";
import { readDraft, writeDraft, clearDraft } from "@/lib/comment-drafts";
import { error as logError } from "@/logger";
import "@/styles/comments.css";

interface Props {
  // Iter 3 (#280) AC6 — widened to `void | Promise<void>` so callers can
  // return the IPC promise. CommentInput awaits the promise inside
  // try/catch and surfaces save failures via an inline `role="alert"`
  // banner. Backwards-compatible: sync `() => void` callers Just Work
  // (their return value is awaited as `Promise.resolve(undefined)`).
  onSave: (text: string) => void | Promise<void>;
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
  // Iter 3 (#280) AC6 — inline save-error banner state. Local to the
  // component (not lifted) because the failure is per-composer-instance
  // and the parent panel keeps its own typed-error self-heal banner.
  // No global toast primitive (lean + architect + react-tauri agreed).
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Persist on every change so a hard reload mid-typing still recovers.
  useEffect(() => {
    if (!draftKey) return;
    writeDraft(draftKey, text);
  }, [draftKey, text]);

  const handleSave = async (value: string) => {
    setError(null);
    try {
      await onSave(value);
      // Iter 3 (#280) AC6 — clear draft only on success. The pre-iter-3
      // implementation cleared the draft BEFORE awaiting onSave, which
      // lost the user's text on rejection. Now: persist until the IPC
      // confirms the write.
      if (draftKey) clearDraft(draftKey);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      void logError(`CommentInput save failed: ${msg}`);
    }
  };

  const handleClose = () => {
    if (draftKey) clearDraft(draftKey);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (text.trim() && text.length <= TEXT_MAX_LENGTH) void handleSave(text.trim());
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
      {error && (
        <div className="comment-input-error" role="alert" aria-live="polite">
          {error}
        </div>
      )}
      <div className="comment-input-actions">
        <button
          className="comment-btn comment-btn-primary"
          onClick={() => text.trim() && !overLimit && void handleSave(text.trim())}
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
