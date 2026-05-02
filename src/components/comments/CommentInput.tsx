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
  // Iter 3 forward-fix (bug-expert BLOCK): in-flight guard. Without this,
  // a rapid double-click on Save (or held Ctrl+Enter) would fire the
  // addComment IPC twice and persist duplicate threads. The guard
  // disables the Save button + Ctrl+Enter shortcut for the duration of
  // the awaited onSave call.
  const [saving, setSaving] = useState(false);
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
    if (saving) return; // re-entry guard
    setError(null);
    let result: void | Promise<void>;
    try {
      result = onSave(value);
    } catch (e) {
      // Sync throw — surface it the same way as a rejected promise.
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      void logError(`CommentInput save failed: ${msg}`);
      return;
    }
    // Sync onSave path (existing legacy callers): clear draft immediately;
    // skip the in-flight UI churn (no setSaving toggle so existing sync
    // tests don't see act-warnings).
    if (!(result instanceof Promise)) {
      if (draftKey) clearDraft(draftKey);
      return;
    }
    // Async onSave path (Iter 3 #280 AC6): show "Saving…" while the IPC
    // is in flight; preserve the draft until the promise settles
    // successfully; clear it only on success. The `saving` state guards
    // the button, the Ctrl+Enter shortcut, and re-entry to handleSave.
    setSaving(true);
    try {
      await result;
      if (draftKey) clearDraft(draftKey);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      void logError(`CommentInput save failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (draftKey) clearDraft(draftKey);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (!saving && text.trim() && text.length <= TEXT_MAX_LENGTH) {
        void handleSave(text.trim());
      }
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
          onClick={() => {
            if (saving || !text.trim() || overLimit) return;
            void handleSave(text.trim());
          }}
          disabled={saving || !text.trim() || overLimit}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button className="comment-btn" onClick={handleClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
