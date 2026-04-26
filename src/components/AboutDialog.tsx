import { useEffect, useRef, useState } from "react";
import { copyToClipboard } from "@/lib/tauri-commands";
import { useUpdateActions } from "@/lib/vm/use-update-actions";
import { useAboutInfo } from "@/hooks/useAboutInfo";
import { useStore, type UpdateChannel } from "@/store";
import { useShallow } from "zustand/shallow";
import "@/styles/about-dialog.css";

interface Props {
  onClose: () => void;
}

export function AboutDialog({ onClose }: Props) {
  const { version, logPath } = useAboutInfo();
  const [copied, setCopied] = useState(false);

  const { updateChannel, setUpdateChannel } = useStore(
    useShallow((s) => ({
      updateChannel: s.updateChannel,
      setUpdateChannel: s.setUpdateChannel,
    }))
  );
  const { checkForUpdate } = useUpdateActions();

  const handleCopy = async () => {
    await copyToClipboard(logPath);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleChannelChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const channel = e.target.value as UpdateChannel;
    setUpdateChannel(channel);
    await checkForUpdate(channel);
  };

  const isCanary = version.includes("-");

  const dialogRef = useRef<HTMLDialogElement>(null);

  // Mirror SettingsDialog: open via showModal() for native focus trap +
  // Esc handling + inert backdrop. Deliberately omit close() in cleanup —
  // the dialog leaves the DOM on unmount and an explicit close() would
  // dispatch the native `close` event into onClose, racing the unmount
  // under React StrictMode.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch {
        // showModal can throw InvalidStateError if already open in a
        // stale tree (StrictMode double-invoke) — best-effort.
      }
    }
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="dialog-box"
      aria-labelledby="about-title"
      onCancel={(e) => {
        // Prevent native cancel from also firing onClose via the close event.
        e.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onClick={(e) => {
        // Backdrop click: target is the dialog element itself, not children.
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <div className="dialog-header">
        <h2 id="about-title">mdownreview</h2>
        <button className="dialog-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="dialog-body">
          <p className="dialog-version">
            Version {version || "…"}
            {isCanary && <span className="canary-badge">canary</span>}
          </p>
          <div className="dialog-channel-section">
            <label className="dialog-label" htmlFor="update-channel">Update channel</label>
            <select
              id="update-channel"
              className="dialog-channel-select"
              value={updateChannel}
              onChange={handleChannelChange}
            >
              <option value="stable">Stable</option>
              <option value="canary">Canary</option>
            </select>
            {updateChannel === "canary" && (
              <p className="dialog-channel-warning">
                ⚠ Canary builds are untested pre-releases from every main commit.
              </p>
            )}
          </div>
          <div className="dialog-log-section">
            <label className="dialog-label">Log file</label>
            <div className="dialog-log-path">
              <code>{logPath || "Loading…"}</code>
              <button className="comment-btn" onClick={handleCopy} disabled={!logPath}>
                {copied ? "Copied!" : "Copy path"}
              </button>
            </div>
          </div>
        </div>
    </dialog>
  );
}
