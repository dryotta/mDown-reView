import { useState, useEffect, useRef, useCallback } from "react";
import { readDir, type DirEntry } from "@/lib/tauri-commands";

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

  return { childrenCache, loadChildren };
}
