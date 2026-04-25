import { useEffect } from "react";
import { useStore } from "@/store";
import { getFiletypeKey, getFileCategory, getDefaultView } from "@/lib/file-types";
import { ZOOM_DEFAULT, ZOOM_STEP } from "@/store/viewerPrefs";

interface ShortcutCallbacks {
  handleOpenFile: () => void;
  handleOpenFolder: () => void;
  toggleCommentsPane: () => void;
}

/** Resolve the filetype key the active viewer would use (#65 D1/D2/D3). */
function activeFiletypeKey(): string | null {
  const { activeTabPath, viewModeByTab } = useStore.getState();
  if (!activeTabPath) return null;
  const cat = getFileCategory(activeTabPath);
  const view = viewModeByTab?.[activeTabPath] ?? getDefaultView(cat);
  return getFiletypeKey(activeTabPath, view);
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
      // Alt+Left / Alt+Right — back/forward through tab history (no Ctrl/Meta).
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (e.key === "ArrowLeft") {
          const target = useStore.getState().back();
          if (target) {
            e.preventDefault();
            useStore.getState().setActiveTab(target);
          }
          return;
        }
        if (e.key === "ArrowRight") {
          const target = useStore.getState().forward();
          if (target) {
            e.preventDefault();
            useStore.getState().setActiveTab(target);
          }
          return;
        }
      }

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
        return;
      }
      // Zoom shortcuts (#65 D1/D2/D3). Routes to the per-filetype zoom of the
      // active viewer. `=`/`+` zoom in (Shift+= produces `+` on US layouts;
      // accept either), `-`/`_` zoom out, `0` reset.
      if (e.key === "=" || e.key === "+") {
        const key = activeFiletypeKey();
        if (!key) return;
        e.preventDefault();
        const { zoomByFiletype, setZoom } = useStore.getState();
        setZoom(key, (zoomByFiletype[key] ?? ZOOM_DEFAULT) * ZOOM_STEP);
        return;
      }
      if (e.key === "-" || e.key === "_") {
        const key = activeFiletypeKey();
        if (!key) return;
        e.preventDefault();
        const { zoomByFiletype, setZoom } = useStore.getState();
        setZoom(key, (zoomByFiletype[key] ?? ZOOM_DEFAULT) / ZOOM_STEP);
        return;
      }
      if (!e.shiftKey && e.key === "0") {
        const key = activeFiletypeKey();
        if (!key) return;
        e.preventDefault();
        useStore.getState().setZoom(key, ZOOM_DEFAULT);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleOpenFile, handleOpenFolder, toggleCommentsPane]);
}
