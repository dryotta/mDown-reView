import { useState } from "react";
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
 */
export function SettingsDialog({ onClose }: Props) {
  const { author, setAuthor } = useAuthor();
  const [draft, setDraft] = useState(author);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    <div className="dialog-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Settings">
      <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>Settings</h2>
          <button className="dialog-close" onClick={onClose} aria-label="Close">
            ×
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
                setDraft(e.target.value);
                if (errorMsg) setErrorMsg(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !saving) {
                  e.preventDefault();
                  void handleSave();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  onClose();
                }
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
      </div>
    </div>
  );
}
