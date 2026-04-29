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
        const value: CachedDir = {
          entries: result.entries,
          hasMore: result.has_more,
          total: result.total,
        };
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

  // Reset cache and reload visible folders when root or the show-sidecars
  // filter changes. The ref is updated synchronously so that loadChildren
  // calls within this same effect (and any concurrent listener) see the
  // cleared state and re-fetch with the new filter — without this, the
  // load below would short-circuit on the stale cached entries and the
  // tree would render empty until the next manual reload (issue: blank
  // folder pane after toggling "Show sidecar files").
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset on filter change
    setChildrenCache({});
    childrenCacheRef.current = {};
    if (!root) return;
    // Reload root + every currently-expanded folder so the user's view is
    // preserved across the toggle. Snapshot via getState to avoid
    // re-subscribing on every expand/collapse.
    const expanded = useStore.getState().expandedFolders;
    const paths = new Set<string>([root]);
    for (const [p, isExpanded] of Object.entries(expanded)) {
      if (isExpanded) paths.add(p);
    }
    for (const p of paths) {
      void loadChildren(p);
    }
  }, [root, showSidecarFiles, loadChildren]);

  // Refresh cached entries when Rust reports a folder change. We only refresh
  // dirs we already have in the cache — unknown dirs would be loaded lazily
  // on expand. Reads the cache via ref so the listener doesn't re-subscribe
  // on every cache mutation. A generation counter guards against stale async
  // responses after root changes (issue #250).
  const generationRef = useRef(0);
  useEffect(() => {
    const gen = ++generationRef.current;
    const unlisten = listenEvent("folder-changed", ({ path }) => {
      if (childrenCacheRef.current[path] === undefined) return;
      readDir(path, undefined, showSidecarFilesRef.current || undefined)
        .then((result) => {
          if (generationRef.current !== gen) return;
          setChildrenCache((prev) => {
            const value: CachedDir = {
              entries: result.entries,
              hasMore: result.has_more,
              total: result.total,
            };
            const next = { ...prev, [path]: value };
            childrenCacheRef.current = next;
            return next;
          });
        })
        .catch((err) => warn(`[useFolderChildren] folder-changed refresh failed: ${err}`));
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [root]);

  return { childrenCache, loadChildren };
}
