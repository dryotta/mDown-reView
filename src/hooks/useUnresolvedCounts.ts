import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getUnresolvedCounts } from "@/lib/tauri-commands";

/**
 * Hook that returns unresolved comment counts for a set of file paths.
 * Reloads when comments change or sidecars are externally modified.
 */
export function useUnresolvedCounts(filePaths: string[]): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (filePaths.length === 0) return;
    getUnresolvedCounts(filePaths)
      .then(result => { if (!cancelled) setCounts(result); })
      .catch(() => { if (!cancelled) setCounts({}); });
    return () => { cancelled = true; };
  }, [filePaths, reloadKey]);

  // Reload on comment mutations
  useEffect(() => {
    const p = listen("comments-changed", () => { setReloadKey(k => k + 1); });
    return () => { p.then(fn => fn()); };
  }, []);

  // Reload on sidecar changes from watcher
  useEffect(() => {
    const p = listen<{ kind: string }>("file-changed", (event) => {
      if (event.payload.kind === "review") setReloadKey(k => k + 1);
    });
    return () => { p.then(fn => fn()); };
  }, []);

  return counts;
}
