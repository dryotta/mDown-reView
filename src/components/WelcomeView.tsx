import { useStore } from "@/store";
import type { RecentItem } from "@/store";
import { useRecentItemStatus } from "@/hooks/useRecentItemStatus";
import { basename, dirname } from "@/lib/path-utils";
import { IconFile, IconFolder } from "@/components/Icons";
import "@/styles/welcome-view.css";

interface WelcomeViewProps {
  onOpenFile: () => void;
  onOpenFolder: () => void;
}

export function WelcomeView({ onOpenFile, onOpenFolder }: WelcomeViewProps) {
  const recentItems = useStore((s) => s.recentItems);
  const openSettings = useStore((s) => s.openSettings);
  const openFolderPath = useStore((s) => s.openFolderPath);
  const openFilePath = useStore((s) => s.openFilePath);
  const pathStatus = useRecentItemStatus(recentItems);

  const isMac = navigator.platform.toUpperCase().includes("MAC");
  const mod = isMac ? "⌘" : "Ctrl";

  // Recent-item clicks delegate to the workspace slice's single
  // canonical entry points (`openFolderPath` / `openFilePath`) — same
  // entry points the toolbar dialog flow uses (rule 16: cross-slice
  // user actions group into one store action). The folder branch is
  // why bug 2 happened pre-fix: WelcomeView used to inline its own
  // register-then-setRoot sequence and drift from the toolbar.
  const handleRecentClick = (item: RecentItem) => {
    if (pathStatus[item.path] === "missing") return;
    if (item.type === "folder") {
      void openFolderPath(item.path);
    } else {
      openFilePath(item.path);
    }
  };

  return (
    <div className="welcome-view">
      <div className="welcome-content">
        <div className="welcome-logo">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="48" height="48" aria-hidden="true">
            <rect width="100" height="100" rx="20" fill="#18181b"/>
            <rect x="1.5" y="1.5" width="97" height="97" rx="18.5" fill="none" stroke="currentColor" strokeWidth="3"/>
            <text x="50" y="70" textAnchor="middle" fontFamily="monospace" fontSize="62" fontWeight="700" fill="currentColor">m</text>
          </svg>
        </div>
        <h1 className="welcome-title">
          <span className="logo-m">m</span>down<span className="logo-re">re</span>view
        </h1>

        <div className="welcome-actions">
          <button className="welcome-action" onClick={onOpenFile}>
            <span className="welcome-action-icon"><IconFile /></span>
            <span className="welcome-action-label">Open File</span>
            <kbd className="welcome-kbd">{mod}+O</kbd>
          </button>
          <button className="welcome-action" onClick={onOpenFolder}>
            <span className="welcome-action-icon"><IconFolder /></span>
            <span className="welcome-action-label">Open Folder</span>
            <kbd className="welcome-kbd">{mod}+Shift+O</kbd>
          </button>
        </div>

        {recentItems.length > 0 && (
          <div className="welcome-recent">
            <h2 className="welcome-recent-title">Recent</h2>
            <ul className="welcome-recent-list">
              {recentItems.map((item) => {
                const isMissing = pathStatus[item.path] === "missing";
                return (
                  <li key={item.path}>
                    <button
                      className={`welcome-recent-item${isMissing ? " welcome-recent-item--missing" : ""}`}
                      onClick={() => handleRecentClick(item)}
                      disabled={isMissing}
                      title={item.path}
                    >
                      <span className="welcome-recent-icon">
                        {item.type === "folder" ? <IconFolder /> : <IconFile />}
                      </span>
                      <span className="welcome-recent-path">
                        <strong>{basename(item.path)}</strong>
                        <span className="welcome-recent-parent">
                          {dirname(item.path)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* Anchored bottom-right of the welcome surface so the centered
          content above stays vertically balanced regardless of recents. */}
      <button
        type="button"
        className="welcome-settings-link"
        onClick={openSettings}
      >
        Set up CLI, file associations, and agent integration → Settings
      </button>
    </div>
  );
}
