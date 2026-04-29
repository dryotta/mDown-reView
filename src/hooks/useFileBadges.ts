import { useState, useEffect, useRef } from "react";
import { listenEvent } from "@/lib/tauri-events";
import { getFileBadges, type FileBadge } from "@/lib/tauri-commands";
import { info } from "@/logger";

/**
 * Returns per-file unresolved-comment badge data (count + worst severity)
 * for a set of file paths. Reloads on `comments-changed` and on
 * `file-changed` events with `kind === "review"` (sidecar mutations).
 */
export function useFileBadges(filePaths: string[]): Record<string, FileBadge> {
  const [badges, setBadges] = useState<Record<string, FileBadge>>({});
  const [reloadKey, setReloadKey] = useState(0);

  // Stabilise: only re-fire effect when actual path content changes.
  const pathsKey = filePaths.join("\0");
  const pathsRef = useRef(filePaths);
  useEffect(() => { pathsRef.current = filePaths; });

  useEffect(() => {
    let cancelled = false;
    const paths = pathsRef.current;
    if (paths.length === 0) return;
    // [badge-diag] temporary instrumentation — remove once race + perf
    // hypotheses are confirmed.
    const t0 = performance.now();
    void info(`[badge-diag] useFileBadges fire: paths=${paths.length} reloadKey=${reloadKey}`);
    getFileBadges(paths)
      .then((result) => {
        const elapsed = Math.round(performance.now() - t0);
        const next = result ?? {};
        void info(
          `[badge-diag] useFileBadges result: paths=${paths.length} returned=${Object.keys(next).length} elapsed_ms=${elapsed} cancelled=${cancelled}`,
        );
        if (cancelled) return;
        setBadges((prev) => {
          const prevKeys = Object.keys(prev);
          const nextKeys = Object.keys(next);
          if (
            prevKeys.length === nextKeys.length &&
            prevKeys.every(
              (k) =>
                prev[k]?.count === next[k]?.count &&
                prev[k]?.max_severity === next[k]?.max_severity &&
                prev[k]?.file_level_count === next[k]?.file_level_count,
            )
          ) return prev;
          return next;
        });
      })
      .catch(() => {
        if (!cancelled) setBadges((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      });
    return () => { cancelled = true; };
  }, [pathsKey, reloadKey]);

  useEffect(() => {
    const p = listenEvent("comments-changed", () => {
      void info("[badge-diag] useFileBadges reload: comments-changed");
      setReloadKey((k) => k + 1);
    });
    return () => { p.then((fn) => fn()).catch(() => {}); };
  }, []);

  useEffect(() => {
    const p = listenEvent("file-changed", (payload) => {
      if (payload.kind === "review") {
        void info(`[badge-diag] useFileBadges reload: file-changed review path=${payload.path}`);
        setReloadKey((k) => k + 1);
      }
    });
    return () => { p.then((fn) => fn()).catch(() => {}); };
  }, []);

  return badges;
}
