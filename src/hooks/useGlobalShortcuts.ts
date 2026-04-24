import { useEffect } from "react";
import { useStore } from "@/store";

interface ShortcutCallbacks {
  handleOpenFile: () => void;
  handleOpenFolder: () => void;
  toggleCommentsPane: () => void;
}

/**
 * Global keyboard shortcuts (kept for e2e tests and non-native environments
 * where the Tauri menu is not available). Accepts a subset of the
 * `MenuListenerCallbacks` shape so callers can pass the same callbacks object.
 */
export function useGlobalShortcuts({
  handleOpenFile,
  handleOpenFolder,
  toggleCommentsPane,
}: ShortcutCallbacks) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      if (!e.shiftKey && e.key === "o") {
        e.preventDefault();
        handleOpenFile();
        return;
      }
      if (e.shiftKey && e.key === "O") {
        e.preventDefault();
        handleOpenFolder();
        return;
      }
      if (e.shiftKey && e.key === "C") {
        e.preventDefault();
        toggleCommentsPane();
        return;
      }
      if (!e.shiftKey && e.key === "w") {
        e.preventDefault();
        const { activeTabPath, closeTab } = useStore.getState();
        if (activeTabPath) closeTab(activeTabPath);
        return;
      }
      if (e.shiftKey && e.key === "W") {
        e.preventDefault();
        useStore.getState().closeAllTabs();
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const { tabs, activeTabPath, setActiveTab } = useStore.getState();
        if (tabs.length < 2) return;
        const idx = tabs.findIndex((t) => t.path === activeTabPath);
        const nextIdx = e.shiftKey
          ? (idx - 1 + tabs.length) % tabs.length
          : (idx + 1) % tabs.length;
        setActiveTab(tabs[nextIdx].path);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleOpenFile, handleOpenFolder, toggleCommentsPane]);
}
