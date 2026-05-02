import { useEffect, useCallback, useState } from "react";
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
import { useCloseGuard } from "@/hooks/useCloseGuard";
import { useAuthor } from "@/lib/vm/useAuthor";
import { FolderTree } from "@/components/FolderTree/FolderTree";
import { TabBar } from "@/components/TabBar/TabBar";
import { StatusBar } from "@/components/StatusBar/StatusBar";
import { ViewerRouter } from "@/components/viewers/ViewerRouter";
import { CommentsPanel } from "@/components/comments/CommentsPanel";
import { MermaidPopout } from "@/components/viewers/mermaid/MermaidPopout";
import { AboutDialog } from "@/components/AboutDialog";
import { SettingsView } from "@/components/SettingsView";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { FolderPaneShell } from "@/components/FolderPaneShell";
import { UpdateBanner } from "@/components/UpdateBanner";
import { WelcomeView } from "@/components/WelcomeView";
import { basename } from "@/lib/path-utils";
import { isSidecarFile } from "@/lib/file-types";
import { IconFile, IconFolder, IconComment, IconSave } from "@/components/Icons";
import "@/styles/app.css";
import "@/styles/print.css";
import { recordStartupPhase, unregisterWindowFolder } from "@/lib/tauri-commands";
import { getFileCategory } from "@/lib/file-types";
import { useRenderCount } from "@/hooks/dev/useRenderCount";

export default function App() {
  useRenderCount("App");
  const { theme, root, commentsPaneVisible, activeTabPath } = useStore(
    useShallow((s) => ({
      theme: s.theme,
      root: s.root,
      commentsPaneVisible: s.commentsPaneVisible,
      activeTabPath: s.activeTabPath,
    }))
  );
  const setTheme = useStore((s) => s.setTheme);
  const toggleCommentsPane = useStore((s) => s.toggleCommentsPane);
  const openFile = useStore((s) => s.openFile);
  const closeMermaidPopout = useStore((s) => s.closeMermaidPopout);
  const { checkForUpdate } = useUpdateActions();
  useUpdateProgress();

  // Sidecars (.review.yaml/.review.json) are app-managed metadata; the UI
  // hides the comments pane and disables every "add comment" affordance
  // while a sidecar is the active tab so users cannot create stray
  // comment threads on a comment-storage file.
  const activeIsSidecar = activeTabPath !== null && isSidecarFile(activeTabPath);

  // Issue #352 / iter-5 user-reported — Save button moved from the
  // per-viewer toolbar to the top app toolbar. Visible only when the
  // active tab is an editable Excalidraw file in editor mode; enabled
  // only when the tab has unsaved changes. Reads narrow primitives so
  // unrelated tab mutations don't re-render <App/>.
  const activeViewMode = useStore((s) =>
    activeTabPath ? s.viewModeByTab[activeTabPath] : undefined,
  );
  const activeIsDirty = useStore((s) =>
    activeTabPath ? s.excalidrawDirtyByTab[activeTabPath] === true : false,
  );
  const activeIsReadOnly = useStore((s) =>
    activeTabPath
      ? s.tabs.find((t) => t.path === activeTabPath)?.readOnly === true
      : false,
  );
  const activeIsExcalidrawEditable =
    activeTabPath !== null &&
    getFileCategory(activeTabPath) === "excalidraw" &&
    activeViewMode === "editor" &&
    !activeIsReadOnly;
  const handleAppToolbarSave = useCallback(() => {
    if (!activeTabPath) return;
    window.dispatchEvent(
      new CustomEvent("mdownreview:excalidraw-save-request", {
        detail: { path: activeTabPath },
      }),
    );
  }, [activeTabPath]);

  // Update document.title to reflect the active file and root folder
  useEffect(() => {
    const folderName = root ? basename(root) : null;
    if (activeTabPath) {
      const fileName = basename(activeTabPath);
      document.title = folderName
        ? `${fileName} — ${folderName} — mdownreview`
        : `${fileName} — mdownreview`;
    } else {
      document.title = folderName ? `${folderName} — mdownreview` : "mdownreview";
    }
  }, [activeTabPath, root]);

  // Issue #264 — runtime tracing: report `frontend-mounted` to Rust's
  // `StartupRecorder` once React's `App` finishes its first effect.
  // The Rust side dedupes per-phase per-process so StrictMode's
  // double-invoke is harmless. Errors are swallowed because telemetry
  // is non-essential — the user-visible app must keep working even if
  // the IPC fails (e.g. headless tests with no Tauri host).
  useEffect(() => {
    void recordStartupPhase("frontend-mounted").catch(() => {});
  }, []);

  const [aboutOpen, setAboutOpen] = useState(false);
  const settingsDialogOpen = useStore((s) => s.settingsDialogOpen);
  const closeSettings = useStore((s) => s.closeSettings);

  const { handleOpenFile, handleOpenFolder } = useDialogActions();

  // Per spec design decision 3: any top-toolbar button click closes the
  // mermaid popout. Close BEFORE opening the dialog so the close also
  // fires on dialog cancellation (no openFile/setRoot path will run).
  // toggleCommentsPane closes via the slice itself (see store/index.ts).
  const handleOpenFileClick = useCallback(() => {
    closeMermaidPopout();
    void handleOpenFile();
  }, [closeMermaidPopout, handleOpenFile]);
  const handleOpenFolderClick = useCallback(() => {
    closeMermaidPopout();
    void handleOpenFolder();
  }, [closeMermaidPopout, handleOpenFolder]);

  // Shared close-folder handler: resets store root AND unregisters from
  // the Rust WindowRegistry so the folder can be re-opened elsewhere.
  const handleCloseFolder = useCallback(() => {
    useStore.getState().closeFolder();
    unregisterWindowFolder().catch(() => {});
  }, []);

  // F1 — Ctrl/Cmd+Shift+M: trigger the existing selection-toolbar add-
  // comment path. We dispatch a real bubbling `mouseup` from the end of
  // the current selection so the viewer's existing onMouseUp handler
  // (registered via React event delegation) pops the SelectionToolbar
  // exactly as a mouse interaction would, then auto-click the toolbar's
  // "Comment" button on the next frame to open the CommentInput.
  // No-op when there is no usable selection or the active file is a
  // sidecar (sidecars are app-managed metadata — not commentable).
  const startCommentOnSelection = useCallback(() => {
    if (typeof window === "undefined") return;
    if (activeTabPath && isSidecarFile(activeTabPath)) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
    const range = sel.getRangeAt(0);
    const target =
      (range.endContainer.nodeType === Node.ELEMENT_NODE
        ? (range.endContainer as Element)
        : range.endContainer.parentElement) ?? document.body;
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    requestAnimationFrame(() => {
      const btn = document.querySelector(".selection-toolbar-btn") as HTMLButtonElement | null;
      btn?.click();
    });
  }, [activeTabPath]);

  // F1 — Esc: handled per-input by CommentInput's own keydown handler;
  // no global plumb-through is needed.

  // Connect Rust file watcher to frontend event pipeline
  useFileWatcher();

  const menuCallbacks = {
    handleOpenFile: handleOpenFileClick,
    handleOpenFolder: handleOpenFolderClick,
    toggleCommentsPane,
    setTheme,
    setAboutOpen,
    checkForUpdate,
    startCommentOnSelection,
  };
  useMenuListeners(menuCallbacks);
  useGlobalShortcuts(menuCallbacks);
  useCloseGuard();
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
    const t = setTimeout(() => {
      void checkForUpdate();
    }, 5000);
    return () => clearTimeout(t);
  }, [checkForUpdate]);

  return (
    <div className="app-layout">
      <ErrorBoundary>
        <div className="toolbar">
          <div className="toolbar-btn-group">
            <button className="toolbar-btn" onClick={handleOpenFileClick} title="Open file(s)">
              <IconFile /> Open File
            </button>
            <button className="toolbar-btn" onClick={handleOpenFolderClick} title="Open folder">
              <IconFolder /> Open Folder
            </button>
            {activeTabPath && (
              <button
                className={`toolbar-btn toolbar-btn-toggle${commentsPaneVisible && !activeIsSidecar ? " active" : ""}`}
                onClick={toggleCommentsPane}
                disabled={activeIsSidecar}
                title={
                  activeIsSidecar
                    ? "Comments are disabled on .review.yaml/.review.json sidecar files"
                    : "Toggle comments pane (Ctrl+Shift+C)"
                }
              >
                <IconComment /> Comments
              </button>
            )}
            {activeIsExcalidrawEditable && (
              <button
                className="toolbar-btn"
                onClick={handleAppToolbarSave}
                disabled={!activeIsDirty}
                title={
                  activeIsDirty
                    ? "Save (Ctrl+S)"
                    : "No unsaved changes"
                }
                aria-label="Save"
                data-testid="app-toolbar-save"
              >
                <IconSave /> Save
              </button>
            )}
          </div>
          <ErrorBoundary>
            <TabBar />
          </ErrorBoundary>
        </div>

        <UpdateBanner />
      </ErrorBoundary>

      <div className="main-area">
        <FolderPaneShell hideDragHandle={root === null}>
          {root !== null && (
            <ErrorBoundary>
              <FolderTree onFileOpen={openFile} onCloseFolder={handleCloseFolder} />
            </ErrorBoundary>
          )}
        </FolderPaneShell>

        <div className="viewer-area">
          <ErrorBoundary>
            {activeTabPath ? (
              <ViewerRouter path={activeTabPath} />
            ) : (
              <WelcomeView
                onOpenFile={handleOpenFile}
                onOpenFolder={handleOpenFolder}
              />
            )}
          </ErrorBoundary>
        </div>

        {commentsPaneVisible && activeTabPath && !activeIsSidecar && (
          <ErrorBoundary>
            <CommentsPanel filePath={activeTabPath} />
          </ErrorBoundary>
        )}

        <ErrorBoundary>
          <MermaidPopout />
        </ErrorBoundary>
      </div>

      <ErrorBoundary>
        <StatusBar />
      </ErrorBoundary>

      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      {settingsDialogOpen && <SettingsView onClose={closeSettings} />}
    </div>
  );
}
