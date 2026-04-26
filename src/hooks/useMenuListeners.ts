import { useEffect } from "react";
import { listenEvent } from "@/lib/tauri-events";
import { useStore } from "@/store";

interface MenuListenerCallbacks {
  handleOpenFile: () => void;
  handleOpenFolder: () => void;
  toggleCommentsPane: () => void;
  setTheme: (theme: "system" | "light" | "dark") => void;
  setAboutOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  checkForUpdate: () => void;
  /**
   * F1 — accepted so callers can share a single callbacks object with
   * `useGlobalShortcuts` without TypeScript complaining about excess
   * properties. No native menu event currently fires this; the
   * keyboard shortcut alone drives it.
   */
  startCommentOnSelection?: () => void;
}

export function useMenuListeners({
  handleOpenFile,
  handleOpenFolder,
  toggleCommentsPane,
  setTheme,
  setAboutOpen,
  setSettingsOpen,
  checkForUpdate,
}: MenuListenerCallbacks) {
  useEffect(() => {
    const pending = [
      listenEvent("menu-open-file", () => handleOpenFile()),
      listenEvent("menu-open-folder", () => handleOpenFolder()),
      listenEvent("menu-close-folder", () => useStore.getState().closeFolder()),
      listenEvent("menu-toggle-comments-pane", () => toggleCommentsPane()),
      listenEvent("menu-close-tab", () => {
        const { activeTabPath, closeTab } = useStore.getState();
        if (activeTabPath) closeTab(activeTabPath);
      }),
      listenEvent("menu-close-all-tabs", () => useStore.getState().closeAllTabs()),
      listenEvent("menu-next-tab", () => {
        const { tabs, activeTabPath, setActiveTab } = useStore.getState();
        if (tabs.length < 2) return;
        const idx = tabs.findIndex((t) => t.path === activeTabPath);
        setActiveTab(tabs[(idx + 1) % tabs.length].path);
      }),
      listenEvent("menu-prev-tab", () => {
        const { tabs, activeTabPath, setActiveTab } = useStore.getState();
        if (tabs.length < 2) return;
        const idx = tabs.findIndex((t) => t.path === activeTabPath);
        setActiveTab(tabs[(idx - 1 + tabs.length) % tabs.length].path);
      }),
      listenEvent("menu-theme-system", () => setTheme("system")),
      listenEvent("menu-theme-light", () => setTheme("light")),
      listenEvent("menu-theme-dark", () => setTheme("dark")),
      listenEvent("menu-about", () => setAboutOpen(true)),
      listenEvent("menu-open-settings", () => setSettingsOpen(true)),
      listenEvent("menu-check-updates", () => { checkForUpdate(); }),
      listenEvent("menu-help-welcome", () => useStore.getState().openWelcome()),
      listenEvent("menu-help-setup", () => useStore.getState().openSetup()),
    ];
    return () => {
      pending.forEach((p) => p.then((fn) => fn()).catch(() => {}));
    };
  }, [handleOpenFile, handleOpenFolder, toggleCommentsPane, setTheme, setAboutOpen, setSettingsOpen, checkForUpdate]);
}
