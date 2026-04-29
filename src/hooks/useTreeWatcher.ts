import { useEffect, useRef } from "react";
import { updateTreeWatchedDirs } from "@/lib/tauri-commands";
import { computeWatchedDirs } from "@/lib/folder-tree";
import { warn, info } from "@/logger";

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
    // [badge-diag] temporary instrumentation — remove once race
    // hypothesis is confirmed/refuted.
    void info(`[badge-diag] useTreeWatcher schedule: dirs=${dirs.length} root=${root}`);

    const t = setTimeout(() => {
      const t0 = performance.now();
      updateTreeWatchedDirs(root, dirs)
        .then(() => {
          const elapsed = Math.round(performance.now() - t0);
          void info(
            `[badge-diag] useTreeWatcher sent: dirs=${dirs.length} elapsed_ms=${elapsed}`,
          );
        })
        .catch((err) =>
          warn(`[useTreeWatcher] tree watcher sync failed: ${err}`)
        );
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [root, expandedFolders]);
}
