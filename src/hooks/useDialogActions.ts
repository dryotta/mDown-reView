import { useCallback } from "react";
import { showOpenDialog } from "@/lib/tauri-commands";
import { useStore } from "@/store";

/**
 * Dialog wrappers for the toolbar's Open File / Open Folder buttons.
 *
 * The actual workspace mutations (register-then-setRoot ordering for
 * folders, openFile + addRecentItem for files) live in the workspace
 * slice as `openFolderPath` / `openFilePath` — single entry points
 * shared with the welcome-view recents (rule 16: cross-slice user
 * actions group into one store action). This hook is a thin shell
 * around `showOpenDialog` that pipes the user-selected path into
 * the slice action.
 */
export function useDialogActions() {
  const openFolderPath = useStore((s) => s.openFolderPath);
  const openFilePath = useStore((s) => s.openFilePath);

  const handleOpenFile = useCallback(async () => {
    try {
      const selected = await showOpenDialog({ directory: false, multiple: true });
      if (Array.isArray(selected)) {
        for (const f of selected) openFilePath(f);
      } else if (typeof selected === "string") {
        openFilePath(selected);
      }
    } catch {
      // User cancelled or dialog error.
    }
  }, [openFilePath]);

  const handleOpenFolder = useCallback(async () => {
    try {
      const selected = await showOpenDialog({ directory: true, multiple: false });
      if (typeof selected === "string") {
        await openFolderPath(selected);
      }
    } catch {
      // User cancelled the dialog. Folder-already-open + other
      // rejections are surfaced inside `openFolderPath`'s catch.
    }
  }, [openFolderPath]);

  return { handleOpenFile, handleOpenFolder };
}
