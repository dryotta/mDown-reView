import { useState } from "react";
import { restartApp } from "@/lib/tauri-commands";
import { useUpdateActions } from "@/lib/vm/use-update-actions";
import { warn } from "@/logger";
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
  // `failedVersion` records the update version whose `restartApp()`
  // rejected. The banner is mounted for the entire app lifetime (see
  // App.tsx — not conditionally rendered), so a naive boolean would
  // sticky-stick across `ready -> dismiss -> idle -> (new) ready`
  // cycles. Keying off the version makes the fallback derived state:
  // a new version automatically resets it without a cascading
  // `useEffect`. Rejection is recorded against the version that
  // failed so a re-try of the SAME version (which would hit the same
  // unrouted IPC) keeps the fallback in place.
  const [failedVersion, setFailedVersion] = useState<string | null>(null);
  const restartFailed = failedVersion !== null && failedVersion === updateVersion;

  if (updateStatus === "idle" || updateStatus === "checking" || updateStatus === "error") {
    return null;
  }

  const handleInstall = async () => {
    await install();
  };

  const handleRestart = async () => {
    try {
      await restartApp();
    } catch (e) {
      // Log + surface — never silently swallow. The new bundle is on disk
      // either way, so a manual relaunch will pick it up. Recording the
      // version (rather than a bare boolean) is what makes the fallback
      // self-heal across multiple update cycles in one session.
      void warn(`UpdateBanner: restartApp failed — ${String(e)}`);
      setFailedVersion(updateVersion);
    }
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
      {updateStatus === "ready" && !restartFailed && (
        <>
          <span>Restart to apply update</span>
          <button className="update-banner-btn" onClick={handleRestart}>Restart Now</button>
          <button className="update-banner-dismiss" onClick={dismissUpdate} aria-label="Dismiss update">✕</button>
        </>
      )}
      {updateStatus === "ready" && restartFailed && (
        <>
          <span data-testid="update-banner-fallback">
            Update installed — quit and reopen mdownreview from your installed location to apply.
          </span>
          <button className="update-banner-dismiss" onClick={dismissUpdate} aria-label="Dismiss update">✕</button>
        </>
      )}
    </div>
  );
}
