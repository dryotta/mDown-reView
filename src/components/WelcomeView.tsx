import { useEffect, useState } from "react";
import { useStore } from "@/store";
import type { RecentItem } from "@/store";
import { checkPathExists } from "@/lib/tauri-commands";
import "@/styles/welcome-view.css";

interface WelcomeViewProps {
  onOpenFile: () => void;
  onOpenFolder: () => void;
}

export function WelcomeView({ onOpenFile, onOpenFolder }: WelcomeViewProps) {
  const recentItems = useStore((s) => s.recentItems);
  const openFile = useStore((s) => s.openFile);
  const setRoot = useStore((s) => s.setRoot);
  const addRecentItem = useStore((s) => s.addRecentItem);
  const [pathStatus, setPathStatus] = useState<
    Record<string, "file" | "dir" | "missing">
  >({});

  useEffect(() => {
    let cancelled = false;
    async function checkAll() {
      const results: Record<string, "file" | "dir" | "missing"> = {};
      await Promise.all(
        recentItems.map(async (item) => {
          try {
            results[item.path] = await checkPathExists(item.path);
          } catch {
            results[item.path] = "missing";
          }
        }),
      );
      if (!cancelled) setPathStatus(results);
    }
    if (recentItems.length > 0) checkAll();
    return () => {
      cancelled = true;
    };
  }, [recentItems]);

  const isMac = navigator.platform.toUpperCase().includes("MAC");
  const mod = isMac ? "⌘" : "Ctrl";

  const handleRecentClick = (item: RecentItem) => {
    const status = pathStatus[item.path];
    if (status === "missing") return;
    if (item.type === "folder") {
      setRoot(item.path);
      addRecentItem(item.path, "folder");
    } else {
      openFile(item.path);
      addRecentItem(item.path, "file");
    }
  };

  function getFileName(path: string): string {
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1] || path;
  }

  function getParentPath(path: string): string {
    const parts = path.split(/[/\\]/);
    parts.pop();
    return parts.join(path.includes("/") ? "/" : "\\");
  }

  return (
    <div className="welcome-view">
      <div className="welcome-content">
        <div className="welcome-logo">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="48" height="48" aria-hidden="true">
            <rect width="100" height="100" rx="20" fill="#18181b"/>
            <rect x="1.5" y="1.5" width="97" height="97" rx="18.5" fill="none" stroke="#6366f1" strokeWidth="3"/>
            <text x="50" y="70" textAnchor="middle" fontFamily="'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace" fontSize="62" fontWeight="700" fill="#6366f1">m</text>
          </svg>
        </div>
        <h1 className="welcome-title">
          <span className="logo-m">m</span>down<span className="logo-re">re</span>view
        </h1>

        <div className="welcome-actions">
          <button className="welcome-action" onClick={onOpenFile}>
            <span className="welcome-action-icon">📄</span>
            <span className="welcome-action-label">Open File</span>
            <kbd className="welcome-kbd">{mod}+O</kbd>
          </button>
          <button className="welcome-action" onClick={onOpenFolder}>
            <span className="welcome-action-icon">📁</span>
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
                        {item.type === "folder" ? "📁" : "📄"}
                      </span>
                      <span className="welcome-recent-path">
                        <strong>{getFileName(item.path)}</strong>
                        <span className="welcome-recent-parent">
                          {getParentPath(item.path)}
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
    </div>
  );
}
