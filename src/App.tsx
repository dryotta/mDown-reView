import { useEffect, useCallback, useRef, useState } from "react";
import { useStore } from "@/store";
import { useShallow } from "zustand/shallow";
import { useUpdateActions, useUpdateProgress } from "@/lib/vm/use-update-actions";
import { useFileWatcher } from "@/hooks/useFileWatcher";
import { useDialogActions } from "@/hooks/useDialogActions";
import { useMenuListeners } from "@/hooks/useMenuListeners";
import { useLaunchArgsBootstrap } from "@/hooks/useLaunchArgsBootstrap";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { useApplyTheme } from "@/hooks/useApplyTheme";
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

  const menuCallbacks = { handleOpenFile, handleOpenFolder, toggleCommentsPane, setTheme, setAboutOpen, checkForUpdate };
  useMenuListeners(menuCallbacks);
  useGlobalShortcuts(menuCallbacks);
  useLaunchArgsBootstrap();

  // Apply theme class to <html> and listen for OS theme changes
  useApplyTheme(theme);

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
