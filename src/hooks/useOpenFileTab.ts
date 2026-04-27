import { useEffect } from "react";
import { listenEvent } from "@/lib/tauri-events";
import { useStore } from "@/store";
import { debug } from "@/logger";

/**
 * Listens for `open-file-tab` events from the Rust backend and opens each
 * file path as a tab. The backend emits this when a file is routed to an
 * existing folder window (AddToWindow) or a file-only window is created
 * with initial files (CreateFileOnly).
 */
export function useOpenFileTab() {
  useEffect(() => {
    const unlisten = listenEvent("open-file-tab", (paths) => {
      debug(`[useOpenFileTab] received ${paths.length} file(s)`);
      const { openFile } = useStore.getState();
      for (const filePath of paths) {
        openFile(filePath);
      }
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);
}
