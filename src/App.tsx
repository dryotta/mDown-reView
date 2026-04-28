import { useEffect, useCallback, useRef, useState } from "react";
import { useStore } from "@/store";
import { useShallow } from "zustand/shallow";
import { useUpdateActions, useUpdateProgress } from "@/lib/vm/use-update-actions";
import { useFileWatcher } from "@/hooks/useFileWatcher";
import { useDialogActions } from "@/hooks/useDialogActions";
import { useMenuListeners } from "@/hooks/useMenuListeners";
import { useLaunchArgsBootstrap } from "@/hooks/useLaunchArgsBootstrap";
import { useOpenFileTab } from "@/hooks/useOpenFileTab";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { useApplyTheme } from "@/hooks/useApplyTheme";
import { useOnboardingBootstrap } from "@/hooks/useOnboardingBootstrap";
import { useCrossWindowPrefsSync } from "@/hooks/useCrossWindowPrefsSync";
import { useAuthor } from "@/lib/vm/useAuthor";
import { FolderTree } from "@/components/FolderTree/FolderTree";
import { TabBar } from "@/components/TabBar/TabBar";
import { StatusBar } from "@/components/StatusBar/StatusBar";
import { ViewerRouter } from "@/components/viewers/ViewerRouter";
import { CommentsPanel } from "@/components/comments/CommentsPanel";
import { AboutDialog } from "@/components/AboutDialog";
import { SettingsView } from "@/components/SettingsView";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { UpdateBanner } from "@/components/UpdateBanner";
import { WelcomeView } from "@/components/WelcomeView";
import { getFileCategory } from "@/lib/file-types";
import { basename } from "@/lib/path-utils";
import { IconFile, IconFolder, IconComment } from "@/components/Icons";
import "@/styles/app.css";
import "@/styles/print.css";

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

  // Update document.title to reflect the active file (#127 MDR-DEFAULT-DOC-TITLE)
  useEffect(() => {
    document.title = activeTabPath
      ? `${basename(activeTabPath)} — mdownreview`
      : "mdownreview";
  }, [activeTabPath]);

  const [aboutOpen, setAboutOpen] = useState(false);
  const settingsDialogOpen = useStore((s) => s.settingsDialogOpen);
  const closeSettings = useStore((s) => s.closeSettings);
  const dragRef= useRef<{ startX: number; startWidth: number } | null>(null);

  const { handleOpenFile, handleOpenFolder } = useDialogActions();

  // F1 — Ctrl/Cmd+Shift+M: trigger the existing selection-toolbar add-
  // comment path. We dispatch a real bubbling `mouseup` from the end of
  // the current selection so the viewer's existing onMouseUp handler
  // (registered via React event delegation) pops the SelectionToolbar
  // exactly as a mouse interaction would, then auto-click the toolbar's
  // "Comment" button on the next frame to open the CommentInput.
  // No-op when there is no usable selection.
  const startCommentOnSelection = useCallback(() => {
    if (typeof window === "undefined") return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
    const range = sel.getRangeAt(0);
    const target =
      (range.endContainer.nodeType === Node.ELEMENT_NODE
        ? (range.endContainer as Element)
        : range.endContainer.parentElement) ?? document.body;
    target.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true }),
    );
    requestAnimationFrame(() => {
      const btn = document.querySelector(
        ".selection-toolbar-btn",
      ) as HTMLButtonElement | null;
      btn?.click();
    });
  }, []);

  // F1 — Esc: handled per-input by CommentInput's own keydown handler;
  // no global plumb-through is needed.

  // Connect Rust file watcher to frontend event pipeline
  useFileWatcher();

  const menuCallbacks = {
    handleOpenFile,
    handleOpenFolder,
    toggleCommentsPane,
    setTheme,
    setAboutOpen,
    checkForUpdate,
    startCommentOnSelection,
  };
  useMenuListeners(menuCallbacks);
  useGlobalShortcuts(menuCallbacks);
  useLaunchArgsBootstrap();
  useOpenFileTab();

  // Apply theme class to <html> and listen for OS theme changes
  useApplyTheme(theme);

  // Onboarding: refresh status, maybe auto-show welcome, re-poll on focus
  useOnboardingBootstrap();

  // Sync global prefs (theme, author, recents…) across open windows
  useCrossWindowPrefsSync();

  // Hydrate the persisted display name from disk so new comments get the
  // OS-user fallback even before the user opens Settings (AC #71/F7).
  useAuthor();

  // Background update check — 5 s delay, non-blocking
  useEffect(() => {
    const t = setTimeout(() => { checkForUpdate(); }, 5000);
    return () => clearTimeout(t);
  }, [checkForUpdate]);


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
      {settingsDialogOpen && <SettingsView onClose={closeSettings} />}
    </div>
  );
}
