import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useTransition,
  useDeferredValue,
} from "react";
import { useStore } from "@/store";
import { useShallow } from "zustand/shallow";
import { useFolderChildren } from "@/hooks/useFolderChildren";
import { useFolderTree } from "@/hooks/useFolderTree";
import { useTreeWatcher } from "@/hooks/useTreeWatcher";
import { useFileBadges } from "@/hooks/useFileBadges";
import { CommentBadge } from "@/components/comments/CommentBadge";
import {
  pathStartsWithRootCrossPlatform,
  getAncestors,
  buildGroupedFilterResult,
} from "@/lib/folder-tree";
import "@/styles/folder-tree.css";

interface FolderTreeProps {
  onFileOpen: (path: string) => void;
  onCloseFolder: () => void;
}

interface NavRow {
  path: string;
  isDir: boolean;
  name: string;
}

export function FolderTree({ onFileOpen, onCloseFolder }: FolderTreeProps) {
  const { root, expandedFolders, activeTabPath, ghostEntries, tabs, folderPaneWidth } = useStore(
    useShallow((s) => ({
      root: s.root,
      expandedFolders: s.expandedFolders,
      activeTabPath: s.activeTabPath,
      ghostEntries: s.ghostEntries,
      tabs: s.tabs,
      folderPaneWidth: s.folderPaneWidth,
    }))
  );
  const { childrenCache, loadChildren } = useFolderChildren(root);
  useTreeWatcher(root, expandedFolders);
  const [filter, setFilter] = useState("");
  const deferredFilter = useDeferredValue(filter);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [otherFilesOpen, setOtherFilesOpen] = useState(true);
  const [, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Tree mode list (no filter — filter mode uses grouped view below) ──────
  const treeList = useFolderTree(root, childrenCache, expandedFolders, "", ghostEntries);

  // ── "Other files" derived from open tabs that live outside `root` ─────────
  const otherFiles = useMemo(
    () => tabs.filter((t) => !root || !pathStartsWithRootCrossPlatform(t.path, root)),
    [tabs, root]
  );

  // ── Filter mode grouped list ──────────────────────────────────────────────
  const filterGroups = useMemo(
    () => (deferredFilter ? buildGroupedFilterResult(root, childrenCache, deferredFilter) : []),
    [deferredFilter, root, childrenCache]
  );

  // ── Focusable nav rows in DOM order (skips section headers) ───────────────
  const navRows: NavRow[] = useMemo(() => {
    const rows: NavRow[] = [];
    if (otherFiles.length > 0 && otherFilesOpen) {
      for (const t of otherFiles) {
        rows.push({ path: t.path, isDir: false, name: pathBasename(t.path) });
      }
    }
    if (deferredFilter) {
      for (const g of filterGroups) {
        for (const f of g.files) {
          rows.push({ path: f.path, isDir: false, name: f.name });
        }
      }
    } else {
      for (const n of treeList) {
        rows.push({ path: n.path, isDir: n.isDir, name: n.name });
      }
    }
    return rows;
  }, [otherFiles, otherFilesOpen, deferredFilter, filterGroups, treeList]);

  // Collect visible file paths for badge counts
  const filePaths = useMemo(() => navRows.filter((r) => !r.isDir).map((r) => r.path), [navRows]);
  const fileBadges = useFileBadges(filePaths);

  // ── Optimistic toggle ─────────────────────────────────────────────────────
  const handleToggle = (path: string, isDir: boolean) => {
    if (!isDir) {
      onFileOpen(path);
      return;
    }
    const wasExpanded = useStore.getState().expandedFolders[path];
    useStore.getState().setFolderExpanded(path, !wasExpanded);
    if (!wasExpanded) {
      startTransition(() => {
        loadChildren(path).catch(() => {});
      });
    }
  };

  // ── Effect A: reveal — expand ancestors of the active tab ────────────────
  // Reads expandedFolders imperatively via getState so the effect does not
  // re-fire on every toggle (deps are intentionally limited to inputs that
  // mean "the active file changed"). loadChildren is a stable useCallback.
  useEffect(() => {
    if (!activeTabPath || !root) return;
    if (!pathStartsWithRootCrossPlatform(activeTabPath, root)) return;
    const ancestors = getAncestors(root, activeTabPath);
    if (ancestors.length === 0) return;
    const expanded = useStore.getState().expandedFolders;
    const toExpand = ancestors.filter((p) => !expanded[p]);
    if (toExpand.length === 0) return;
    void Promise.all(toExpand.map((p) => loadChildren(p))).then(() => {
      useStore.setState((s) => ({
        expandedFolders: {
          ...s.expandedFolders,
          ...Object.fromEntries(toExpand.map((p) => [p, true])),
        },
      }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: expandedFolders read via getState; loadChildren is stable
  }, [activeTabPath, root]);

  // ── Effect B: scroll the active row into view once it has rendered ───────
  useLayoutEffect(() => {
    if (!activeTabPath) return;
    const el = containerRef.current?.querySelector<HTMLDivElement>(
      `[data-path="${CSS.escape(activeTabPath)}"]`
    );
    el?.scrollIntoView?.({ block: "nearest" });
  }, [activeTabPath, navRows]);

  const handleKeyDown = (e: React.KeyboardEvent, path: string, isDir: boolean) => {
    const idx = navRows.findIndex((n) => n.path === path);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (idx < navRows.length - 1) setFocusedPath(navRows[idx + 1].path);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (idx > 0) setFocusedPath(navRows[idx - 1].path);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      if (isDir && !expandedFolders[path]) {
        handleToggle(path, true);
      } else if (isDir && expandedFolders[path]) {
        const next = navRows[idx + 1];
        if (next) setFocusedPath(next.path);
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (isDir && expandedFolders[path]) {
        useStore.getState().setFolderExpanded(path, false);
      } else if (!deferredFilter) {
        // find parent in tree mode
        const node = treeList.find((n) => n.path === path);
        if (!node) return;
        const treeIdx = treeList.findIndex((n) => n.path === path);
        for (let i = treeIdx - 1; i >= 0; i--) {
          if (treeList[i].depth < node.depth) {
            setFocusedPath(treeList[i].path);
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
      const el = containerRef.current?.querySelector<HTMLDivElement>(
        `[data-path="${CSS.escape(focusedPath)}"]`
      );
      el?.focus();
    }
  }, [focusedPath]);

  const renderRow = (
    path: string,
    name: string,
    opts: { isDir: boolean; depth: number; isGhost?: boolean; titleOverride?: string }
  ) => {
    const isActive = activeTabPath === path;
    const expanded = opts.isDir ? expandedFolders[path] : undefined;
    return (
      <div
        key={path}
        data-path={path}
        className={`tree-entry${isActive ? " active" : ""}${opts.isGhost ? " tree-entry--ghost" : ""}`}
        tabIndex={0}
        role={opts.isDir ? "treeitem" : "option"}
        aria-selected={isActive}
        aria-expanded={opts.isDir ? !!expanded : undefined}
        onClick={() => {
          if (opts.isGhost) onFileOpen(path);
          else handleToggle(path, opts.isDir);
        }}
        onKeyDown={(e) => handleKeyDown(e, path, opts.isDir)}
      >
        {Array.from({ length: opts.depth }, (_, i) => (
          <span key={i} className="tree-indent" />
        ))}
        <span className="tree-icon">
          {opts.isDir ? (expanded ? "▾" : "▸") : "·"}
        </span>
        <span className="tree-name" title={opts.titleOverride ?? path}>{name}</span>
        {!opts.isDir && (
          <CommentBadge
            count={fileBadges[path]?.count ?? 0}
            severity={fileBadges[path]?.max_severity}
            className="tree-comment-badge"
          />
        )}
      </div>
    );
  };

  const showOtherFiles = otherFiles.length > 0;
  const inFilterMode = !!deferredFilter;
  const noResults = inFilterMode
    ? filterGroups.length === 0
    : treeList.length === 0;

  return (
    <div className="folder-tree" style={{ width: folderPaneWidth }}>
      <div className="folder-tree-toolbar folder-tree-header">
        <span className="folder-tree-title" title={root ?? ""}>
          📁 {root ? root.split(/[/\\]/).pop() : ""}
        </span>
        <span className="folder-tree-header-actions">
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
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            // Precedence: always preventDefault; non-empty filter clears + stops propagation
            // (so global Escape handlers don't also fire); empty filter only blurs and lets
            // the event bubble so global shortcuts can react.
            e.preventDefault();
            if (filter !== "") {
              e.stopPropagation();
              setFilter("");
            }
            e.currentTarget.blur();
          }}
        />
      </div>

      <div className="folder-tree-scroll" ref={containerRef}>
        {showOtherFiles && (
          <div className="folder-tree-other-files">
            <button
              type="button"
              className="folder-tree-section-header folder-tree-other-files-header"
              onClick={() => setOtherFilesOpen((v) => !v)}
              aria-expanded={otherFilesOpen}
              title={`${otherFiles.length} file${otherFiles.length === 1 ? "" : "s"} outside the current folder`}
            >
              <span className="tree-icon">{otherFilesOpen ? "▾" : "▸"}</span>
              <span className="folder-tree-section-label">Other files ({otherFiles.length})</span>
            </button>
            {otherFilesOpen && otherFiles.map((t) =>
              renderRow(t.path, pathBasename(t.path), { isDir: false, depth: 0 })
            )}
          </div>
        )}

        {noResults ? (
          <div className="folder-tree-empty">{inFilterMode ? "No matches" : "Empty folder"}</div>
        ) : inFilterMode ? (
          filterGroups.map((g) => (
            <div key={g.parentPath} className="folder-tree-filter-group">
              <div
                className="folder-tree-section-header folder-tree-filter-group-header"
                title={g.parentPath}
              >
                <MiddleEllipsis text={g.relativePath || "."} />
              </div>
              {g.files.map((f) => renderRow(f.path, f.name, { isDir: false, depth: 0 }))}
            </div>
          ))
        ) : (
          treeList.map((n) =>
            renderRow(n.path, n.name, { isDir: n.isDir, depth: n.depth, isGhost: n.isGhost })
          )
        )}
      </div>
    </div>
  );
}

function pathBasename(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

/**
 * Renders `text` with middle truncation: when the row is too narrow to show
 * the full string, the start collapses with an ellipsis but the last path
 * segment stays fully visible. Pure CSS — no measurement.
 */
function MiddleEllipsis({ text }: { text: string }) {
  const parts = text.split("/");
  const tail = parts.pop() ?? text;
  const head = parts.length > 0 ? parts.join("/") + "/" : "";
  return (
    <span className="middle-ellipsis">
      <span className="middle-ellipsis-start">{head}</span>
      <span className="middle-ellipsis-end">{tail}</span>
    </span>
  );
}
