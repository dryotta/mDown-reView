import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/shallow";

// ── Recent items ──────────────────────────────────────────────────────────

export interface RecentItem {
  path: string;
  type: "file" | "folder";
  timestamp: number;
}

const MAX_RECENT_ITEMS = 5;

// ── Workspace slice ────────────────────────────────────────────────────────

interface WorkspaceSlice {
  root: string | null;
  expandedFolders: Record<string, boolean>;
  setRoot: (root: string | null) => void;
  toggleFolder: (path: string) => void;
  setFolderExpanded: (path: string, expanded: boolean) => void;
  closeFolder: () => void;
}

// ── Tabs slice ─────────────────────────────────────────────────────────────

export interface Tab {
  path: string;
  scrollTop: number;
}

interface TabsSlice {
  tabs: Tab[];
  activeTabPath: string | null;
  viewModeByTab: Record<string, "source" | "visual">;
  openFile: (path: string) => void;
  closeTab: (path: string) => void;
  closeAllTabs: () => void;
  setActiveTab: (path: string) => void;
  setScrollTop: (path: string, scrollTop: number) => void;
  setViewMode: (path: string, mode: "source" | "visual") => void;
}

// ── UI slice ──────────────────────────────────────────────────────────────

type Theme = "system" | "light" | "dark";

interface UISlice {
  theme: Theme;
  folderPaneWidth: number;
  commentsPaneVisible: boolean;
  authorName: string;
  setTheme: (theme: Theme) => void;
  setFolderPaneWidth: (width: number) => void;
  toggleCommentsPane: () => void;
  setAuthorName: (name: string) => void;
}

// ── Watcher slice ──────────────────────────────────────────────────────────

/** Ghost entry: a .review.yaml/.review.json exists but its source file doesn't */
export interface GhostEntry {
  sidecarPath: string;
  sourcePath: string;
}

interface WatcherSlice {
  ghostEntries: GhostEntry[];
  setGhostEntries: (entries: GhostEntry[]) => void;
  autoReveal: boolean;
  toggleAutoReveal: () => void;
  lastSaveByPath: Record<string, number>;
  recordSave: (path: string) => void;
}

// ── Update slice ──────────────────────────────────────────────────────

// "error" is treated identically to "idle" by the banner (silent fallback); reserved for future telemetry
export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "ready" | "error";

interface UpdateSlice {
  updateStatus: UpdateStatus;
  updateVersion: string | null;
  updateProgress: number; // 0–100 during download
  setUpdateStatus: (status: UpdateStatus) => void;
  setUpdateVersion: (version: string | null) => void;
  setUpdateProgress: (progress: number) => void;
  dismissUpdate: () => void;
}

// ── Recent slice ──────────────────────────────────────────────────────────

interface RecentSlice {
  recentItems: RecentItem[];
  addRecentItem: (path: string, type: "file" | "folder") => void;
}

// ── Tab persistence helpers ────────────────────────────────────────────────

export function filterStaleTabs(
  tabs: Tab[],
  activeTabPath: string | null,
  existsMap: Map<string, boolean>
): { tabs: Tab[]; activeTabPath: string | null } {
  const validTabs = tabs.filter((t) => existsMap.get(t.path) !== false);
  const validPaths = new Set(validTabs.map((t) => t.path));
  let newActiveTabPath = activeTabPath;
  if (activeTabPath && !validPaths.has(activeTabPath)) {
    newActiveTabPath = validTabs.length > 0 ? validTabs[0].path : null;
  }
  return { tabs: validTabs, activeTabPath: newActiveTabPath };
}

// ── Combined store ─────────────────────────────────────────────────────────

type Store = WorkspaceSlice & TabsSlice & UISlice & UpdateSlice & WatcherSlice & RecentSlice;


export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      // Workspace
      root: null,
      expandedFolders: {},
      setRoot: (root) => set({ root, expandedFolders: {} }),
      toggleFolder: (path) =>
        set((s) => ({
          expandedFolders: { ...s.expandedFolders, [path]: !s.expandedFolders[path] },
        })),
      setFolderExpanded: (path, expanded) =>
        set((s) => ({ expandedFolders: { ...s.expandedFolders, [path]: expanded } })),
      closeFolder: () => set({ root: null, expandedFolders: {} }),

      // Tabs
      tabs: [],
      activeTabPath: null,
      openFile: (path) => {
        const existing = get().tabs.find((t) => t.path === path);
        if (existing) {
          set({ activeTabPath: path });
        } else {
          set((s) => ({ tabs: [...s.tabs, { path, scrollTop: 0 }], activeTabPath: path }));
        }
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
        set({ tabs: newTabs, activeTabPath: newActive, viewModeByTab: restViewModes, lastSaveByPath: restSaveByPath });
      },
      closeAllTabs: () => set({ tabs: [], activeTabPath: null, viewModeByTab: {}, lastSaveByPath: {} }),
      setActiveTab: (path) => set({ activeTabPath: path }),
      setScrollTop: (path, scrollTop) => {
        const tab = get().tabs.find((t) => t.path === path);
        if (!tab || tab.scrollTop === scrollTop) return;
        set((s) => ({
          tabs: s.tabs.map((t) => (t.path === path ? { ...t, scrollTop } : t)),
        }));
      },
      viewModeByTab: {},
      setViewMode: (path, mode) =>
        set((s) => ({
          viewModeByTab: { ...s.viewModeByTab, [path]: mode },
        })),

      // UI
      theme: "system",
      folderPaneWidth: 240,
      commentsPaneVisible: true,
      authorName: "",
      setTheme: (theme) => set({ theme }),
      setFolderPaneWidth: (width) => set({ folderPaneWidth: width }),
      toggleCommentsPane: () => set((s) => ({ commentsPaneVisible: !s.commentsPaneVisible })),
      setAuthorName: (name) => set({ authorName: name }),

      // Watcher
      ghostEntries: [],
      setGhostEntries: (entries) => {
        const current = get().ghostEntries;
        if (
          current.length === entries.length &&
          current.every((e, i) => e.sidecarPath === entries[i].sidecarPath && e.sourcePath === entries[i].sourcePath)
        ) return;
        set({ ghostEntries: entries });
      },
      autoReveal: true,
      toggleAutoReveal: () => set((s) => ({ autoReveal: !s.autoReveal })),
      lastSaveByPath: {},
      recordSave: (path) =>
        set((s) => ({
          lastSaveByPath: { ...s.lastSaveByPath, [path]: Date.now() },
        })),

      // Update
      updateStatus: "idle",
      updateVersion: null,
      updateProgress: 0,
      setUpdateStatus: (status) => set({ updateStatus: status }),
      setUpdateVersion: (version) => set({ updateVersion: version }),
      setUpdateProgress: (progress) => set({ updateProgress: progress }),
      dismissUpdate: () => set({ updateStatus: "idle", updateVersion: null, updateProgress: 0 }),

      // Recent items
      recentItems: [],
      addRecentItem: (path, type) =>
        set((s) => {
          const filtered = s.recentItems.filter((item) => item.path !== path);
          const newItem: RecentItem = { path, type, timestamp: Date.now() };
          const updated = [newItem, ...filtered].slice(0, MAX_RECENT_ITEMS);
          return { recentItems: updated };
        }),
    }),
    {
      name: "mdownreview-ui",
      // Only persist UI state, not comments (those live in sidecar files)
      partialize: (state) => ({
        theme: state.theme,
        folderPaneWidth: state.folderPaneWidth,
        commentsPaneVisible: state.commentsPaneVisible,
        root: state.root,
        expandedFolders: state.expandedFolders,
        autoReveal: state.autoReveal,
        authorName: state.authorName,
        recentItems: state.recentItems,
        tabs: state.tabs,
        activeTabPath: state.activeTabPath,
      }),
      onRehydrateStorage: () => () => {
        queueMicrotask(() => {
          const { tabs } = useStore.getState();
          if (tabs.length === 0) return;
          import("@/lib/tauri-commands").then(
            ({ checkPathExists }) => validatePersistedTabs(checkPathExists),
            () => {}
          );
        });
      },
    }
  )
);

export async function validatePersistedTabs(
  checkPath: (path: string) => Promise<"file" | "dir" | "missing">
): Promise<void> {
  const { tabs, activeTabPath } = useStore.getState();
  if (tabs.length === 0) return;
  const existsMap = new Map<string, boolean>();
  await Promise.all(
    tabs.map(async (tab) => {
      const status = await checkPath(tab.path);
      existsMap.set(tab.path, status !== "missing");
    })
  );
  const result = filterStaleTabs(tabs, activeTabPath, existsMap);
  useStore.setState(result);
}

// Convenience selector for update state
export function useUpdateState() {
  return useStore(
    useShallow((s) => ({
      updateStatus: s.updateStatus,
      updateVersion: s.updateVersion,
      updateProgress: s.updateProgress,
      setUpdateStatus: s.setUpdateStatus,
      setUpdateProgress: s.setUpdateProgress,
      dismissUpdate: s.dismissUpdate,
    }))
  );
}

// Action to open files and folders from CLI args
export function openFilesFromArgs(
  files: string[],
  folders: string[],
  store: ReturnType<typeof useStore.getState>
) {
  // Last folder wins (spec requirement)
  if (folders.length > 0) {
    const lastFolder = folders[folders.length - 1];
    store.setRoot(lastFolder);
    store.addRecentItem(lastFolder, "folder");
  }
  const alreadyOpen = new Set(store.tabs.map((t) => t.path));
  // Deduplicate incoming files
  const unique = [...new Set(files)];
  for (const file of unique) {
    if (!alreadyOpen.has(file)) {
      store.openFile(file);
      alreadyOpen.add(file);
    }
    store.addRecentItem(file, "file");
  }
}
