import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "@/store";
import { updateWatchedFiles, scanReviewFiles } from "@/lib/tauri-commands";
import type { FileChangeEvent } from "@/lib/tauri-commands";

const SAVE_DEBOUNCE_MS = 1500;

export function useFileWatcher() {
  const tabs = useStore((s) => s.tabs);
  const root = useStore((s) => s.root);
  const lastSaveTimestamp = useStore((s) => s.lastSaveTimestamp);
  const setGhostEntries = useStore((s) => s.setGhostEntries);
  const lastSaveRef = useRef(lastSaveTimestamp);

  useEffect(() => {
    lastSaveRef.current = lastSaveTimestamp;
  }, [lastSaveTimestamp]);

  // Sync open tabs to Rust watcher
  useEffect(() => {
    const paths = tabs.map((t) => t.path);
    updateWatchedFiles(paths).catch((err) =>
      console.warn("[useFileWatcher] failed to update watched files:", err)
    );
  }, [tabs]);

  // Listen for file-changed events from Rust
  useEffect(() => {
    const unlisten = listen<FileChangeEvent>("file-changed", (event) => {
      const { path, kind } = event.payload;
      const now = Date.now();

      if (now - lastSaveRef.current < SAVE_DEBOUNCE_MS) {
        console.debug("[useFileWatcher] ignoring event within save debounce window:", path);
        return;
      }

      console.debug(`[useFileWatcher] file changed: ${path} (${kind})`);

      window.dispatchEvent(
        new CustomEvent("mdownreview:file-changed", {
          detail: { path, kind },
        })
      );
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Scan for ghost entries when workspace root changes
  useEffect(() => {
    if (!root) {
      setGhostEntries([]);
      return;
    }

    scanReviewFiles(root)
      .then((pairs) => {
        const ghosts = pairs.map(([sidecarPath, sourcePath]) => ({
          sidecarPath,
          sourcePath,
        }));
        setGhostEntries(ghosts);
      })
      .catch((err) =>
        console.warn("[useFileWatcher] failed to scan review files:", err)
      );
  }, [root, setGhostEntries]);
}
