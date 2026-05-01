import { useCallback } from "react";
import { showOpenDialog, registerWindowFolder } from "@/lib/tauri-commands";
import { warn } from "@/logger";
import { useStore } from "@/store";

export function useDialogActions() {
  const openFile = useStore((s) => s.openFile);
  const setRoot = useStore((s) => s.setRoot);
  const addRecentItem = useStore((s) => s.addRecentItem);

  const handleOpenFile = useCallback(async () => {
    try {
      const selected = await showOpenDialog({ directory: false, multiple: true });
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
      // User cancelled or dialog error
    }
  }, [openFile, addRecentItem]);

  /**
   * Shared "open folder by canonical path" action.
   *
   * Both the toolbar (after `showOpenDialog` returns) and the welcome-view
   * recent-folder list MUST go through this single ViewModel callback so
   * the register-then-setRoot ordering can never drift between the two
   * call sites (Rust-First MVVM in `docs/principles.md` — components are
   * View only).
   *
   * Order matters: `register_window_folder` (Rust at `lib.rs::register_window_folder`)
   * rejects with "folder already open in window 'X'" when the folder is
   * claimed by another window, AND focuses that other window before
   * returning. We MUST call it before `setRoot` so a rejected registration
   * leaves THIS window's state untouched and the user sees the existing
   * window come forward instead.
   */
  // allow-chained-invokes: registerWindowFolder must reject before
  // setRoot runs — see comment above. Sequential, not parallelizable.
  const openFolderPath = useCallback(
    async (folder: string) => {
      try {
        await registerWindowFolder(folder);
        await setRoot(folder);
        addRecentItem(folder, "folder");
      } catch (err) {
        if (err && typeof err === "string" && err.includes("already open")) {
          void warn(`[useDialogActions] folder already open in another window`);
        }
      }
    },
    [setRoot, addRecentItem],
  );

  const handleOpenFolder = useCallback(async () => {
    try {
      const selected = await showOpenDialog({ directory: true, multiple: false });
      if (typeof selected === "string") {
        await openFolderPath(selected);
      }
    } catch {
      // User cancelled the dialog. Folder-already-open rejections are
      // surfaced inside `openFolderPath`.
    }
  }, [openFolderPath]);

  return { handleOpenFile, handleOpenFolder, openFolderPath };
}
