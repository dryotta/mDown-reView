import { useEffect, useCallback, useRef, useState } from "react";
import { useStore, openFilesFromArgs } from "@/store";
import { useShallow } from "zustand/shallow";
import { getLaunchArgs } from "@/lib/tauri-commands";
import { useUpdateActions, useUpdateProgress } from "@/lib/vm/use-update-actions";
import { listen } from "@tauri-apps/api/event";
import { useFileWatcher } from "@/hooks/useFileWatcher";
import { useDialogActions } from "@/hooks/useDialogActions";
import { useMenuListeners } from "@/hooks/useMenuListeners";
import { FolderTree } from "@/components/FolderTree/FolderTree";
import { TabBar } from "@/components/TabBar/TabBar";
import { ViewerRouter } from "@/components/viewers/ViewerRouter";
import { CommentsPanel } from "@/components/comments/CommentsPanel";
import { AboutDialog } from "@/components/AboutDialog";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { UpdateBanner } from "@/components/UpdateBanner";
import { WelcomeView } from "@/components/WelcomeView";
import { getFileCategory } from "@/lib/file-types";
import "@/styles/app.css";

type Theme = "system" | "light" | "dark";
const THEME_CYCLE: Theme[] = ["system", "light", "dark"];

/* ── Inline SVG toolbar icons (14×14, fill=currentColor) ──────────── */

import {
  IconFile,
  IconFolder,
  IconComment,
  IconSun,
  IconMoon,
  IconAuto,
  IconInfo,
} from "@/components/Icons";

const THEME_ICONS: Record<Theme, () => React.JSX.Element> = {
  light: IconSun,
  dark: IconMoon,
  system: IconAuto,
};

const THEME_LABELS: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

export default function App() {
  const {
    theme,
    root,
    folderPaneWidth,
    commentsPaneVisible,
    activeTabPath,
  } = useStore(
    useShallow((s) => ({
      theme: s.theme,
      root: s.root,
      folderPaneWidth: s.folderPaneWidth,
      commentsPaneVisible: s.commentsPaneVisible,
      activeTabPath: s.activeTabPath,
    }))
  );
  const setTheme = useStore((s) => s.setTheme);
  const setFolderPaneWidth = useStore((s) => s.setFolderPaneWidth);
  const toggleCommentsPane = useStore((s) => s.toggleCommentsPane);
  const openFile = useStore((s) => s.openFile);
  const { checkForUpdate } = useUpdateActions();
  useUpdateProgress();

  const [aboutOpen, setAboutOpen] = useState(false);
  const dragRef= useRef<{ startX: number; startWidth: number } | null>(null);

  const { handleOpenFile, handleOpenFolder } = useDialogActions();

  // Connect Rust file watcher to frontend event pipeline
  useFileWatcher();

  useMenuListeners({ handleOpenFile, handleOpenFolder, toggleCommentsPane, setTheme, setAboutOpen, checkForUpdate });

  // Apply theme class to <html> and listen for OS theme changes
  useEffect(() => {
    const html = document.documentElement;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");

    function applyTheme() {
      if (theme === "system") {
        html.setAttribute("data-theme", mq.matches ? "dark" : "light");
      } else {
        html.setAttribute("data-theme", theme);
      }
    }

    applyTheme();
    mq.addEventListener("change", applyTheme);
    return () => mq.removeEventListener("change", applyTheme);
  }, [theme]);

  // Load CLI launch args on mount and subscribe to second-instance args
  useEffect(() => {
    const store = useStore.getState();
    getLaunchArgs()
      .then(({ files, folders }) => openFilesFromArgs(files, folders, store))
      .catch(() => {});

    const argsListener = listen<{ files: string[]; folders: string[] }>("args-received", (event) => {
      const store = useStore.getState();
      openFilesFromArgs(event.payload.files, event.payload.folders, store);
    });

    return () => {
      argsListener.then((fn) => fn()).catch(() => {});
    };
  }, []);

  // Global keyboard shortcuts (kept for e2e tests and non-native environments)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && e.key === "o") {
        e.preventDefault();
        handleOpenFile();
      }
      if (mod && e.shiftKey && e.key === "O") {
        e.preventDefault();
        handleOpenFolder();
      }
      if (mod && e.shiftKey && e.key === "C") {
        e.preventDefault();
        toggleCommentsPane();
      }
      if (mod && !e.shiftKey && e.key === "w") {
        e.preventDefault();
        const { activeTabPath, closeTab } = useStore.getState();
        if (activeTabPath) closeTab(activeTabPath);
      }
      if (mod && e.shiftKey && e.key === "W") {
        e.preventDefault();
        useStore.getState().closeAllTabs();
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
  }, [handleOpenFile, handleOpenFolder, toggleCommentsPane]);

  // Background update check — 5 s delay, non-blocking
  useEffect(() => {
    const t = setTimeout(() => { checkForUpdate(); }, 5000);
    return () => clearTimeout(t);
  }, [checkForUpdate]);

  const cycleTheme = useCallback(() => {
    const idx = THEME_CYCLE.indexOf(theme);
    setTheme(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]);
  }, [theme, setTheme]);

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

  const ThemeIcon = THEME_ICONS[theme];

  return (
    <div className="app-layout">
      <ErrorBoundary>
      <div className="toolbar">
        <div className="toolbar-btn-group">
          <button className="toolbar-btn" onClick={handleOpenFile} title="Open file(s)">
            <IconFile /> Open File
          </button>
          <button className="toolbar-btn" onClick={handleOpenFolder} title="Open folder">
            <IconFolder /> Open Folder
          </button>
          <button
            className={`toolbar-btn toolbar-btn-toggle${commentsPaneVisible ? " active" : ""}`}
            onClick={toggleCommentsPane}
            title="Toggle comments pane (Ctrl+Shift+C)"
          >
            <IconComment /> Comments
          </button>
        </div>
        <div className="toolbar-actions">
          <button className="toolbar-btn toolbar-btn-utility" onClick={cycleTheme}>
            <ThemeIcon /> {THEME_LABELS[theme]}
          </button>
          <button className="toolbar-btn toolbar-btn-utility" onClick={() => setAboutOpen(true)}>
            <IconInfo /> About
          </button>
        </div>
      </div>

      <UpdateBanner />
      </ErrorBoundary>

      <div className="main-area">
        <div
          className={`folder-pane-wrapper${root === null ? " folder-pane-hidden" : ""}`}
          style={{ "--folder-pane-width": `${folderPaneWidth}px` } as React.CSSProperties}
        >
          {root !== null && (
            <>
              <ErrorBoundary>
                <FolderTree onFileOpen={openFile} onCloseFolder={() => useStore.getState().closeFolder()} />
              </ErrorBoundary>
              <div className="drag-handle" onMouseDown={onDragStart} />
            </>
          )}
        </div>

        <div className="viewer-area">
          <TabBar />
          <ErrorBoundary>
            {activeTabPath ? (
              <ViewerRouter path={activeTabPath} />
            ) : (
              <WelcomeView onOpenFile={handleOpenFile} onOpenFolder={handleOpenFolder} />
            )}
          </ErrorBoundary>
        </div>

        {commentsPaneVisible && activeTabPath && getFileCategory(activeTabPath) !== "image" && (
          <ErrorBoundary>
            <CommentsPanel filePath={activeTabPath} />
          </ErrorBoundary>
        )}
      </div>

      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </div>
  );
}
