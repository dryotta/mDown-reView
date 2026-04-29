import { useEffect, useRef } from "react";

import { computeWatchedDirs } from "@/lib/folder-tree";
import { updateTreeWatchedDirs } from "@/lib/tauri-commands";
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
    // [badge-diag] temporary instrumentation — remove once race
    // hypothesis is confirmed/refuted.
    void info(`[badge-diag] useTreeWatcher schedule: dirs=${dirs.length} root=${root}`);

    const t = setTimeout(() => {
      // Update lastSentRef INSIDE the timeout, not before it. Otherwise
      // a StrictMode double-mount (or any cleanup-then-rerun cycle
      // inside the debounce window) clears this timeout in cleanup, then
      // the second effect run sees `key === lastSentRef.current` and
      // skips scheduling — so the IPC is silently lost. With the
      // assignment inside the callback, the re-mounted effect re-arms
      // the timer harmlessly because `lastSentRef.current` still holds
      // the previous (or empty) key.
      lastSentRef.current = key;
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
