import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/shallow";
import type { MrsfComment } from "@/lib/tauri-commands";
import { generateCommentId } from "@/lib/comment-utils";

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
  collapseAll: () => void;
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

// ── Comments slice ─────────────────────────────────────────────────────────

export interface CommentWithOrphan extends MrsfComment {
  isOrphaned?: boolean;
  matchedLineNumber?: number;
}

interface CommentsSlice {
  commentsByFile: Record<string, CommentWithOrphan[]>;
  authorName: string;
  setAuthorName: (name: string) => void;
  setFileComments: (filePath: string, comments: CommentWithOrphan[]) => void;
  addComment: (filePath: string, anchor: Partial<Pick<MrsfComment, "line" | "end_line" | "start_column" | "end_column" | "selected_text" | "selected_text_hash" | "commit" | "type" | "severity">>, text: string) => void;
  addReply: (filePath: string, parentId: string, text: string) => void;
  editComment: (id: string, text: string) => void;
  deleteComment: (id: string) => void;
  resolveComment: (id: string) => void;
  unresolveComment: (id: string) => void;
}

/** Find which file path contains a comment with the given ID. */
function findFileForComment(
  commentsByFile: Record<string, CommentWithOrphan[]>,
  id: string
): string | undefined {
  for (const [fp, comments] of Object.entries(commentsByFile)) {
    if (comments.some((c) => c.id === id)) return fp;
  }
  return undefined;
}

// ── UI slice ──────────────────────────────────────────────────────────────

type Theme = "system" | "light" | "dark";

interface UISlice {
  theme: Theme;
  folderPaneWidth: number;
  commentsPaneVisible: boolean;
  setTheme: (theme: Theme) => void;
  setFolderPaneWidth: (width: number) => void;
  toggleCommentsPane: () => void;
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

type Store = WorkspaceSlice & TabsSlice & CommentsSlice & UISlice & UpdateSlice & WatcherSlice & RecentSlice;


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
      collapseAll: () => set({ expandedFolders: {} }),
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
      setScrollTop: (path, scrollTop) =>
        set((s) => ({
          tabs: s.tabs.map((t) => (t.path === path ? { ...t, scrollTop } : t)),
        })),
      viewModeByTab: {},
      setViewMode: (path, mode) =>
        set((s) => ({
          viewModeByTab: { ...s.viewModeByTab, [path]: mode },
        })),

      // Comments
      commentsByFile: {},
      authorName: "",
      setAuthorName: (name) => set({ authorName: name }),
      setFileComments: (filePath, comments) =>
        set((s) => ({ commentsByFile: { ...s.commentsByFile, [filePath]: comments } })),
      addComment: (filePath, anchor, text) => {
        const state = get();
        const comment: CommentWithOrphan = {
          id: generateCommentId(),
          author: state.authorName || "Anonymous",
          timestamp: new Date().toISOString(),
          text,
          resolved: false,
          ...anchor,
        };
        set((s) => ({
          commentsByFile: {
            ...s.commentsByFile,
            [filePath]: [...(s.commentsByFile[filePath] ?? []), comment],
          },
        }));
      },
      addReply: (filePath, parentId, text) => {
        const state = get();
        const parent = Object.values(state.commentsByFile)
          .flat()
          .find((c) => c.id === parentId);
        const reply: CommentWithOrphan = {
          id: generateCommentId(),
          author: state.authorName || "Anonymous",
          timestamp: new Date().toISOString(),
          text,
          resolved: false,
          reply_to: parentId,
          line: parent?.line,
        };
        set((s) => ({
          commentsByFile: {
            ...s.commentsByFile,
            [filePath]: [...(s.commentsByFile[filePath] ?? []), reply],
          },
        }));
      },
      editComment: (id, text) =>
        set((s) => {
          const fp = findFileForComment(s.commentsByFile, id);
          if (!fp) return s;
          return {
            commentsByFile: {
              ...s.commentsByFile,
              [fp]: s.commentsByFile[fp].map((c) => (c.id === id ? { ...c, text } : c)),
            },
          };
        }),
      deleteComment: (id) =>
        set((s) => {
          const fp = findFileForComment(s.commentsByFile, id);
          if (!fp) return s;
          const comments = s.commentsByFile[fp];
          const parent = comments.find((c) => c.id === id);
          if (!parent) return s;

          // MRSF §9.1: Promote direct replies before removing parent
          const promoted = comments.map((c) => {
            if (c.reply_to !== id) return c;
            const updated = { ...c };

            // Copy targeting fields from parent if reply omits them
            if (updated.line === undefined && parent.line !== undefined)
              updated.line = parent.line;
            if (updated.end_line === undefined && parent.end_line !== undefined)
              updated.end_line = parent.end_line;
            if (updated.start_column === undefined && parent.start_column !== undefined)
              updated.start_column = parent.start_column;
            if (updated.end_column === undefined && parent.end_column !== undefined)
              updated.end_column = parent.end_column;
            // Only copy selected_text + hash together to avoid mismatched pairs
            if (updated.selected_text === undefined && parent.selected_text !== undefined) {
              updated.selected_text = parent.selected_text;
              if (parent.selected_text_hash !== undefined)
                updated.selected_text_hash = parent.selected_text_hash;
            }

            // Reparent to grandparent (or remove reply_to if parent was root)
            updated.reply_to = parent.reply_to;
            if (!updated.reply_to) delete updated.reply_to;

            return updated;
          });

          return {
            commentsByFile: {
              ...s.commentsByFile,
              [fp]: promoted.filter((c) => c.id !== id),
            },
          };
        }),
      resolveComment: (id) =>
        set((s) => {
          const fp = findFileForComment(s.commentsByFile, id);
          if (!fp) return s;
          return {
            commentsByFile: {
              ...s.commentsByFile,
              [fp]: s.commentsByFile[fp].map((c) => (c.id === id ? { ...c, resolved: true } : c)),
            },
          };
        }),
      unresolveComment: (id) =>
        set((s) => {
          const fp = findFileForComment(s.commentsByFile, id);
          if (!fp) return s;
          return {
            commentsByFile: {
              ...s.commentsByFile,
              [fp]: s.commentsByFile[fp].map((c) => (c.id === id ? { ...c, resolved: false } : c)),
            },
          };
        }),

      // UI
      theme: "system",
      folderPaneWidth: 240,
      commentsPaneVisible: true,
      setTheme: (theme) => set({ theme }),
      setFolderPaneWidth: (width) => set({ folderPaneWidth: width }),
      toggleCommentsPane: () => set((s) => ({ commentsPaneVisible: !s.commentsPaneVisible })),

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

// Convenience selector for unresolved comment count per file
export function useUnresolvedCount(filePath: string): number {
  return useStore((s) =>
    (s.commentsByFile[filePath] ?? []).filter((c) => !c.resolved).length
  );
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
