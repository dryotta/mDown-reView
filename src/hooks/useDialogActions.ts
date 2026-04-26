import { useCallback } from "react";
import { showOpenDialog } from "@/lib/tauri-commands";
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

  const handleOpenFolder = useCallback(async () => {
    try {
      const selected = await showOpenDialog({ directory: true, multiple: false });
      if (typeof selected === "string") {
        await setRoot(selected);
        addRecentItem(selected, "folder");
      }
    } catch {
      // User cancelled or dialog error
    }
  }, [setRoot, addRecentItem]);

  return { handleOpenFile, handleOpenFolder };
}
