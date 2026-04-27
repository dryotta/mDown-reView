import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { listenEvent } from "@/lib/tauri-events";
import {
  getFileComments,
  type CommentThread,
  type MatchedComment,
} from "@/lib/tauri-commands";
import { useStore } from "@/store/index";
import { info, error } from "@/logger";

interface UseCommentsResult {
  threads: CommentThread[];
  comments: MatchedComment[];
  loading: boolean;
  reload: () => void;
}

/**
 * Hook that loads matched and threaded comments for a file path.
 * Uses the combined `get_file_comments` command (single IPC call).
 * Subscribes to 'comments-changed' Tauri event for mutation-triggered updates.
 * Subscribes to 'file-changed' (kind: "review") for external sidecar changes.
 */
export function useComments(filePath: string | null): UseCommentsResult {
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [loading, setLoading] = useState(false);

  // Monotonic generation counter that invalidates in-flight `load()` calls.
  // Bumped by `startLoad()` for every fresh load and by the delete handler /
  // effect cleanup so a slow same-path `getFileComments()` cannot clobber
  // newer state (e.g. user-cleared threads after sidecar deletion, or a tab
  // that has since unmounted). See issue #96 race-condition fix.
  const loadGenRef = useRef(0);

  const startLoad = useCallback((): { gen: number; isCancelled: () => boolean } => {
    loadGenRef.current += 1;
    const gen = loadGenRef.current;
    return { gen, isCancelled: () => loadGenRef.current !== gen };
  }, []);

  const load = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      if (!filePath) {
        setThreads([]);
        return;
      }
      setLoading(true);
      try {
        const result = await getFileComments(filePath);
        if (!isCancelled()) {
          setThreads(result.threads);
          useStore.getState().setFileMeta(filePath, {
            commentsMtime: result.sidecar_mtime_ms,
          });
        }
      } catch (e) {
        error(`[vm] Failed to load comments for ${filePath}: ${e}`);
        if (!isCancelled()) setThreads([]);
      } finally {
        if (!isCancelled()) setLoading(false);
      }
    },
    [filePath],
  );

  // Initial load + reload on filePath change (with cancellation for stale responses).
  // Cleanup bumps `loadGenRef` so any in-flight load resolved after unmount /
  // path change is discarded — even if it was started by an event handler that
  // captured its own `isCancelled` predicate.
  useEffect(() => {
    const { isCancelled } = startLoad();
    // Wrap in async IIFE so the synchronous setState inside `load` is decoupled
    // from this effect body (avoids react-hooks/set-state-in-effect false positive).
    (async () => { await load(isCancelled); })();
    return () => { loadGenRef.current += 1; };
  }, [load, startLoad]);

  // Listen for comments-changed (from Rust mutation commands)
  useEffect(() => {
    if (!filePath) return;
    const listenerPromise = listenEvent("comments-changed", (payload) => {
      if (payload.file_path === filePath) {
        info(`[vm] comments-changed for ${filePath}, reloading`);
        const { isCancelled } = startLoad();
        load(isCancelled);
      }
    });

    return () => { listenerPromise.then((fn) => fn()).catch(() => {}); };
  }, [filePath, load, startLoad]);

  // Listen for file-changed (from watcher, for external sidecar changes)
  useEffect(() => {
    if (!filePath) return;
    const listenerPromise = listenEvent("file-changed", (payload) => {
      const sidecarYaml = `${filePath}.review.yaml`;
      const sidecarJson = `${filePath}.review.json`;
      if (payload.kind === "review") {
        // Check if this is the sidecar for our file
        if (payload.path === sidecarYaml || payload.path === sidecarJson) {
          info(`[vm] External sidecar change for ${filePath}, reloading`);
          const { isCancelled } = startLoad();
          load(isCancelled);
        }
      } else if (payload.kind === "deleted") {
        // Sidecar deleted → drop threads + clear cached commentsMtime so
        // StatusBar (Group E) can reflect "no sidecar" without a reload.
        if (payload.path === sidecarYaml || payload.path === sidecarJson) {
          info(`[vm] Sidecar deleted for ${filePath}, clearing threads`);
          // Bump generation BEFORE the synchronous clear so any in-flight
          // reload that resolves later cannot restore the just-deleted threads.
          loadGenRef.current += 1;
          setThreads([]);
          useStore.getState().setFileMeta(filePath, { commentsMtime: null });
        }
      }
    });

    return () => { listenerPromise.then((fn) => fn()).catch(() => {}); };
  }, [filePath, load, startLoad]);

  const comments: MatchedComment[] = useMemo(
    () => threads.flatMap((t) => [t.root, ...t.replies]),
    [threads]
  );

  return { threads, comments, loading, reload: load };
}
