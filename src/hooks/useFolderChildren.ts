import { useState, useEffect, useRef, useCallback } from "react";
import { readDir, type DirEntry } from "@/lib/tauri-commands";
import { listenEvent } from "@/lib/tauri-events";

export type { DirEntry };

export function useFolderChildren(root: string | null) {
  const [childrenCache, setChildrenCache] = useState<Record<string, DirEntry[]>>({});
  const childrenCacheRef = useRef(childrenCache);
  // eslint-disable-next-line react-hooks/refs -- sync ref is the documented pattern for stable callbacks
  childrenCacheRef.current = childrenCache;

  const loadChildren = useCallback(
    async (path: string): Promise<DirEntry[]> => {
      const cached = childrenCacheRef.current[path];
      if (cached) return cached;
      try {
        const entries = await readDir(path);
        setChildrenCache((prev) => {
          const next = { ...prev, [path]: entries };
          childrenCacheRef.current = next;
          return next;
        });
        return entries;
      } catch {
        return [];
      }
    },
    []
  );

  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset on prop change
  useEffect(() => { setChildrenCache({}); }, [root]);

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
      readDir(path)
        .then((entries) =>
          setChildrenCache((prev) => {
            const next = { ...prev, [path]: entries };
            childrenCacheRef.current = next;
            return next;
          })
        )
        .catch(() => {});
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  return { childrenCache, loadChildren };
}
