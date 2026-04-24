import { useState, useEffect, useCallback, useMemo } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  getFileComments,
  type CommentThread,
  type MatchedComment,
} from "@/lib/tauri-commands";
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

  const load = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      if (!filePath) {
        setThreads([]);
        return;
      }
      setLoading(true);
      try {
        const result = await getFileComments(filePath);
        if (!isCancelled()) setThreads(result);
      } catch (e) {
        error(`[vm] Failed to load comments for ${filePath}: ${e}`);
        if (!isCancelled()) setThreads([]);
      } finally {
        if (!isCancelled()) setLoading(false);
      }
    },
    [filePath],
  );

  // Initial load + reload on filePath change (with cancellation for stale responses)
  useEffect(() => {
    let cancelled = false;
    // Wrap in async IIFE so the synchronous setState inside `load` is decoupled
    // from this effect body (avoids react-hooks/set-state-in-effect false positive).
    (async () => { await load(() => cancelled); })();
    return () => { cancelled = true; };
  }, [load]);

  // Listen for comments-changed (from Rust mutation commands)
  useEffect(() => {
    if (!filePath) return;
    const listenerPromise = listen<{ file_path: string }>("comments-changed", (event) => {
      if (event.payload.file_path === filePath) {
        info(`[vm] comments-changed for ${filePath}, reloading`);
        load();
      }
    });

    return () => { listenerPromise.then((fn) => fn()).catch(() => {}); };
  }, [filePath, load]);

  // Listen for file-changed (from watcher, for external sidecar changes)
  useEffect(() => {
    if (!filePath) return;
    const listenerPromise = listen<{ path: string; kind: string }>("file-changed", (event) => {
      if (event.payload.kind === "review") {
        // Check if this is the sidecar for our file
        const sidecarPath = event.payload.path;
        if (
          sidecarPath === `${filePath}.review.yaml` ||
          sidecarPath === `${filePath}.review.json`
        ) {
          info(`[vm] External sidecar change for ${filePath}, reloading`);
          load();
        }
      }
    });

    return () => { listenerPromise.then((fn) => fn()).catch(() => {}); };
  }, [filePath, load]);

  const comments: MatchedComment[] = useMemo(
    () => threads.flatMap((t) => [t.root, ...t.replies]),
    [threads]
  );

  return { threads, comments, loading, reload: load };
}
