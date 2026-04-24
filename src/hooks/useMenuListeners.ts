import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "@/store";

interface MenuListenerCallbacks {
  handleOpenFile: () => void;
  handleOpenFolder: () => void;
  toggleCommentsPane: () => void;
  setTheme: (theme: "system" | "light" | "dark") => void;
  setAboutOpen: (open: boolean) => void;
  checkForUpdate: () => void;
}

export function useMenuListeners({
  handleOpenFile,
  handleOpenFolder,
  toggleCommentsPane,
  setTheme,
  setAboutOpen,
  checkForUpdate,
}: MenuListenerCallbacks) {
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
      listen("menu-check-updates", () => { checkForUpdate(); }),
    ];
    return () => {
      pending.forEach((p) => p.then((fn) => fn()).catch(() => {}));
    };
  }, [handleOpenFile, handleOpenFolder, toggleCommentsPane, setTheme, setAboutOpen, checkForUpdate]);
}
