import { useEffect, useRef, useState } from "react";
import { useAuthor } from "@/lib/vm/useAuthor";
import type { ConfigError } from "@/lib/tauri-commands";
import "@/styles/about-dialog.css";

interface Props {
  onClose: () => void;
}

const REASON_MESSAGES: Record<string, string> = {
  empty: "Name required",
  too_long: "Name is too long (max 128 bytes)",
  newline: "Name cannot contain line breaks",
  control_char: "Name cannot contain control characters",
};

function isConfigError(e: unknown): e is ConfigError {
  return typeof e === "object" && e !== null && "kind" in e;
}

/**
 * Minimal Settings dialog (AC #71/F7). Single field — display name for
 * authored comments. Validation surfaces are routed through the typed
 * `ConfigError` discriminator returned by `set_author` so the UI can
 * branch on `kind` without parsing prose.
 *
 * Uses the native `<dialog>` element with `showModal()` for built-in
 * focus trap, Esc-cancel, and inert backdrop — no third-party
 * focus-trap library (Lean pillar). AboutDialog should follow the same
 * pattern in a future iteration.
 */
export function SettingsDialog({ onClose }: Props) {
  const { author, setAuthor } = useAuthor();
  // Hydration race: when the dialog mounts before `useAuthor`'s `get_author`
  // IPC resolves, `author` arrives as `""` and a useState(author) snapshot
  // would freeze the empty value. Track the edited draft separately and
  // fall back to the live `author` until the user types — so a late
  // hydration is reflected without a setState-in-effect cascade
  // (`react-hooks/set-state-in-effect`).
  const [editedDraft, setEditedDraft] = useState<string | null>(null);
  const draft = editedDraft ?? author;
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Open as a modal on mount. `showModal` provides the focus trap + Esc
  // handler + inert backdrop. We deliberately do NOT call `close()` from
  // cleanup: the dialog is removed from the DOM when this component
  // unmounts, and an explicit `close()` would dispatch the native
  // `close` event into our `onClose` handler, racing the unmount under
  // React StrictMode.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch {
        // showModal can throw if the dialog is already open in a stale
        // tree — best-effort, continue rendering.
      }
    }
  }, []);

  const handleSave = async () => {
    setErrorMsg(null);
    setSaving(true);
    try {
      await setAuthor(draft);
      onClose();
    } catch (e) {
      if (isConfigError(e)) {
        if (e.kind === "InvalidAuthor") {
          setErrorMsg(REASON_MESSAGES[e.reason] ?? "Invalid name");
        } else {
          setErrorMsg(`Could not save: ${e.message}`);
        }
      } else {
        setErrorMsg("Could not save settings");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="dialog-box"
      aria-labelledby="settings-title"
      onCancel={(e) => {
        // Native `cancel` fires on Esc. Prevent the default close so we
        // route through the parent's onClose which owns the open flag.
        e.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onClick={(e) => {
        // Click on the backdrop (the dialog element itself, not its
        // contents) closes — preserves the previous overlay-click UX.
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <div className="dialog-header">
        <h2 id="settings-title">Settings</h2>
        <button className="dialog-close" onClick={onClose} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
          </svg>
        </button>
      </div>
      <div className="dialog-body">
        <div className="dialog-channel-section">
          <label className="dialog-label" htmlFor="settings-author">
            Display name
          </label>
          <input
            id="settings-author"
            type="text"
            className="dialog-channel-select"
            value={draft}
            onChange={(e) => {
              setEditedDraft(e.target.value);
              if (errorMsg) setErrorMsg(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !saving) {
                e.preventDefault();
                void handleSave();
              }
              // Esc handled by native <dialog> `cancel` event above.
            }}
            maxLength={128}
            autoFocus
          />
          <p className="dialog-channel-warning" style={{ visibility: errorMsg ? "visible" : "hidden" }}>
            {errorMsg ?? "placeholder"}
          </p>
        </div>
        <div className="comment-input-actions" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="comment-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="comment-btn comment-btn-primary"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            Save
          </button>
        </div>
      </div>
    </dialog>
  );
}
