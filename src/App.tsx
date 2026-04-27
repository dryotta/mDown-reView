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
import { useCommentActions } from "@/lib/vm/use-comment-actions";
import { FolderTree } from "@/components/FolderTree/FolderTree";
import { TabBar } from "@/components/TabBar/TabBar";
import { StatusBar } from "@/components/StatusBar/StatusBar";
import { ViewerRouter } from "@/components/viewers/ViewerRouter";
import { CommentsPanel } from "@/components/comments/CommentsPanel";
import { AboutDialog } from "@/components/AboutDialog";
import { SettingsDialog } from "@/components/SettingsDialog";
import { SettingsView } from "@/components/SettingsView";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { UpdateBanner } from "@/components/UpdateBanner";
import { WelcomeView } from "@/components/WelcomeView";
import { getFileCategory } from "@/lib/file-types";
import { basename } from "@/lib/path-utils";
import { IconFile, IconFolder, IconComment, IconSettings } from "@/components/Icons";
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
  const isMoveAnchorMode = useStore((s) => s.moveAnchorTarget !== null);
  const { checkForUpdate } = useUpdateActions();
  useUpdateProgress();

  // Update document.title to reflect the active file (#127 MDR-DEFAULT-DOC-TITLE)
  useEffect(() => {
    document.title = activeTabPath
      ? `${basename(activeTabPath)} — mdownreview`
      : "mdownreview";
  }, [activeTabPath]);

  const [aboutOpen, setAboutOpen] = useState(false);
  // Settings surface (issue #116): the inline page (`<SettingsView/>`) is
  // gated by a discriminated-union `settingsSurface` ('closed' | 'inline'),
  // while the author/preferences dialog launched FROM INSIDE that page is a
  // separate boolean (`authorDialogOpen`). They are intentionally
  // independent — the dialog layers OVER the inline page, so opening it
  // must not unmount SettingsView. Each mount site has its own gate
  // identifier, satisfying lint rule `local/no-shared-boolean-mount`.
  // See docs/architecture.md rules 16 & 28.
  const settingsSurface = useStore((s) => s.settingsSurface);
  const authorDialogOpen = useStore((s) => s.authorDialogOpen);
  const dragRef= useRef<{ startX: number; startWidth: number } | null>(null);

  const { handleOpenFile, handleOpenFolder } = useDialogActions();

  // F1 — register the VM resolveFocusedThread handler with the store so
  // the `R` keyboard shortcut can route through `update_comment` (the
  // single mutation chokepoint) without the slice importing IPC mutations.
  const { resolveFocusedThread } = useCommentActions();
  const setResolveFocusedThreadHandler = useStore((s) => s.setResolveFocusedThreadHandler);
  useEffect(() => {
    setResolveFocusedThreadHandler(resolveFocusedThread);
    return () => setResolveFocusedThreadHandler(null);
  }, [resolveFocusedThread, setResolveFocusedThreadHandler]);

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
            onClick={() => useStore.getState().openSettings()}
            title="Settings"
            aria-label="Settings"
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
            {settingsSurface === "inline" ? (
              <SettingsView />
            ) : activeTabPath ? (
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
      {/* Author/preferences dialog. Reachable from the SettingsView footer
          link; layers OVER the inline page (rule 28: each mount site has
          its own gate identifier). */}
      {authorDialogOpen && <SettingsDialog onClose={() => useStore.getState().closeAuthorDialog()} />}
    </div>
  );
}
