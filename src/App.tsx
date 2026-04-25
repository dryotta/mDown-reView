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
import { useOnboardingBootstrap } from "@/hooks/useOnboardingBootstrap";
import { useAuthor } from "@/lib/vm/useAuthor";
import { FirstRunPanel } from "@/components/onboarding/FirstRunPanel";
import { SetupPanel } from "@/components/onboarding/SetupPanel";
import { FolderTree } from "@/components/FolderTree/FolderTree";
import { TabBar } from "@/components/TabBar/TabBar";
import { StatusBar } from "@/components/StatusBar/StatusBar";
import { ViewerRouter } from "@/components/viewers/ViewerRouter";
import { CommentsPanel } from "@/components/comments/CommentsPanel";
import { AboutDialog } from "@/components/AboutDialog";
import { SettingsDialog } from "@/components/SettingsDialog";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { UpdateBanner } from "@/components/UpdateBanner";
import { WelcomeView } from "@/components/WelcomeView";
import { getFileCategory } from "@/lib/file-types";
import { IconFile, IconFolder, IconComment, IconSettings } from "@/components/Icons";
import "@/styles/app.css";

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
  const isMoveAnchorMode = useStore((s) => s.moveAnchorTarget !== null);
  const { checkForUpdate } = useUpdateActions();
  useUpdateProgress();

  const [aboutOpen, setAboutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  // Onboarding: refresh status, maybe auto-show welcome, re-poll on focus
  useOnboardingBootstrap();

  // Hydrate the persisted display name from disk so new comments get the
  // OS-user fallback even before the user opens Settings (AC #71/F7).
  useAuthor();

  // Background update check — 5 s delay, non-blocking
  useEffect(() => {
    const t = setTimeout(() => { checkForUpdate(); }, 5000);
    return () => clearTimeout(t);
  }, [checkForUpdate]);

  // Move-anchor mode: toggle a body class so global CSS can swap the cursor
  // for every element under <body> while the user picks a target line.
  useEffect(() => {
    document.body.classList.toggle("mode-move-anchor", isMoveAnchorMode);
    return () => { document.body.classList.remove("mode-move-anchor"); };
  }, [isMoveAnchorMode]);

  // Move-anchor mode: global Esc cancels. Capture phase so it wins over
  // any per-component keydown handler. Read the current value via getState()
  // (rule 9) so the listener doesn't need to re-bind on every state change.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && useStore.getState().moveAnchorTarget !== null) {
        useStore.getState().setMoveAnchorTarget(null);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

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
      {isMoveAnchorMode && (
        <div className="move-anchor-banner" role="status" aria-live="polite" data-testid="move-anchor-banner">
          Click a line to move the comment.{" "}
          <button onClick={() => useStore.getState().setMoveAnchorTarget(null)}>Cancel</button>
        </div>
      )}
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
          <button
            className="toolbar-btn"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Open settings"
          >
            <IconSettings /> Settings
          </button>
        </div>
        <ErrorBoundary>
          <TabBar />
        </ErrorBoundary>
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

      <ErrorBoundary>
        <StatusBar />
      </ErrorBoundary>

      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      <FirstRunPanel />
      <SetupPanel />
    </div>
  );
}
