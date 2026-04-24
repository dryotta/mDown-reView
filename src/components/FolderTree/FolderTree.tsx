import { useState, useEffect, useRef, useMemo } from "react";
import { useStore } from "@/store";
import { useShallow } from "zustand/shallow";
import { useFolderChildren } from "@/hooks/useFolderChildren";
import { useUnresolvedCounts } from "@/hooks/useUnresolvedCounts";
import "@/styles/folder-tree.css";

interface FolderTreeProps {
  onFileOpen: (path: string) => void;
  onCloseFolder: () => void;
}

export function FolderTree({ onFileOpen, onCloseFolder }: FolderTreeProps) {
  const { root, expandedFolders, activeTabPath, ghostEntries } = useStore(
    useShallow((s) => ({
      root: s.root,
      expandedFolders: s.expandedFolders,
      activeTabPath: s.activeTabPath,
      ghostEntries: s.ghostEntries,
    }))
  );
  const setFolderExpanded = useStore((s) => s.setFolderExpanded);
  const { childrenCache, loadChildren } = useFolderChildren(root);
  const [filter, setFilter] = useState("");
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Build visible flat list for keyboard nav
  type TreeNode = { path: string; isDir: boolean; depth: number; name: string; isGhost?: boolean };

  const mergedList = useMemo(() => {
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
      for (const ghost of ghostEntries) {
        const alreadyInTree = flatList.some((n) => n.path === ghost.sourcePath);
        if (alreadyInTree) continue;

        const sep = ghost.sourcePath.includes("/") ? "/" : "\\";
        const parts = ghost.sourcePath.split(sep);
        const parentPath = parts.slice(0, -1).join(sep);
        const fileName = parts[parts.length - 1];

        const parentIdx = merged.findIndex((n) => n.path === parentPath && n.isDir);
        if (parentIdx === -1 && parentPath !== root) continue;

        const parentDepth = parentIdx >= 0 ? merged[parentIdx].depth : -1;
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

    return merged;
  }, [root, childrenCache, expandedFolders, filter, ghostEntries]);

  // Collect visible file paths for badge counts
  const filePaths = useMemo(
    () => mergedList.filter(n => !n.isDir).map(n => n.path),
    [mergedList]
  );
  const unresolvedCounts = useUnresolvedCounts(filePaths);

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
      <div className="folder-tree-toolbar folder-tree-header">
        <span className="folder-tree-title" title={root ?? ""}>
          📁 {root ? root.split(/[/\\]/).pop() : ""}
        </span>
        <span className="folder-tree-header-actions">
          <button
            className={`folder-tree-btn${autoReveal ? " active" : ""}`}
            onClick={toggleAutoReveal}
            title={autoReveal ? "Auto-reveal: ON" : "Auto-reveal: OFF"}
          >
            📍
          </button>
          <button
            className="folder-tree-btn folder-tree-close-btn"
            onClick={onCloseFolder}
            title="Close folder"
          >
            ✕
          </button>
        </span>
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
        {mergedList.length === 0 ? (
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
                // eslint-disable-next-line react-hooks/refs -- event handlers only run on user interaction
                onClick={() => { if (isGhost) onFileOpen(path); else handleToggle(path, isDir); }}
                // eslint-disable-next-line react-hooks/refs -- event handlers only run on user interaction
                onKeyDown={(e) => { handleKeyDown(e, path, isDir); }}
              >
                {Array.from({ length: depth }, (_, i) => (
                  <span key={i} className="tree-indent" />
                ))}
                <span className="tree-icon">
                  {isDir ? (expandedFolders[path] ? "▾" : "▸") : "·"}
                </span>
                <span className="tree-name" title={path}>{name}</span>
                {!isDir && unresolvedCounts?.[path] > 0 && (
                  <span className="tree-comment-badge">{unresolvedCounts[path]}</span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
