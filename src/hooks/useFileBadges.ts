import { useState, useEffect, useRef } from "react";

import { getFileBadges, type FileBadge } from "@/lib/tauri-commands";
import { listenEvent } from "@/lib/tauri-events";

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
 * Echo-suppression window: how long after a `comments-changed` event we
 * treat any subsequent `file-changed kind=review` for the SAME path as
 * the watcher's echo of the same on-disk write. Mirrors the save-window
 * value in `src/hooks/useFileWatcher.ts` (`SAVE_DEBOUNCE_MS = 1500`) so
 * the two hooks agree on "what counts as a local save".
 */
const SAVE_DEBOUNCE_MS = 1500;

/**
 * Returns per-file unresolved-comment badge data (count + worst severity)
 * for a set of file paths.
 *
 * Reload triggers:
 * - `comments-changed` — fires immediately; emitted by every
 *   frontend-initiated sidecar mutation via `with_sidecar_mut`
 *   (rule 17, docs/architecture.md).
 * - `file-changed kind=review` — fires UNLESS within `SAVE_DEBOUNCE_MS`
 *   of a `comments-changed` for the same path. The watcher emits this
 *   ~500 ms after a local sidecar write (it observes the same on-disk
 *   change `with_sidecar_mut` already announced via `comments-changed`),
 *   so we suppress the duplicate to meet AC6 (≤1 refetch per local
 *   save). External-editor sidecar edits arrive WITHOUT a preceding
 *   `comments-changed`, bypass the suppression, and refresh the badge —
 *   this is the only surface that reflects external `.review.yaml`
 *   edits in the FolderTree (RC5 / P1.4).
 *
 * Design notes:
 * - `pathsKey` changes (folder expand/collapse, ghost-set churn) are
 *   coalesced through a `PATHS_DEBOUNCE_MS` window so a burst of
 *   expansions produces a single IPC instead of one-per-event.
 * - Reload events bypass the debounce and fire immediately — these are
 *   user-visible state changes that must surface promptly.
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

  // Per-path timestamp of the most recent `comments-changed` event we
  // observed. Used to suppress the immediate `file-changed kind=review`
  // echo that fires ~500 ms after a local sidecar write (the watcher
  // notices the same on-disk change `with_sidecar_mut` already announced
  // via `comments-changed`). External-editor sidecar edits arrive WITHOUT
  // a preceding `comments-changed`, so they bypass the suppression and
  // refresh the badge — preserves the only path that surfaces external
  // `.review.yaml` edits in the FolderTree (RC5 / P1.4).
  const lastCommentsChangedAtRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const paths = pathsRef.current;
    if (paths.length === 0) return;

    // Debounce: coalesce a burst of pathsKey changes into one IPC.
    const debounceTimer = setTimeout(() => {
      // Flip the previous in-flight token before issuing a new one.
      inFlightRef.current.cancelled = true;
      const token = { cancelled: false };
      inFlightRef.current = token;

      getFileBadges(paths)
        .then((result) => {
          const next = result ?? {};
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
    const p = listenEvent("comments-changed", (payload) => {
      // Mark this path as recently saved so the watcher's `file-changed`
      // echo arriving ~500 ms later is suppressed.
      if (payload?.file_path) {
        lastCommentsChangedAtRef.current[payload.file_path] = Date.now();
      }
      setReloadKey((k) => k + 1);
    });
    return () => { p.then((fn) => fn()).catch(() => {}); };
  }, []);

  useEffect(() => {
    const p = listenEvent("file-changed", (payload) => {
      if (payload.kind !== "review") return;
      const lastEcho = lastCommentsChangedAtRef.current[payload.path] ?? 0;
      if (Date.now() - lastEcho < SAVE_DEBOUNCE_MS) {
        // Echo of a local write that already triggered comments-changed
        // — suppress to meet AC6 (≤1 refetch per local save).
        return;
      }
      setReloadKey((k) => k + 1);
    });
    return () => { p.then((fn) => fn()).catch(() => {}); };
  }, []);

  return badges;
}
