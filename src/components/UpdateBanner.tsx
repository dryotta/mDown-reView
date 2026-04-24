import { useUpdateActions } from "@/lib/vm/use-update-actions";
import { useUpdateState } from "@/store";
import "@/styles/update-banner.css";

export function UpdateBanner() {
  const {
    updateStatus,
    updateVersion,
    updateProgress,
    dismissUpdate,
  } = useUpdateState();
  const { install } = useUpdateActions();

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
