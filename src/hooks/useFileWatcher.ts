import { useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "@/store";
import { updateWatchedFiles, scanReviewFiles } from "@/lib/tauri-commands";
import type { FileChangeEvent } from "@/lib/tauri-commands";
import { warn, debug } from "@/logger";

const SAVE_DEBOUNCE_MS = 1500;
const SCAN_DEBOUNCE_MS = 500;

export function useFileWatcher() {
  const tabs = useStore((s) => s.tabs);
  const root = useStore((s) => s.root);
  const lastSaveByPath = useStore((s) => s.lastSaveByPath);
  const setGhostEntries = useStore((s) => s.setGhostEntries);
  const lastSaveByPathRef = useRef(lastSaveByPath);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    lastSaveByPathRef.current = lastSaveByPath;
  }, [lastSaveByPath]);

  // Debounced scan coalesces rapid deletions into a single scanReviewFiles call
  const debouncedScan = useCallback(() => {
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    scanTimerRef.current = setTimeout(() => {
      const currentRoot = useStore.getState().root;
      if (currentRoot) {
        scanReviewFiles(currentRoot)
          .then((pairs) =>
            useStore.getState().setGhostEntries(
              pairs.map(([sidecarPath, sourcePath]) => ({ sidecarPath, sourcePath }))
            )
          )
          .catch((err) =>
            warn(`[useFileWatcher] failed to re-scan after deletion: ${err}`)
          );
      }
    }, SCAN_DEBOUNCE_MS);
  }, []);

  // Sync open tabs to Rust watcher
  useEffect(() => {
    const paths = tabs.map((t) => t.path);
    updateWatchedFiles(paths).catch((err) =>
      warn(`[useFileWatcher] failed to update watched files: ${err}`)
    );
  }, [tabs]);

  // Listen for file-changed events from Rust
  useEffect(() => {
    const unlisten = listen<FileChangeEvent>("file-changed", (event) => {
      const { path, kind } = event.payload;
      const now = Date.now();
      const lastSave = lastSaveByPathRef.current[path] ?? 0;

      if (now - lastSave < SAVE_DEBOUNCE_MS) {
        debug(`[useFileWatcher] ignoring event within save debounce window: ${path}`);
        return;
      }

      debug(`[useFileWatcher] file changed: ${path} (${kind})`);
      window.dispatchEvent(
        new CustomEvent("mdownreview:file-changed", {
          detail: { path, kind },
        })
      );

      // Debounced re-scan for ghost entries on any deletion
      // (source deletion → new ghost; sidecar deletion → ghost removed)
      if (kind === "deleted") {
        debouncedScan();
      }
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    };
  }, [debouncedScan]);

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
        warn(`[useFileWatcher] failed to scan review files: ${err}`)
      );
  }, [root, setGhostEntries]);
}
