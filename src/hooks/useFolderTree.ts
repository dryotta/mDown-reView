import { useMemo } from "react";
import type { DirEntry } from "@/lib/tauri-commands";
import type { GhostEntry } from "@/store";
import { stripVerbatimPrefix } from "@/lib/paths";

export type TreeNode = {
  path: string;
  isDir: boolean;
  depth: number;
  name: string;
  isGhost?: boolean;
};

export function buildFolderTree(
  root: string | null,
  childrenCache: Record<string, DirEntry[]>,
  expandedFolders: Record<string, boolean>,
  filter: string,
  ghostEntries: GhostEntry[]
): TreeNode[] {
  function hasMatch(folderPath: string): boolean {
    const entries = childrenCache[folderPath] ?? [];
    return entries.some(
      (e) =>
        (!e.is_dir && e.name.toLowerCase().includes(filter.toLowerCase())) ||
        (e.is_dir && hasMatch(e.path))
    );
  }

  function buildFlatList(parentPath: string, depth: number): TreeNode[] {
    const entries = childrenCache[parentPath] ?? [];
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

  if (root) {
    // Defensive: compare ghost vs flat-list paths in their bare-form so a
    // residual `\\?\` in either source still dedupes correctly. Issue #89
    // closes the producer-side leak (`core::paths::canonicalize_no_verbatim`)
    // but this guard means a single regression in scanner.rs won't surface
    // duplicate ghost rows in the FolderTree.
    const flatBarePaths = new Set(flatList.map((n) => stripVerbatimPrefix(n.path)));
    for (const ghost of ghostEntries) {
      const ghostBare = stripVerbatimPrefix(ghost.sourcePath);
      if (flatBarePaths.has(ghostBare)) continue;

      const sep = ghostBare.includes("/") ? "/" : "\\";
      const parts = ghostBare.split(sep);
      const parentPath = parts.slice(0, -1).join(sep);
      const fileName = parts[parts.length - 1];

      const parentIdx = merged.findIndex(
        (n) => stripVerbatimPrefix(n.path) === parentPath && n.isDir,
      );
      if (parentIdx === -1 && parentPath !== stripVerbatimPrefix(root)) continue;

      const parentDepth = parentIdx >= 0 ? merged[parentIdx].depth : -1;
      const ghostDepth = parentDepth + 1;

      let insertIdx = parentIdx + 1;
      while (insertIdx < merged.length && merged[insertIdx].depth >= ghostDepth) {
        insertIdx++;
      }

      merged.splice(insertIdx, 0, {
        path: ghostBare,
        isDir: false,
        depth: ghostDepth,
        name: fileName,
        isGhost: true,
      });
    }
  }

  return merged;
}

export function useFolderTree(
  root: string | null,
  childrenCache: Record<string, DirEntry[]>,
  expandedFolders: Record<string, boolean>,
  filter: string,
  ghostEntries: GhostEntry[]
): TreeNode[] {
  return useMemo(
    () => buildFolderTree(root, childrenCache, expandedFolders, filter, ghostEntries),
    [root, childrenCache, expandedFolders, filter, ghostEntries]
  );
}
