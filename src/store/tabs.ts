/**
 * Tabs slice — extracted from index.ts to keep that file under the
 * 500-line shared-chokepoint budget (rule 23 in `docs/architecture.md`).
 *
 * Owns the open-tabs list, active tab pointer, and a small set of session-only
 * per-path maps that are NEVER persisted (rule 15):
 *   - viewModeByTab — last chosen viewer mode (source/visual)
 *   - lastFileReloadedAt / lastCommentsReloadedAt — wall-clock reload timestamps
 *   - fileMetaByPath — { sizeBytes, lineCount } cached from `read_text_file`
 *     so the StatusBar can show file metadata without a second IPC round-trip
 *     (the canonical TextFileResult chokepoint — see commands/fs.rs:71-109).
 *
 * The slice creator function is composed into the combined store in
 * `src/store/index.ts`. It uses the typed `set`/`get` signatures from
 * `StoreApi<Store>` so cross-slice access (e.g. `lastSaveByPath` from
 * WatcherSlice) stays type-safe.
 */
import type { StoreApi } from "zustand";
import type { Store } from "./index";

/** Maximum number of open tabs. When exceeded, oldest non-active tab (by lastAccessedAt) is evicted. */
export const MAX_TABS = 15;

export interface Tab {
  path: string;
  scrollTop: number;
  /**
   * Wall-clock timestamp of the last time this tab was opened or activated.
   * Drives LRU eviction. Optional only for backwards-compatibility with persisted
   * snapshots written before this field existed — `openFile` and `setActiveTab`
   * always set it. Treat `undefined` as 0 (oldest) when sorting.
   */
  lastAccessedAt?: number;
}

/** Per-path cached file metadata, populated by `useFileContent` after a successful read. */
export interface FileMeta {
  sizeBytes: number;
  lineCount: number;
}

export interface TabsSlice {
  tabs: Tab[];
  activeTabPath: string | null;
  viewModeByTab: Record<string, "source" | "visual">;
  /** Wall-clock timestamps of last successful file content load per path. Session-only (not persisted). */
  lastFileReloadedAt: Record<string, number>;
  /** Wall-clock timestamps of last successful comments load per path. Session-only (not persisted). */
  lastCommentsReloadedAt: Record<string, number>;
  /** Cached `read_text_file` metadata per path. Session-only (not persisted). */
  fileMetaByPath: Record<string, FileMeta>;
  openFile: (path: string) => void;
  closeTab: (path: string) => void;
  closeAllTabs: () => void;
  setActiveTab: (path: string) => void;
  setScrollTop: (path: string, scrollTop: number) => void;
  setViewMode: (path: string, mode: "source" | "visual") => void;
  setLastFileReloadedAt: (path: string, ts: number) => void;
  setLastCommentsReloadedAt: (path: string, ts: number) => void;
  setFileMeta: (path: string, sizeBytes: number, lineCount: number) => void;
}

export function filterStaleTabs(
  tabs: Tab[],
  activeTabPath: string | null,
  existsMap: Map<string, boolean>
): { tabs: Tab[]; activeTabPath: string | null } {
  // 1. Drop tabs whose source file no longer exists.
  let validTabs = tabs.filter((t) => existsMap.get(t.path) !== false);

  // 2. Enforce MAX_TABS — keep activeTabPath (if any) and the most-recently-accessed
  //    others by lastAccessedAt descending. Older persisted snapshots may lack the
  //    field; treat missing as 0 so they evict first.
  if (validTabs.length > MAX_TABS) {
    const accessed = (t: Tab) => (typeof t.lastAccessedAt === "number" ? t.lastAccessedAt : 0);
    const active = activeTabPath
      ? validTabs.find((t) => t.path === activeTabPath) ?? null
      : null;
    const others = validTabs
      .filter((t) => t.path !== activeTabPath)
      .sort((a, b) => accessed(b) - accessed(a));
    const keepCount = active ? MAX_TABS - 1 : MAX_TABS;
    const kept = others.slice(0, keepCount);
    // Restore original tab order for stability (avoids reshuffling the tab bar on rehydrate).
    const keptSet = new Set(kept.map((t) => t.path));
    if (active) keptSet.add(active.path);
    validTabs = validTabs.filter((t) => keptSet.has(t.path));
  }

  const validPaths = new Set(validTabs.map((t) => t.path));
  let newActiveTabPath = activeTabPath;
  if (activeTabPath && !validPaths.has(activeTabPath)) {
    newActiveTabPath = validTabs.length > 0 ? validTabs[0].path : null;
  }
  return { tabs: validTabs, activeTabPath: newActiveTabPath };
}

type SliceSet = StoreApi<Store>["setState"];
type SliceGet = StoreApi<Store>["getState"];

export function createTabsSlice(set: SliceSet, get: SliceGet): TabsSlice {
  return {
    tabs: [],
    activeTabPath: null,
    viewModeByTab: {},
    lastFileReloadedAt: {},
    lastCommentsReloadedAt: {},
    fileMetaByPath: {},

    openFile: (path) => {
      const now = Date.now();
      const existing = get().tabs.find((t) => t.path === path);
      if (existing) {
        set((s) => ({
          activeTabPath: path,
          tabs: s.tabs.map((t) => (t.path === path ? { ...t, lastAccessedAt: now } : t)),
        }));
        return;
      }
      // Evict LRU non-active tab if at capacity.
      let baseTabs = get().tabs;
      if (baseTabs.length >= MAX_TABS) {
        const activePath = get().activeTabPath;
        const candidates = baseTabs.filter((t) => t.path !== activePath);
        if (candidates.length > 0) {
          const accessed = (t: Tab) => t.lastAccessedAt ?? 0;
          const victim = candidates.reduce((oldest, t) =>
            accessed(t) < accessed(oldest) ? t : oldest
          );
          baseTabs = baseTabs.filter((t) => t.path !== victim.path);
          const { [victim.path]: _v, ...restView } = get().viewModeByTab;
          const { [victim.path]: _s, ...restSave } = get().lastSaveByPath;
          const { [victim.path]: _m, ...restMeta } = get().fileMetaByPath;
          const { [victim.path]: _fr, ...restFileReload } = get().lastFileReloadedAt;
          const { [victim.path]: _cr, ...restCommentsReload } = get().lastCommentsReloadedAt;
          set({
            viewModeByTab: restView,
            lastSaveByPath: restSave,
            fileMetaByPath: restMeta,
            lastFileReloadedAt: restFileReload,
            lastCommentsReloadedAt: restCommentsReload,
          });
        }
      }
      set({
        tabs: [...baseTabs, { path, scrollTop: 0, lastAccessedAt: now }],
        activeTabPath: path,
      });
    },

    closeTab: (path) => {
      const tabs = get().tabs;
      const idx = tabs.findIndex((t) => t.path === path);
      if (idx === -1) return;
      const newTabs = tabs.filter((t) => t.path !== path);
      let newActive = get().activeTabPath;
      if (newActive === path) {
        newActive = newTabs[idx] ? newTabs[idx].path : newTabs[idx - 1]?.path ?? null;
      }
      const { [path]: _unusedView, ...restViewModes } = get().viewModeByTab;
      const { [path]: _unusedSave, ...restSaveByPath } = get().lastSaveByPath;
      const { [path]: _unusedMeta, ...restMeta } = get().fileMetaByPath;
      const { [path]: _unusedFileReload, ...restFileReload } = get().lastFileReloadedAt;
      const { [path]: _unusedCommentsReload, ...restCommentsReload } = get().lastCommentsReloadedAt;
      set({
        tabs: newTabs,
        activeTabPath: newActive,
        viewModeByTab: restViewModes,
        lastSaveByPath: restSaveByPath,
        fileMetaByPath: restMeta,
        lastFileReloadedAt: restFileReload,
        lastCommentsReloadedAt: restCommentsReload,
      });
    },

    closeAllTabs: () =>
      set({
        tabs: [],
        activeTabPath: null,
        viewModeByTab: {},
        lastSaveByPath: {},
        fileMetaByPath: {},
        lastFileReloadedAt: {},
        lastCommentsReloadedAt: {},
      }),

    setActiveTab: (path) => {
      const now = Date.now();
      set((s) => ({
        activeTabPath: path,
        tabs: s.tabs.map((t) => (t.path === path ? { ...t, lastAccessedAt: now } : t)),
      }));
    },

    setScrollTop: (path, scrollTop) => {
      const tab = get().tabs.find((t) => t.path === path);
      if (!tab || tab.scrollTop === scrollTop) return;
      set((s) => ({
        tabs: s.tabs.map((t) => (t.path === path ? { ...t, scrollTop } : t)),
      }));
    },

    setViewMode: (path, mode) =>
      set((s) => ({
        viewModeByTab: { ...s.viewModeByTab, [path]: mode },
      })),

    setLastFileReloadedAt: (path, ts) =>
      set((s) => ({ lastFileReloadedAt: { ...s.lastFileReloadedAt, [path]: ts } })),

    setLastCommentsReloadedAt: (path, ts) =>
      set((s) => ({ lastCommentsReloadedAt: { ...s.lastCommentsReloadedAt, [path]: ts } })),

    setFileMeta: (path, sizeBytes, lineCount) => {
      const cur = get().fileMetaByPath[path];
      if (cur && cur.sizeBytes === sizeBytes && cur.lineCount === lineCount) return;
      set((s) => ({
        fileMetaByPath: { ...s.fileMetaByPath, [path]: { sizeBytes, lineCount } },
      }));
    },
  };
}
