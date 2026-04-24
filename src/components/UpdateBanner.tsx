import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useUpdateActions } from "@/lib/vm/use-update-actions";
import { useUpdateState } from "@/store";
import "@/styles/update-banner.css";

interface ProgressPayload {
  event: "Started" | "Progress" | "Finished";
  content_length: number | null;
  chunk_length: number;
}

export function UpdateBanner() {
  const {
    updateStatus,
    updateVersion,
    updateProgress,
    setUpdateStatus,
    setUpdateProgress,
    dismissUpdate,
  } = useUpdateState();
  const { install } = useUpdateActions();

  // Listen for progress events from Rust install_update command
  useEffect(() => {
    let downloaded = 0;
    let total = 0;
    const unlisten = listen<ProgressPayload>("update-progress", (event) => {
      const { payload } = event;
      if (payload.event === "Started") {
        total = payload.content_length ?? 0;
      } else if (payload.event === "Progress") {
        downloaded += payload.chunk_length;
        if (total > 0) setUpdateProgress(Math.min(Math.round((downloaded / total) * 100), 100));
      } else if (payload.event === "Finished") {
        setUpdateStatus("ready");
      }
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [setUpdateProgress, setUpdateStatus]);

  if (updateStatus === "idle" || updateStatus === "checking" || updateStatus === "error") {
    return null;
  }

  const handleInstall = async () => {
    await install();
  };

  const handleRestart = async () => {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  };

  return (
    <div className="update-banner" role="status">
      {updateStatus === "available" && (
        <>
          <span>v{updateVersion} available</span>
          <button className="update-banner-btn" onClick={handleInstall}>Install</button>
          <button className="update-banner-dismiss" onClick={dismissUpdate} aria-label="Dismiss update">✕</button>
        </>
      )}
      {updateStatus === "downloading" && (
        <>
          <span>Downloading update… {updateProgress}%</span>
          <progress className="update-banner-progress" value={updateProgress} max={100} />
        </>
      )}
      {updateStatus === "ready" && (
        <>
          <span>Restart to apply update</span>
          <button className="update-banner-btn" onClick={handleRestart}>Restart Now</button>
          <button className="update-banner-dismiss" onClick={dismissUpdate} aria-label="Dismiss update">✕</button>
        </>
      )}
    </div>
  );
}
