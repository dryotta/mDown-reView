import { useState, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getUnresolvedCounts } from "@/lib/tauri-commands";

/**
 * Hook that returns unresolved comment counts for a set of file paths.
 * Reloads when comments change or sidecars are externally modified.
 */
export function useUnresolvedCounts(filePaths: string[]): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [reloadKey, setReloadKey] = useState(0);

  // Stabilize: only re-fire effect when actual path content changes
  const pathsKey = filePaths.join("\0");
  const pathsRef = useRef(filePaths);

  useEffect(() => {
    pathsRef.current = filePaths;
  });

  useEffect(() => {
    let cancelled = false;
    const paths = pathsRef.current;
    if (paths.length === 0) return;
    getUnresolvedCounts(paths)
      .then(result => {
        if (cancelled) return;
        const next = result ?? {};
        setCounts(prev => {
          const prevKeys = Object.keys(prev);
          const nextKeys = Object.keys(next);
          if (prevKeys.length === nextKeys.length &&
              prevKeys.every(k => prev[k] === next[k])) return prev;
          return next;
        });
      })
      .catch(() => {
        if (!cancelled) setCounts(prev => Object.keys(prev).length === 0 ? prev : {});
      });
    return () => { cancelled = true; };
  }, [pathsKey, reloadKey]);

  // Reload on comment mutations
  useEffect(() => {
    const p = listen("comments-changed", () => { setReloadKey(k => k + 1); });
    return () => { p.then(fn => fn()).catch(() => {}); };
  }, []);

  // Reload on sidecar changes from watcher
  useEffect(() => {
    const p = listen<{ kind: string }>("file-changed", (event) => {
      if (event.payload.kind === "review") setReloadKey(k => k + 1);
    });
    return () => { p.then(fn => fn()).catch(() => {}); };
  }, []);

  return counts;
}
