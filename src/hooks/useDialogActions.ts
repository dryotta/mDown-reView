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

  const handleOpenFolder = useCallback(async () => {
    // allow-chained-invokes: register-then-set is required — registerWindowFolder rejects when the folder is already open elsewhere, and setRoot must not run on a rejected registration.
    try {
      const selected = await showOpenDialog({ directory: true, multiple: false });
      if (typeof selected === "string") {
        await registerWindowFolder(selected);
        await setRoot(selected);
        addRecentItem(selected, "folder");
      }
    } catch (err) {
      // Distinguish registry rejection from user cancellation
      if (err && typeof err === "string" && err.includes("already open")) {
        warn(`[useDialogActions] folder already open in another window`);
      }
    }
  }, [setRoot, addRecentItem]);

  return { handleOpenFile, handleOpenFolder };
}
