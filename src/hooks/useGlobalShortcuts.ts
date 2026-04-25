import { useEffect } from "react";
import { useStore } from "@/store";
import { getFiletypeKey, getFileCategory, getDefaultView } from "@/lib/file-types";

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
 * B1 — true when the keystroke originated inside an editable element so
 * global shortcuts do not steal arrow keys / characters from it. Walks up
 * to find a `contenteditable=true` ancestor too (for nested editors).
 */
function isEditableTarget(e: KeyboardEvent): boolean {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  // `isContentEditable` requires layout, which JSDOM does not provide; fall
  // back to the IDL property and the raw attribute so the guard still works
  // in unit tests and in real DOMs alike.
  if (t.isContentEditable) return true;
  const ce = (t as HTMLElement & { contentEditable?: string }).contentEditable;
  if (ce && ce !== "false" && ce !== "inherit") return true;
  const attr = t.getAttribute("contenteditable");
  if (attr !== null && attr !== "false") return true;
  return false;
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
      // B1: never intercept keystrokes destined for a text input. Applies to
      // ALL shortcut branches below — Alt+Arrow as well as the Ctrl-modified set.
      if (isEditableTarget(e)) return;

      // Alt+Left / Alt+Right — back/forward through tab history (no Ctrl/Meta).
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (e.key === "ArrowLeft") {
          const target = useStore.getState().back();
          if (target) {
            e.preventDefault();
            // B2: suppress history push — back/forward must not scribble
            // over forward history.
            useStore.getState().setActiveTab(target, { recordHistory: false });
          }
          return;
        }
        if (e.key === "ArrowRight") {
          const target = useStore.getState().forward();
          if (target) {
            e.preventDefault();
            useStore.getState().setActiveTab(target, { recordHistory: false });
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
      // active viewer via the `bumpZoom` chokepoint (L3). `=`/`+` zoom in
      // (Shift+= produces `+` on US layouts; accept either), `-`/`_` zoom out,
      // `0` reset.
      if (e.key === "=" || e.key === "+") {
        const key = activeFiletypeKey();
        if (!key) return;
        e.preventDefault();
        useStore.getState().bumpZoom(key, "in");
        return;
      }
      if (e.key === "-" || e.key === "_") {
        const key = activeFiletypeKey();
        if (!key) return;
        e.preventDefault();
        useStore.getState().bumpZoom(key, "out");
        return;
      }
      if (!e.shiftKey && e.key === "0") {
        const key = activeFiletypeKey();
        if (!key) return;
        e.preventDefault();
        useStore.getState().bumpZoom(key, "reset");
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleOpenFile, handleOpenFolder, toggleCommentsPane]);
}
