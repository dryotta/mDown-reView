import { useEffect, useRef } from "react";
import { updateTreeWatchedDirs } from "@/lib/tauri-commands";
import { computeWatchedDirs } from "@/lib/folder-tree";

const DEBOUNCE_MS = 100;

/**
 * Keeps the Rust folder-tree watcher in sync with the set of currently
 * expanded folders. Computes `[root, ...expandedDirs]` (deduped), debounces
 * by 100ms, and skips the IPC call when the resulting set is unchanged.
 */
export function useTreeWatcher(
  root: string | null,
  expandedFolders: Record<string, boolean>,
) {
  const lastSentRef = useRef<string>("");

  useEffect(() => {
    if (!root) return;
    const expanded = Object.entries(expandedFolders)
      .filter(([, v]) => v)
      .map(([k]) => k);
    const dirs = computeWatchedDirs(root, expanded);
    const key = dirs.join("\0");
    if (key === lastSentRef.current) return;
    lastSentRef.current = key;

    const t = setTimeout(() => {
      updateTreeWatchedDirs(root, dirs).catch(() => {});
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [root, expandedFolders]);
}
