import { useEffect, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getAppVersion, getLogPath, checkUpdate } from "@/lib/tauri-commands";
import { useStore, type UpdateChannel } from "@/store";
import { useShallow } from "zustand/shallow";
import "@/styles/about-dialog.css";

interface Props {
  onClose: () => void;
}

export function AboutDialog({ onClose }: Props) {
  const [version, setVersion] = useState<string>("");
  const [logPath, setLogPath] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const { updateChannel, setUpdateChannel } = useStore(
    useShallow((s) => ({
      updateChannel: s.updateChannel,
      setUpdateChannel: s.setUpdateChannel,
    }))
  );

  useEffect(() => {
    getAppVersion()
      .then((v) => setVersion(v))
      .catch(() => setVersion("unknown"));
    getLogPath()
      .then((path) => setLogPath(path))
      .catch(() => setLogPath("Unavailable"));
  }, []);

  const handleCopy = async () => {
    await writeText(logPath);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleChannelChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const channel = e.target.value as UpdateChannel;
    setUpdateChannel(channel);
    const { setUpdateStatus, setUpdateVersion } = useStore.getState();
    try {
      setUpdateStatus("checking");
      const info = await checkUpdate(channel);
      if (info) {
        setUpdateVersion(info.version);
        setUpdateStatus("available");
      } else {
        setUpdateStatus("idle");
      }
    } catch {
      setUpdateStatus("idle");
    }
  };

  const isCanary = version.includes("-canary");

  return (
    <div className="dialog-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>mdownreview</h2>
          <button className="dialog-close" onClick={onClose}>×</button>
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
      </div>
    </div>
  );
}
