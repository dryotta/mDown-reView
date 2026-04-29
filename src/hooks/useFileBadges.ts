import { useState, useEffect, useRef } from "react";

import { getFileBadges, type FileBadge } from "@/lib/tauri-commands";
import { listenEvent } from "@/lib/tauri-events";
import { info } from "@/logger";

/**
 * Coalescing window for rapid `pathsKey` changes (folder expansion
 * bursts, ghost set churn, etc.). Tuned to be small enough that the
 * user doesn't perceive a stale badge state, but large enough to
 * collapse a burst of N expands into a single IPC. The race-validation
 * Rust unit test (badges_surface_without_tree_watched_dirs_allowlist)
 * proves a fresh call returns badges; this debounce is purely about
 * avoiding redundant work.
 */
const PATHS_DEBOUNCE_MS = 50;

/**
 * Returns per-file unresolved-comment badge data (count + worst severity)
 * for a set of file paths. Reloads on `comments-changed` and on
 * `file-changed` events with `kind === "review"` (sidecar mutations).
 *
 * Design notes:
 * - `pathsKey` changes (folder expand/collapse, ghost-set churn) are
 *   coalesced through a `PATHS_DEBOUNCE_MS` window so a burst of
 *   expansions produces a single IPC instead of one-per-event.
 * - Reload events (`comments-changed`, sidecar `file-changed`) bypass
 *   the debounce and fire immediately — these are user-visible state
 *   changes that must surface promptly.
 * - When a new IPC starts, the previous in-flight call's `cancelled`
 *   flag is set so its result is discarded on arrival; this prevents a
 *   slower stale call from clobbering a fresher one out-of-order.
 *   The Rust handler keeps running (Tauri sync commands are not
 *   abortable from JS) but its result lands on the floor.
 */
export function useFileBadges(filePaths: string[]): Record<string, FileBadge> {
  const [badges, setBadges] = useState<Record<string, FileBadge>>({});
  const [reloadKey, setReloadKey] = useState(0);

  // Stabilise: only re-fire effect when actual path content changes.
  const pathsKey = filePaths.join("\0");
  const pathsRef = useRef(filePaths);
  useEffect(() => { pathsRef.current = filePaths; });

  // Cancel-token shared across the path-change effect and the reload
  // event handlers. Each fresh fire flips the previous token, so the
  // previous in-flight `.then`/`.catch` becomes a no-op.
  const inFlightRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  useEffect(() => {
    const paths = pathsRef.current;
    if (paths.length === 0) return;

    // Debounce: coalesce a burst of pathsKey changes into one IPC.
    const debounceTimer = setTimeout(() => {
      // Flip the previous in-flight token before issuing a new one.
      inFlightRef.current.cancelled = true;
      const token = { cancelled: false };
      inFlightRef.current = token;

      // [badge-diag] temporary instrumentation — keep through the next
      // few iters so we can confirm the debounce is coalescing as
      // expected on real workspaces.
      const t0 = performance.now();
      void info(`[badge-diag] useFileBadges fire: paths=${paths.length} reloadKey=${reloadKey}`);

      getFileBadges(paths)
        .then((result) => {
          const elapsed = Math.round(performance.now() - t0);
          const next = result ?? {};
          void info(
            `[badge-diag] useFileBadges result: paths=${paths.length} returned=${Object.keys(next).length} elapsed_ms=${elapsed} cancelled=${token.cancelled}`,
          );
          if (token.cancelled) return;
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
          if (!token.cancelled) {
            setBadges((prev) => (Object.keys(prev).length === 0 ? prev : {}));
          }
        });
    }, PATHS_DEBOUNCE_MS);

    return () => {
      clearTimeout(debounceTimer);
      // Mark any in-flight call as cancelled so its result is dropped
      // even if the unmount races the IPC resolution.
      inFlightRef.current.cancelled = true;
    };
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
