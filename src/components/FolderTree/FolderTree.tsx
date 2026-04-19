import { useState, useEffect, useRef, useCallback } from "react";
import { useStore } from "@/store";
import { readDir, type DirEntry } from "@/lib/tauri-commands";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import "@/styles/folder-tree.css";

interface FolderTreeProps {
  onFileOpen: (path: string) => void;
}

const MAX_EXPAND_DEPTH = 3;

export function FolderTree({ onFileOpen }: FolderTreeProps) {
  const { root, expandedFolders, setFolderExpanded, collapseAll, activeTabPath, commentsByFile } = useStore();
  const [childrenCache, setChildrenCache] = useState<Record<string, DirEntry[]>>({});
  const childrenCacheRef = useRef(childrenCache);
  childrenCacheRef.current = childrenCache;
  const [filter, setFilter] = useState("");
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [isExpanding, setIsExpanding] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const expandGenRef = useRef(0);

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
  function buildFlatList(
    parentPath: string,
    depth: number
  ): { path: string; isDir: boolean; depth: number; name: string }[] {
    const entries = childrenCache[parentPath] ?? [];
    const result: { path: string; isDir: boolean; depth: number; name: string }[] = [];
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

  const handleKeyDown = (e: React.KeyboardEvent, path: string, isDir: boolean) => {
    const idx = flatList.findIndex((n) => n.path === path);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (idx < flatList.length - 1) setFocusedPath(flatList[idx + 1].path);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (idx > 0) setFocusedPath(flatList[idx - 1].path);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      if (isDir && !expandedFolders[path]) {
        handleToggle(path, true);
      } else if (isDir && expandedFolders[path]) {
        const firstChild = flatList[idx + 1];
        if (firstChild) setFocusedPath(firstChild.path);
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (isDir && expandedFolders[path]) {
        setFolderExpanded(path, false);
      } else {
        // find parent
        const depth = flatList[idx].depth;
        for (let i = idx - 1; i >= 0; i--) {
          if (flatList[i].depth < depth) {
            setFocusedPath(flatList[i].path);
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
        ) : flatList.length === 0 ? (
          <div className="folder-tree-empty">{filter ? "No matches" : "Empty folder"}</div>
        ) : (
          flatList.map(({ path, isDir, depth, name }) => {
            const isActive = activeTabPath === path;
            return (
              <div
                key={path}
                data-path={path}
                className={`tree-entry${isActive ? " active" : ""}`}
                tabIndex={0}
                role={isDir ? "treeitem" : "option"}
                aria-selected={isActive}
                aria-expanded={isDir ? expandedFolders[path] : undefined}
                onClick={() => handleToggle(path, isDir)}
                onKeyDown={(e) => handleKeyDown(e, path, isDir)}
              >
                {Array.from({ length: depth }, (_, i) => (
                  <span key={i} className="tree-indent" />
                ))}
                <span className="tree-icon">
                  {isDir ? (expandedFolders[path] ? "▾" : "▸") : "·"}
                </span>
                <span className="tree-name" title={path}>{name}</span>
                {!isDir && (commentsByFile[path] ?? []).some((c) => !c.resolved) && (
                  <span className="tree-comment-dot" title="Has open comments" aria-label="Has open comments" />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
