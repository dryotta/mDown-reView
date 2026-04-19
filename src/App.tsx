import { useEffect, useCallback, useRef, useState } from "react";
import { useStore, openFilesFromArgs } from "@/store";
import { getLaunchArgs } from "@/lib/tauri-commands";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderTree } from "@/components/FolderTree/FolderTree";
import { TabBar } from "@/components/TabBar/TabBar";
import { ViewerRouter } from "@/components/viewers/ViewerRouter";
import { CommentsPanel } from "@/components/comments/CommentsPanel";
import { AboutDialog } from "@/components/AboutDialog";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { UpdateBanner } from "@/components/UpdateBanner";
import type { Update } from "@tauri-apps/plugin-updater";
import "@/styles/app.css";

type Theme = "system" | "light" | "dark";
const THEME_CYCLE: Theme[] = ["system", "light", "dark"];

export default function App() {
  const {
    theme,
    setTheme,
    folderPaneWidth,
    setFolderPaneWidth,
    folderPaneVisible,
    toggleFolderPane,
    commentsPaneVisible,
    toggleCommentsPane,
    activeTabPath,
    openFile,
    setRoot,
  } = useStore();

  const [aboutOpen, setAboutOpen] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // Apply theme class to <html>
  useEffect(() => {
    const html = document.documentElement;
    if (theme === "system") {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      html.setAttribute("data-theme", prefersDark ? "dark" : "light");
    } else {
      html.setAttribute("data-theme", theme);
    }
  }, [theme]);

  // Load CLI launch args on mount and subscribe to second-instance args
  useEffect(() => {
    const store = useStore.getState();
    getLaunchArgs()
      .then(({ files, folders }) => openFilesFromArgs(files, folders, store))
      .catch(() => {});

    let unlisten: (() => void) | null = null;
    listen<{ files: string[]; folders: string[] }>("args-received", (event) => {
      const store = useStore.getState();
      openFilesFromArgs(event.payload.files, event.payload.folders, store);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "b") {
        e.preventDefault();
        toggleFolderPane();
      }
      if (mod && e.shiftKey && e.key === "C") {
        e.preventDefault();
        toggleCommentsPane();
      }
      // Tab cycling
      if (mod && !e.shiftKey && e.key === "Tab") {
        e.preventDefault();
        const { tabs, activeTabPath, setActiveTab } = useStore.getState();
        if (tabs.length < 2) return;
        const idx = tabs.findIndex((t) => t.path === activeTabPath);
        const next = tabs[(idx + 1) % tabs.length];
        setActiveTab(next.path);
      }
      if (mod && e.shiftKey && e.key === "Tab") {
        e.preventDefault();
        const { tabs, activeTabPath, setActiveTab } = useStore.getState();
        if (tabs.length < 2) return;
        const idx = tabs.findIndex((t) => t.path === activeTabPath);
        const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
        setActiveTab(prev.path);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleFolderPane, toggleCommentsPane]);

  // Background update check — 5 s delay, non-blocking
  useEffect(() => {
    const t = setTimeout(async () => {
      const { setUpdateStatus, setUpdateVersion } = useStore.getState();
      try {
        setUpdateStatus("checking");
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (update) {
          setPendingUpdate(update);
          setUpdateVersion(update.version);
          setUpdateStatus("available");
        } else {
          setUpdateStatus("idle");
        }
      } catch {
        setUpdateStatus("idle");
      }
    }, 5000);
    return () => clearTimeout(t);
  }, []);

  const cycleTheme = useCallback(() => {
    const idx = THEME_CYCLE.indexOf(theme);
    setTheme(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]);
  }, [theme, setTheme]);

  const handleOpenFile = useCallback(async () => {
    const selected = await open({ directory: false, multiple: true });
    if (Array.isArray(selected)) {
      for (const f of selected) openFile(f);
    } else if (typeof selected === "string") {
      openFile(selected);
    }
  }, [openFile]);

  const handleOpenFolder = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setRoot(selected);
    }
  }, [setRoot]);

  // Drag handle for resizing folder pane
  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startWidth: folderPaneWidth };
      const onMove = (e: MouseEvent) => {
        if (!dragRef.current) return;
        const delta = e.clientX - dragRef.current.startX;
        const newWidth = Math.max(160, Math.min(window.innerWidth * 0.5, dragRef.current.startWidth + delta));
        setFolderPaneWidth(newWidth);
      };
      const onUp = () => {
        dragRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [folderPaneWidth, setFolderPaneWidth]
  );

  return (
    <div className="app-layout">
      <div className="toolbar">
        <span className="app-title">mDown reView</span>
        <div className="toolbar-actions">
          <button className="toolbar-btn" onClick={handleOpenFile} title="Open file(s)">Open File</button>
          <button className="toolbar-btn" onClick={handleOpenFolder} title="Open folder">Open Folder</button>
          <span className="toolbar-separator" />
          <button
            className={`toolbar-btn toolbar-btn-toggle${folderPaneVisible ? " active" : ""}`}
            onClick={toggleFolderPane}
            title="Toggle folder pane (Ctrl+B)"
          >
            Folders
          </button>
          <button
            className={`toolbar-btn toolbar-btn-toggle${commentsPaneVisible ? " active" : ""}`}
            onClick={toggleCommentsPane}
            title="Toggle comments pane (Ctrl+Shift+C)"
          >
            Comments
          </button>
          <span className="toolbar-separator" />
          <button className="toolbar-btn" onClick={() => setAboutOpen(true)}>About</button>
          <button className="toolbar-btn" onClick={cycleTheme}>
            {theme === "system" ? "System" : theme === "light" ? "Light" : "Dark"}
          </button>
        </div>
      </div>

      <UpdateBanner update={pendingUpdate} />

      <div className="main-area">
        {folderPaneVisible && (
          <>
            <ErrorBoundary>
              <FolderTree onFileOpen={openFile} />
            </ErrorBoundary>
            <div className="drag-handle" onMouseDown={onDragStart} />
          </>
        )}

        <div className="viewer-area">
          <TabBar />
          <ErrorBoundary>
            {activeTabPath ? (
              <ViewerRouter path={activeTabPath} />
            ) : (
              <div className="empty-state">
                <p>Open a folder to get started</p>
              </div>
            )}
          </ErrorBoundary>
        </div>

        {commentsPaneVisible && activeTabPath && (
          <ErrorBoundary>
            <CommentsPanel filePath={activeTabPath} />
          </ErrorBoundary>
        )}
      </div>

      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </div>
  );
}
