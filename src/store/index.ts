import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/shallow";
import type { ReviewComment } from "@/lib/tauri-commands";

// ── Workspace slice ────────────────────────────────────────────────────────

interface WorkspaceSlice {
  root: string | null;
  expandedFolders: Record<string, boolean>;
  setRoot: (root: string | null) => void;
  toggleFolder: (path: string) => void;
  setFolderExpanded: (path: string, expanded: boolean) => void;
  collapseAll: () => void;
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

export interface CommentWithOrphan extends ReviewComment {
  isOrphaned?: boolean;
  matchedLineNumber?: number; // resolved position after matching algorithm
}

interface CommentsSlice {
  commentsByFile: Record<string, CommentWithOrphan[]>;
  setFileComments: (filePath: string, comments: CommentWithOrphan[]) => void;
  addComment: (filePath: string, anchor: Omit<CommentWithOrphan, "id" | "createdAt" | "resolved" | "text" | "isOrphaned">, text: string) => void;
  editComment: (id: string, text: string) => void;
  deleteComment: (id: string) => void;
  resolveComment: (id: string) => void;
  unresolveComment: (id: string) => void;
  addResponse: (commentId: string, author: string, text: string) => void;
}

// ── UI slice ──────────────────────────────────────────────────────────────

type Theme = "system" | "light" | "dark";

interface UISlice {
  theme: Theme;
  folderPaneWidth: number;
  folderPaneVisible: boolean;
  commentsPaneVisible: boolean;
  setTheme: (theme: Theme) => void;
  setFolderPaneWidth: (width: number) => void;
  toggleFolderPane: () => void;
  toggleCommentsPane: () => void;
}

// ── Combined store ─────────────────────────────────────────────────────────

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

// ── Combined store ─────────────────────────────────────────────────────────

type Store = WorkspaceSlice & TabsSlice & CommentsSlice & UISlice & UpdateSlice;

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

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
        const { [path]: _, ...restViewModes } = get().viewModeByTab;
        set({ tabs: newTabs, activeTabPath: newActive, viewModeByTab: restViewModes });
      },
      closeAllTabs: () => set({ tabs: [], activeTabPath: null, viewModeByTab: {} }),
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
      setFileComments: (filePath, comments) =>
        set((s) => ({ commentsByFile: { ...s.commentsByFile, [filePath]: comments } })),
      addComment: (filePath, anchor, text) => {
        const comment: CommentWithOrphan = {
          ...anchor,
          id: generateId(),
          text,
          createdAt: new Date().toISOString(),
          resolved: false,
        };
        set((s) => ({
          commentsByFile: {
            ...s.commentsByFile,
            [filePath]: [...(s.commentsByFile[filePath] ?? []), comment],
          },
        }));
      },
      editComment: (id, text) =>
        set((s) => ({
          commentsByFile: Object.fromEntries(
            Object.entries(s.commentsByFile).map(([fp, comments]) => [
              fp,
              comments.map((c) => (c.id === id ? { ...c, text } : c)),
            ])
          ),
        })),
      deleteComment: (id) =>
        set((s) => ({
          commentsByFile: Object.fromEntries(
            Object.entries(s.commentsByFile).map(([fp, comments]) => [
              fp,
              comments.filter((c) => c.id !== id),
            ])
          ),
        })),
      resolveComment: (id) =>
        set((s) => ({
          commentsByFile: Object.fromEntries(
            Object.entries(s.commentsByFile).map(([fp, comments]) => [
              fp,
              comments.map((c) => (c.id === id ? { ...c, resolved: true } : c)),
            ])
          ),
        })),
      unresolveComment: (id) =>
        set((s) => ({
          commentsByFile: Object.fromEntries(
            Object.entries(s.commentsByFile).map(([fp, comments]) => [
              fp,
              comments.map((c) => (c.id === id ? { ...c, resolved: false } : c)),
            ])
          ),
        })),
      addResponse: (commentId, author, text) =>
        set((s) => ({
          commentsByFile: Object.fromEntries(
            Object.entries(s.commentsByFile).map(([fp, comments]) => [
              fp,
              comments.map((c) =>
                c.id === commentId
                  ? {
                      ...c,
                      responses: [
                        ...(c.responses ?? []),
                        { author, text, createdAt: new Date().toISOString() },
                      ],
                    }
                  : c
              ),
            ])
          ),
        })),

      // UI
      theme: "system",
      folderPaneWidth: 240,
      folderPaneVisible: true,
      commentsPaneVisible: true,
      setTheme: (theme) => set({ theme }),
      setFolderPaneWidth: (width) => set({ folderPaneWidth: width }),
      toggleFolderPane: () => set((s) => ({ folderPaneVisible: !s.folderPaneVisible })),
      toggleCommentsPane: () => set((s) => ({ commentsPaneVisible: !s.commentsPaneVisible })),

      // Update
      updateStatus: "idle",
      updateVersion: null,
      updateProgress: 0,
      setUpdateStatus: (status) => set({ updateStatus: status }),
      setUpdateVersion: (version) => set({ updateVersion: version }),
      setUpdateProgress: (progress) => set({ updateProgress: progress }),
      dismissUpdate: () => set({ updateStatus: "idle", updateVersion: null, updateProgress: 0 }),
    }),
    {
      name: "mdownreview-ui",
      // Only persist UI state, not comments (those live in sidecar files)
      partialize: (state) => ({
        theme: state.theme,
        folderPaneWidth: state.folderPaneWidth,
        folderPaneVisible: state.folderPaneVisible,
        commentsPaneVisible: state.commentsPaneVisible,
        root: state.root,
        expandedFolders: state.expandedFolders,
      }),
    }
  )
);

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
  if (folders.length > 0) {
    store.setRoot(folders[0]);
  }
  const alreadyOpen = new Set(store.tabs.map((t) => t.path));
  // Deduplicate incoming files
  const unique = [...new Set(files)];
  for (const file of unique) {
    if (!alreadyOpen.has(file)) {
      store.openFile(file);
      alreadyOpen.add(file);
    }
  }
}
