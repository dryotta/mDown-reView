import { useState, useEffect, useRef, useCallback } from "react";
import { useStore } from "@/store";
import type { GhostEntry } from "@/store";
import { readDir, type DirEntry } from "@/lib/tauri-commands";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import "@/styles/folder-tree.css";

interface FolderTreeProps {
  onFileOpen: (path: string) => void;
}

const MAX_EXPAND_DEPTH = 3;

export function FolderTree({ onFileOpen }: FolderTreeProps) {
  const { root, expandedFolders, setFolderExpanded, collapseAll, activeTabPath, commentsByFile, ghostEntries } = useStore();
  const [childrenCache, setChildrenCache] = useState<Record<string, DirEntry[]>>({});
  const childrenCacheRef = useRef(childrenCache);
  childrenCacheRef.current = childrenCache;
  const [filter, setFilter] = useState("");
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [isExpanding, setIsExpanding] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const expandGenRef = useRef(0);
  const autoRootRef = useRef<string | null>(null);

  const cancelExpand = useCallback(() => { expandGenRef.current++; }, []);

  // Stable ref — never re-created, reads cache via ref to avoid stale closures
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Reset cache and cancel any in-flight expand when root changes
  useEffect(() => {
    cancelExpand();
    setChildrenCache({});
    childrenCacheRef.current = {};
  }, [root, cancelExpand]);

  useEffect(() => {
    if (root) loadChildren(root);
  }, [root, loadChildren]);

  // Auto-root to active file's parent when no workspace
  useEffect(() => {
    if (!activeTabPath) {
      // No active tab — if we auto-rooted, clear it
      if (autoRootRef.current && root === autoRootRef.current) {
        useStore.setState({ root: null });
        autoRootRef.current = null;
      }
      return;
    }
    
    // Don't override explicit workspace
    if (root && root !== autoRootRef.current) return;
    
    const sep = activeTabPath.includes("/") ? "/" : "\\";
    const parts = activeTabPath.split(sep);
    parts.pop();
    const parentDir = parts.join(sep);
    
    if (parentDir && parentDir !== root) {
      autoRootRef.current = parentDir;
      useStore.setState({ root: parentDir, expandedFolders: {} });
    }
  }, [activeTabPath, root]);


  const handleToggle = async (path: string, isDir: boolean) => {
    if (!isDir) {
      onFileOpen(path);
      return;
    }
    const isExpanded = expandedFolders[path];
    if (!isExpanded) {
      await loadChildren(path);
    }
    setFolderExpanded(path, !isExpanded);
  };

  const handleExpandAll = useCallback(async (parentPath: string) => {
    const generation = ++expandGenRef.current;
    setIsExpanding(true);
    const pathsToExpand: string[] = [];

    const collect = async (path: string, depth: number) => {
      if (depth >= MAX_EXPAND_DEPTH) return;
      if (expandGenRef.current !== generation) return;
      const entries = await loadChildren(path);
      if (expandGenRef.current !== generation) return;
      pathsToExpand.push(path);
      for (const entry of entries) {
        if (entry.is_dir) await collect(entry.path, depth + 1);
      }
    };

    await collect(parentPath, 0);

    if (expandGenRef.current === generation) {
      useStore.setState((s) => ({
        expandedFolders: {
          ...s.expandedFolders,
          ...Object.fromEntries(pathsToExpand.map((p) => [p, true])),
        },
      }));
    }
    setIsExpanding(false);
  }, [loadChildren]);

  // Menu event listeners for folder-tree-specific actions (mount once)
  const expandAllRef = useRef(handleExpandAll);
  expandAllRef.current = handleExpandAll;

  useEffect(() => {
    const pending = [
      listen("menu-open-folder", async () => {
        const selected = await open({ directory: true, multiple: false });
        if (typeof selected === "string") {
          const { setRoot, folderPaneVisible, toggleFolderPane } = useStore.getState();
          setRoot(selected);
          setChildrenCache({});
          if (!folderPaneVisible) toggleFolderPane();
        }
      }),
      listen("menu-expand-all", () => {
        const { root } = useStore.getState();
        if (root) expandAllRef.current(root);
      }),
      listen("menu-collapse-all", () => {
        expandGenRef.current++;
        useStore.getState().collapseAll();
      }),
    ];
    return () => {
      pending.forEach((p) => p.then((fn) => fn()).catch(() => {}));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build visible flat list for keyboard nav
  type TreeNode = { path: string; isDir: boolean; depth: number; name: string; isGhost?: boolean };
  
  function buildFlatList(
    parentPath: string,
    depth: number
  ): TreeNode[] {
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

  function hasMatch(folderPath: string): boolean {
    const entries = childrenCache[folderPath] ?? [];
    return entries.some(
      (e) =>
        (!e.is_dir && e.name.toLowerCase().includes(filter.toLowerCase())) ||
        (e.is_dir && hasMatch(e.path))
    );
  }

  const flatList = root ? buildFlatList(root, 0) : [];
  
  // Merge ghost entries into flat list
  const mergedList = [...flatList];
  if (root) {
    for (const ghost of ghostEntries) {
      // Only show if the source file isn't already in the tree
      const alreadyInTree = flatList.some((n) => n.path === ghost.sourcePath);
      if (alreadyInTree) continue;
      
      // Find the parent directory
      const sep = ghost.sourcePath.includes("/") ? "/" : "\\";
      const parts = ghost.sourcePath.split(sep);
      const parentPath = parts.slice(0, -1).join(sep);
      const fileName = parts[parts.length - 1];
      
      // Check if parent is in the expanded tree
      const parentIdx = mergedList.findIndex((n) => n.path === parentPath && n.isDir);
      if (parentIdx === -1 && parentPath !== root) continue;
      
      // Calculate depth
      const parentDepth = parentIdx >= 0 ? mergedList[parentIdx].depth : -1;
      const ghostDepth = parentDepth + 1;
      
      // Insert after parent's children (find last child at same or deeper level)
      let insertIdx = parentIdx + 1;
      while (insertIdx < mergedList.length && mergedList[insertIdx].depth >= ghostDepth) {
        insertIdx++;
      }
      
      mergedList.splice(insertIdx, 0, {
        path: ghost.sourcePath,
        isDir: false,
        depth: ghostDepth,
        name: fileName,
        isGhost: true,
      });
    }
  }

  const autoReveal = useStore((s) => s.autoReveal);
  const toggleAutoReveal = useStore((s) => s.toggleAutoReveal);

  // Auto-reveal active file in tree
  useEffect(() => {
    if (!autoReveal || !activeTabPath || !root) return;
    
    // Build path segments from root to active file's parent
    const sep = activeTabPath.includes("/") ? "/" : "\\";
    const relativePath = activeTabPath.startsWith(root) 
      ? activeTabPath.slice(root.length + 1) 
      : null;
    
    if (!relativePath) return;
    
    const segments = relativePath.split(sep);
    segments.pop(); // Remove the file name
    
    // Expand each directory in the path
    let currentPath = root;
    const pathsToExpand: string[] = [];
    for (const segment of segments) {
      currentPath = currentPath + sep + segment;
      if (!expandedFolders[currentPath]) {
        pathsToExpand.push(currentPath);
      }
    }
    
    if (pathsToExpand.length > 0) {
      // Load children for each path, then expand
      Promise.all(pathsToExpand.map(loadChildren)).then(() => {
        useStore.setState((s) => ({
          expandedFolders: {
            ...s.expandedFolders,
            ...Object.fromEntries(pathsToExpand.map((p) => [p, true])),
          },
        }));
      });
    }
    
    // Scroll to the active file entry after a short delay for DOM update
    setTimeout(() => {
      const el = containerRef.current?.querySelector<HTMLDivElement>(
        `[data-path="${CSS.escape(activeTabPath)}"]`
      );
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 100);
  }, [activeTabPath, autoReveal, root, expandedFolders, loadChildren]);

  const handleKeyDown = (e: React.KeyboardEvent, path: string, isDir: boolean) => {
    const idx = mergedList.findIndex((n) => n.path === path);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (idx < mergedList.length - 1) setFocusedPath(mergedList[idx + 1].path);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (idx > 0) setFocusedPath(mergedList[idx - 1].path);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      if (isDir && !expandedFolders[path]) {
        handleToggle(path, true);
      } else if (isDir && expandedFolders[path]) {
        const firstChild = mergedList[idx + 1];
        if (firstChild) setFocusedPath(firstChild.path);
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (isDir && expandedFolders[path]) {
        setFolderExpanded(path, false);
      } else {
        // find parent
        const depth = mergedList[idx].depth;
        for (let i = idx - 1; i >= 0; i--) {
          if (mergedList[i].depth < depth) {
            setFocusedPath(mergedList[i].path);
            break;
          }
        }
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!isDir) onFileOpen(path);
      else handleToggle(path, true);
    }
  };

  useEffect(() => {
    if (focusedPath) {
      const el = containerRef.current?.querySelector<HTMLDivElement>(`[data-path="${CSS.escape(focusedPath)}"]`);
      el?.focus();
    }
  }, [focusedPath]);

  return (
    <div className="folder-tree" style={{ width: useStore.getState().folderPaneWidth }}>
      <div className="folder-tree-toolbar">
        <button onClick={() => { cancelExpand(); collapseAll(); }}>Collapse All</button>
        <button
          disabled={isExpanding}
          onClick={() => {
            if (root) handleExpandAll(root);
          }}
        >
          Expand All
        </button>
        <button
          className={`folder-tree-btn${autoReveal ? " active" : ""}`}
          onClick={toggleAutoReveal}
          title={autoReveal ? "Auto-reveal: ON" : "Auto-reveal: OFF"}
        >
          📍
        </button>
      </div>
      <div className="folder-tree-toolbar">
        <input
          className="folder-tree-filter"
          type="text"
          placeholder="Filter files…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="folder-tree-scroll" ref={containerRef}>
        {!root ? (
          <div className="folder-tree-empty">No folder open</div>
        ) : mergedList.length === 0 ? (
          <div className="folder-tree-empty">{filter ? "No matches" : "Empty folder"}</div>
        ) : (
          mergedList.map(({ path, isDir, depth, name, isGhost }) => {
            const isActive = activeTabPath === path;
            return (
              <div
                key={path}
                data-path={path}
                className={`tree-entry${isActive ? " active" : ""}${isGhost ? " tree-entry--ghost" : ""}`}
                tabIndex={0}
                role={isDir ? "treeitem" : "option"}
                aria-selected={isActive}
                aria-expanded={isDir ? expandedFolders[path] : undefined}
                onClick={() => isGhost ? onFileOpen(path) : handleToggle(path, isDir)}
                onKeyDown={(e) => handleKeyDown(e, path, isDir)}
              >
                {Array.from({ length: depth }, (_, i) => (
                  <span key={i} className="tree-indent" />
                ))}
                <span className="tree-icon">
                  {isDir ? (expandedFolders[path] ? "▾" : "▸") : "·"}
                </span>
                <span className="tree-name" title={path}>{name}</span>
                {!isDir && (() => {
                  const unresolvedCount = (commentsByFile[path] ?? []).filter((c) => !c.resolved).length;
                  return unresolvedCount > 0 ? (
                    <span className="tree-comment-badge" title={`${unresolvedCount} open comment${unresolvedCount > 1 ? "s" : ""}`}>
                      {unresolvedCount}
                    </span>
                  ) : null;
                })()}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
