import { useState, useEffect, useRef, useCallback } from "react";
import { readDir, type DirEntry } from "@/lib/tauri-commands";
import { listenEvent } from "@/lib/tauri-events";
import { warn } from "@/logger";
import { useStore } from "@/store";

export type { DirEntry };

export interface CachedDir {
  entries: DirEntry[];
  hasMore: boolean;
  total: number;
}

export function useFolderChildren(root: string | null) {
  const [childrenCache, setChildrenCache] = useState<Record<string, CachedDir>>({});
  const childrenCacheRef = useRef(childrenCache);
  // eslint-disable-next-line react-hooks/refs -- sync ref is the documented pattern for stable callbacks
  childrenCacheRef.current = childrenCache;

  const showSidecarFiles = useStore((s) => s.showSidecarFiles);
  const showSidecarFilesRef = useRef(showSidecarFiles);
  // eslint-disable-next-line react-hooks/refs -- sync ref avoids re-subscribing the folder-changed listener on toggle
  showSidecarFilesRef.current = showSidecarFiles;

  const loadChildren = useCallback(
    async (path: string, limit?: number): Promise<DirEntry[]> => {
      const cached = childrenCacheRef.current[path];
      if (cached && limit === undefined) return cached.entries;
      try {
        const result = await readDir(path, limit, showSidecarFiles || undefined);
        const value: CachedDir = { entries: result.entries, hasMore: result.has_more, total: result.total };
        setChildrenCache((prev) => {
          const next = { ...prev, [path]: value };
          childrenCacheRef.current = next;
          return next;
        });
        return result.entries;
      } catch {
        return [];
      }
    },
    [showSidecarFiles]
  );

  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset on prop change
  useEffect(() => { setChildrenCache({}); }, [root, showSidecarFiles]);

  useEffect(() => {
    if (root) loadChildren(root);
  }, [root, loadChildren]);

  // Refresh cached entries when Rust reports a folder change. We only refresh
  // dirs we already have in the cache — unknown dirs would be loaded lazily
  // on expand. Reads the cache via ref so the listener doesn't re-subscribe
  // on every cache mutation.
  useEffect(() => {
    const unlisten = listenEvent("folder-changed", ({ path }) => {
      if (childrenCacheRef.current[path] === undefined) return;
      readDir(path, undefined, showSidecarFilesRef.current || undefined)
        .then((result) =>
          setChildrenCache((prev) => {
            const value: CachedDir = { entries: result.entries, hasMore: result.has_more, total: result.total };
            const next = { ...prev, [path]: value };
            childrenCacheRef.current = next;
            return next;
          })
        )
        .catch((err) =>
          warn(`[useFolderChildren] folder-changed refresh failed: ${err}`)
        );
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  return { childrenCache, loadChildren };
}
