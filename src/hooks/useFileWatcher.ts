import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "@/store";
import { updateWatchedFiles, scanReviewFiles } from "@/lib/tauri-commands";
import type { FileChangeEvent } from "@/lib/tauri-commands";

const SAVE_DEBOUNCE_MS = 1500;

export function useFileWatcher() {
  const tabs = useStore((s) => s.tabs);
  const root = useStore((s) => s.root);
  const lastSaveByPath = useStore((s) => s.lastSaveByPath);
  const setGhostEntries = useStore((s) => s.setGhostEntries);
  const lastSaveByPathRef = useRef(lastSaveByPath);

  useEffect(() => {
    lastSaveByPathRef.current = lastSaveByPath;
  }, [lastSaveByPath]);

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
      const lastSave = lastSaveByPathRef.current[path] ?? 0;

      if (now - lastSave < SAVE_DEBOUNCE_MS) {
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
      .then((pairs) =>
        setGhostEntries(
          pairs.map(([sidecarPath, sourcePath]) => ({ sidecarPath, sourcePath }))
        )
      )
      .catch((err) =>
        console.warn("[useFileWatcher] failed to scan review files:", err)
      );
  }, [root, setGhostEntries]);
}
