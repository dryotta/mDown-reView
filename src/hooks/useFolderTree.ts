import { useMemo } from "react";
import type { CachedDir } from "@/hooks/useFolderChildren";
import type { GhostEntry } from "@/store";

export type TreeNode = {
  path: string;
  isDir: boolean;
  depth: number;
  name: string;
  isGhost?: boolean;
};

export interface FolderTreeResult {
  nodes: TreeNode[];
  /** Ghost source paths hidden under each collapsed ancestor folder. */
  hiddenGhostsByFolder: Record<string, string[]>;
}

export function buildFolderTree(
  root: string | null,
  childrenCache: Record<string, CachedDir>,
  expandedFolders: Record<string, boolean>,
  filter: string,
  ghostEntries: GhostEntry[]
): FolderTreeResult {
  function hasMatch(folderPath: string): boolean {
    const entries = childrenCache[folderPath]?.entries ?? [];
    return entries.some(
      (e) =>
        (!e.is_dir && e.name.toLowerCase().includes(filter.toLowerCase())) ||
        (e.is_dir && hasMatch(e.path))
    );
  }

  function buildFlatList(parentPath: string, depth: number): TreeNode[] {
    const entries = childrenCache[parentPath]?.entries ?? [];
    const result: TreeNode[] = [];
    for (const entry of entries) {
      if (filter) {
        const matchesSelf =
          !entry.is_dir && entry.name.toLowerCase().includes(filter.toLowerCase());
        const hasMatchingChild = entry.is_dir && hasMatch(entry.path);
        if (!matchesSelf && !hasMatchingChild) continue;
      }
      result.push({ path: entry.path, isDir: entry.is_dir, depth, name: entry.name });
      if (entry.is_dir && expandedFolders[entry.path]) {
        result.push(...buildFlatList(entry.path, depth + 1));
      }
    }
    return result;
  }

  const flatList = root ? buildFlatList(root, 0) : [];
  const merged: TreeNode[] = [...flatList];
  const hiddenGhostsByFolder: Record<string, string[]> = {};

  if (root) {
    // Producer-side fix lives in `core::paths::canonicalize_no_verbatim` —
    // every Rust path crossing IPC is bare-form, so plain string equality
    // suffices here. See `docs/security.md` rules 11+ and issue #89.
    const flatPaths = new Set(flatList.map((n) => n.path));
    const mergedDirSet = new Set(merged.filter((n) => n.isDir).map((n) => n.path));
    for (const ghost of ghostEntries) {
      if (flatPaths.has(ghost.sourcePath)) continue;

      const sep = ghost.sourcePath.includes("/") ? "/" : "\\";
      const parts = ghost.sourcePath.split(sep);
      const parentPath = parts.slice(0, -1).join(sep);
      const fileName = parts[parts.length - 1];

      // Root-level ghosts are always visible.
      if (parentPath === root) {
        const parentDepth = -1;
        const ghostDepth = parentDepth + 1;
        let insertIdx = 0;
        while (insertIdx < merged.length && merged[insertIdx].depth >= ghostDepth) {
          insertIdx++;
        }
        merged.splice(insertIdx, 0, {
          path: ghost.sourcePath,
          isDir: false,
          depth: ghostDepth,
          name: fileName,
          isGhost: true,
        });
        continue;
      }

      // Parent must be in the merged list (ancestor chain expanded) AND expanded itself.
      const parentIdx = merged.findIndex(
        (n) => n.path === parentPath && n.isDir,
      );

      if (parentIdx === -1 || !expandedFolders[parentPath]) {
        // Ghost is hidden — find nearest visible ancestor folder for badge aggregation.
        const ancestorParts: string[] = parentPath.split(sep);
        let nearestVisible: string | undefined;
        // Walk from the parent upward (excluding root itself).
        for (let i = ancestorParts.length; i > 0; i--) {
          const candidate: string = ancestorParts.slice(0, i).join(sep);
          if (candidate === root) break;
          if (mergedDirSet.has(candidate)) {
            nearestVisible = candidate;
            break;
          }
        }
        if (nearestVisible) {
          (hiddenGhostsByFolder[nearestVisible] ??= []).push(ghost.sourcePath);
        }
        continue;
      }

      const parentDepth = merged[parentIdx].depth;
      const ghostDepth = parentDepth + 1;

      let insertIdx = parentIdx + 1;
      while (insertIdx < merged.length && merged[insertIdx].depth >= ghostDepth) {
        insertIdx++;
      }

      merged.splice(insertIdx, 0, {
        path: ghost.sourcePath,
        isDir: false,
        depth: ghostDepth,
        name: fileName,
        isGhost: true,
      });
    }
  }

  return { nodes: merged, hiddenGhostsByFolder };
}

export function useFolderTree(
  root: string | null,
  childrenCache: Record<string, CachedDir>,
  expandedFolders: Record<string, boolean>,
  filter: string,
  ghostEntries: GhostEntry[]
): FolderTreeResult {
  return useMemo(
    () => buildFolderTree(root, childrenCache, expandedFolders, filter, ghostEntries),
    [root, childrenCache, expandedFolders, filter, ghostEntries]
  );
}
