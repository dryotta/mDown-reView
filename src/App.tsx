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
import { WelcomeView } from "@/components/WelcomeView";
import { getFileCategory } from "@/lib/file-types";
import type { Update } from "@tauri-apps/plugin-updater";
import "@/styles/app.css";

type Theme = "system" | "light" | "dark";
const THEME_CYCLE: Theme[] = ["system", "light", "dark"];

/* ── Inline SVG toolbar icons (14×14, fill=currentColor) ──────────── */

function IconFile() {
  return (
    <span className="toolbar-icon">
      <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
        <path d="M3.75 1.5A1.25 1.25 0 002.5 2.75v10.5c0 .69.56 1.25 1.25 1.25h8.5c.69 0 1.25-.56 1.25-1.25V5.5L9.5 1.5H3.75zM9 2l3.5 3.5H9.75a.75.75 0 01-.75-.75V2z" />
      </svg>
    </span>
  );
}

function IconFolder() {
  return (
    <span className="toolbar-icon">
      <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
        <path d="M1.75 2.5A1.25 1.25 0 00.5 3.75v8.5c0 .69.56 1.25 1.25 1.25h12.5c.69 0 1.25-.56 1.25-1.25V5.25c0-.69-.56-1.25-1.25-1.25H7.56L6.28 2.72A.75.75 0 005.75 2.5H1.75z" />
      </svg>
    </span>
  );
}

function IconComment() {
  return (
    <span className="toolbar-icon">
      <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
        <path d="M1 2.75A1.75 1.75 0 012.75 1h10.5A1.75 1.75 0 0115 2.75v7.5A1.75 1.75 0 0113.25 12H9.06l-2.9 2.47A.75.75 0 015 13.94V12H2.75A1.75 1.75 0 011 10.25v-7.5zM2.75 2.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25H5.5a.75.75 0 01.75.75v1.557l2.1-1.786a.75.75 0 01.488-.181h4.412a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25H2.75z" />
      </svg>
    </span>
  );
}

function IconSun() {
  return (
    <span className="toolbar-icon">
      <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 12a4 4 0 100-8 4 4 0 000 8zm0-1.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5zm5.657-8.157a.75.75 0 010 1.06l-1.061 1.06a.75.75 0 11-1.06-1.06l1.06-1.06a.75.75 0 011.06 0zM8 0a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0V.75A.75.75 0 018 0zM3.404 2.343a.75.75 0 011.06 0l1.061 1.06a.75.75 0 01-1.06 1.06l-1.06-1.06a.75.75 0 010-1.06zM16 8a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5A.75.75 0 0116 8zM.75 8.75a.75.75 0 010-1.5h1.5a.75.75 0 010 1.5H.75zm11.907 3.846a.75.75 0 010 1.06l-1.06 1.061a.75.75 0 01-1.06-1.06l1.06-1.06a.75.75 0 011.06 0zM8 16a.75.75 0 01-.75-.75v-1.5a.75.75 0 011.5 0v1.5A.75.75 0 018 16zm-4.596-2.343a.75.75 0 011.06 0l.061.06a.75.75 0 01-1.06 1.06l-.06-.06a.75.75 0 010-1.06z" />
      </svg>
    </span>
  );
}

function IconMoon() {
  return (
    <span className="toolbar-icon">
      <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
        <path d="M9.598 1.591a.75.75 0 01.785-.175 7 7 0 11-8.967 8.967.75.75 0 01.961-.96 5.5 5.5 0 007.046-7.046.75.75 0 01.175-.786zM7.846 3.06a7.002 7.002 0 01-4.786 4.786 5.5 5.5 0 006.94-6.94z" />
      </svg>
    </span>
  );
}

function IconAuto() {
  return (
    <span className="toolbar-icon">
      <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM2.5 8a5.5 5.5 0 015.5-5.5v11A5.5 5.5 0 012.5 8z" />
      </svg>
    </span>
  );
}

function IconInfo() {
  return (
    <span className="toolbar-icon">
      <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm6.5-.25A.75.75 0 017.25 7h1a.75.75 0 01.75.75v2.75h.25a.75.75 0 010 1.5h-2a.75.75 0 010-1.5h.25v-2h-.25a.75.75 0 01-.75-.75zM8 6a1 1 0 110-2 1 1 0 010 2z" />
      </svg>
    </span>
  );
}

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
    setTheme,
    root,
    folderPaneWidth,
    setFolderPaneWidth,
    commentsPaneVisible,
    toggleCommentsPane,
    activeTabPath,
    openFile,
    setRoot,
    addRecentItem,
  } = useStore();

  const [aboutOpen, setAboutOpen] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

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

  const handleOpenFile = useCallback(async () => {
    try {
      const selected = await open({ directory: false, multiple: true });
      if (Array.isArray(selected)) {
        for (const f of selected) {
          openFile(f);
          addRecentItem(f, "file");
        }
      } else if (typeof selected === "string") {
        openFile(selected);
        addRecentItem(selected, "file");
      }
    } catch {
      // User cancelled or dialog error — ignore
    }
  }, [openFile, addRecentItem]);

  const handleOpenFolder = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        setRoot(selected);
        addRecentItem(selected, "folder");
      }
    } catch {
      // User cancelled or dialog error — ignore
    }
  }, [setRoot, addRecentItem]);

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

  const triggerUpdateCheck = useCallback(async () => {
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
  }, []);

  // Background update check — 5 s delay, non-blocking
  useEffect(() => {
    const t = setTimeout(triggerUpdateCheck, 5000);
    return () => clearTimeout(t);
  }, [triggerUpdateCheck]);

  const cycleTheme = useCallback(() => {
    const idx = THEME_CYCLE.indexOf(theme);
    setTheme(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]);
  }, [theme, setTheme]);

  // Native menu event listeners
  useEffect(() => {
    const pending = [
      listen("menu-open-file", () => handleOpenFile()),
      listen("menu-open-folder", () => handleOpenFolder()),
      listen("menu-close-folder", () => useStore.getState().closeFolder()),
      listen("menu-toggle-comments-pane", () => toggleCommentsPane()),
      listen("menu-close-tab", () => {
        const { activeTabPath, closeTab } = useStore.getState();
        if (activeTabPath) closeTab(activeTabPath);
      }),
      listen("menu-close-all-tabs", () => useStore.getState().closeAllTabs()),
      listen("menu-next-tab", () => {
        const { tabs, activeTabPath, setActiveTab } = useStore.getState();
        if (tabs.length < 2) return;
        const idx = tabs.findIndex((t) => t.path === activeTabPath);
        setActiveTab(tabs[(idx + 1) % tabs.length].path);
      }),
      listen("menu-prev-tab", () => {
        const { tabs, activeTabPath, setActiveTab } = useStore.getState();
        if (tabs.length < 2) return;
        const idx = tabs.findIndex((t) => t.path === activeTabPath);
        setActiveTab(tabs[(idx - 1 + tabs.length) % tabs.length].path);
      }),
      listen("menu-theme-system", () => setTheme("system")),
      listen("menu-theme-light", () => setTheme("light")),
      listen("menu-theme-dark", () => setTheme("dark")),
      listen("menu-about", () => setAboutOpen(true)),
      listen("menu-check-updates", () => triggerUpdateCheck()),
    ];
    return () => {
      pending.forEach((p) => p.then((fn) => fn()).catch(() => {}));
    };
  }, [handleOpenFile, handleOpenFolder, toggleCommentsPane, setTheme, triggerUpdateCheck]);

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

      <UpdateBanner update={pendingUpdate} />
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
