import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/shallow";
import {
  cliShimStatus as ipcCliShimStatus,
  defaultHandlerStatus as ipcDefaultHandlerStatus,
  folderContextStatus as ipcFolderContextStatus,
  installCliShim as ipcInstallCliShim,
  onboardingMarkWelcomed as ipcMarkWelcomed,
  onboardingState as ipcOnboardingState,
  registerFolderContext as ipcRegisterFolderContext,
  removeCliShim as ipcRemoveCliShim,
  setDefaultHandler as ipcSetDefaultHandler,
  unregisterFolderContext as ipcUnregisterFolderContext,
  type CliShimError,
  type OnboardingState,
} from "@/lib/tauri-commands";
import {
  createTabsSlice,
  filterStaleTabs,
  MAX_TABS,
  type TabsSlice,
  type Tab,
  type FileMeta,
} from "./tabs";
import { createViewerPrefsSlice, type ViewerPrefsSlice } from "./viewerPrefs";
import { createTabHistorySlice, type TabHistorySlice } from "./tabHistory";
import { createCommentsSlice, type CommentsSlice } from "./comments";

export type { OnboardingState, Tab, TabsSlice, FileMeta };
export { MAX_TABS, filterStaleTabs };

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
// Defined in `./tabs.ts` (extracted to keep this file under the 500-line
// shared-chokepoint cap — rule 23 in `docs/architecture.md`).

// ── UI slice ──────────────────────────────────────────────────────────────

type Theme = "system" | "light" | "dark";

interface UISlice {
  theme: Theme;
  folderPaneWidth: number;
  commentsPaneVisible: boolean;
  authorName: string;
  /** Reading column width (CSS pixels). Persisted. Clamped to [400, 1600]. */
  readingWidth: number;
  /** Transient: ID of the comment thread being re-anchored, or null. NOT persisted. */
  moveAnchorTarget: string | null;
  /**
   * Transient: file path whose `CommentsPanel` should auto-open its inline
   * file-level input on the next render. Cleared by the panel after it
   * consumes the request. Iter 5 Group B — entry points for File anchors.
   * NOT persisted (never carried across reloads).
   */
  pendingFileLevelInputFor: string | null;
  setTheme: (theme: Theme) => void;
  setFolderPaneWidth: (width: number) => void;
  toggleCommentsPane: () => void;
  setAuthorName: (name: string) => void;
  setReadingWidth: (n: number) => void;
  setMoveAnchorTarget: (id: string | null) => void;
  requestFileLevelInput: (filePath: string) => void;
  clearFileLevelInput: () => void;
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
  lastSaveByPath: Record<string, number>;
  recordSave: (path: string) => void;
}

// ── Update slice ──────────────────────────────────────────────────────

// "error" is treated identically to "idle" by the banner (silent fallback); reserved for future telemetry
export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "ready" | "error";
export type UpdateChannel = "stable" | "canary";

interface UpdateSlice {
  updateStatus: UpdateStatus;
  updateVersion: string | null;
  updateProgress: number; // 0–100 during download
  updateChannel: UpdateChannel;
  setUpdateStatus: (status: UpdateStatus) => void;
  setUpdateVersion: (version: string | null) => void;
  setUpdateProgress: (progress: number) => void;
  setUpdateChannel: (channel: UpdateChannel) => void;
  dismissUpdate: () => void;
}

// ── Recent slice ──────────────────────────────────────────────────────────

interface RecentSlice {
  recentItems: RecentItem[];
  addRecentItem: (path: string, type: "file" | "folder") => void;
}

// ── Onboarding slice ──────────────────────────────────────────────────────

export type OnboardingStatus = "pending" | "done" | "unsupported" | "error";

export interface OnboardingStatuses {
  cliShim: OnboardingStatus;
  defaultHandler: OnboardingStatus;
  folderContext: OnboardingStatus;
}

/** Section keys used as map keys in onboardingErrors. */
export type OnboardingSectionKey = "cliShim" | "defaultHandler" | "folderContext";

interface OnboardingSlice {
  // Read state
  onboardingStatuses: OnboardingStatuses;
  onboardingState: OnboardingState | null;
  onboardingErrors: Record<string, string>;
  // Panel visibility (transient, not persisted)
  welcomePanelOpen: boolean;
  setupPanelOpen: boolean;
  // Actions
  refreshOnboarding: () => Promise<void>;
  openWelcome: () => void;
  closeWelcome: () => void;
  openSetup: () => void;
  closeSetup: () => void;
  markOnboardingWelcomed: (version: string) => Promise<void>;
  dismissOnboardingWelcome: () => void;
  installCliShim: () => Promise<void>;
  removeCliShim: () => Promise<void>;
  setDefaultHandler: () => Promise<void>;
  registerFolderContext: () => Promise<void>;
  unregisterFolderContext: () => Promise<void>;
}

// ── Combined store ─────────────────────────────────────────────────────────

export type Store = WorkspaceSlice & TabsSlice & UISlice & UpdateSlice & WatcherSlice & RecentSlice & OnboardingSlice & ViewerPrefsSlice & TabHistorySlice & CommentsSlice;


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

      // Tabs (delegated to ./tabs.ts)
      ...createTabsSlice(set, get),

      // ViewerPrefs (delegated to ./viewerPrefs.ts).
      // - `allowedRemoteImageDocs` is intentionally NOT in `partialize` below:
      //   trust decisions must not silently survive an app restart.
      // - `zoomByFiletype` IS persisted (small bounded map, one entry per
      //   filetype key) — see partialize.
      ...createViewerPrefsSlice(set, get),

      // TabHistory (delegated to ./tabHistory.ts) — per-window back/forward.
      // Intentionally NOT added to `partialize` below (session-only).
      ...createTabHistorySlice(set, get),

      // Comments (F1 nav state). Session-only — never persisted.
      ...createCommentsSlice(set, get),

      // UI
      theme: "system",
      folderPaneWidth: 240,
      commentsPaneVisible: true,
      authorName: "",
      readingWidth: 720,
      moveAnchorTarget: null,
      pendingFileLevelInputFor: null,
      setTheme: (theme) => set({ theme }),
      setFolderPaneWidth: (width) => set({ folderPaneWidth: width }),
      toggleCommentsPane: () => set((s) => ({ commentsPaneVisible: !s.commentsPaneVisible })),
      setAuthorName: (name) => set({ authorName: name }),
      setReadingWidth: (n) => set({ readingWidth: Math.max(400, Math.min(1600, n)) }),
      setMoveAnchorTarget: (id) => set({ moveAnchorTarget: id }),
      requestFileLevelInput: (filePath) => set({ pendingFileLevelInputFor: filePath }),
      clearFileLevelInput: () => set({ pendingFileLevelInputFor: null }),

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
      lastSaveByPath: {},
      recordSave: (path) =>
        set((s) => ({
          lastSaveByPath: { ...s.lastSaveByPath, [path]: Date.now() },
        })),

      // Update
      updateStatus: "idle",
      updateVersion: null,
      updateProgress: 0,
      updateChannel: "stable" as UpdateChannel,
      setUpdateStatus: (status) => set({ updateStatus: status }),
      setUpdateVersion: (version) => set({ updateVersion: version }),
      setUpdateProgress: (progress) => set({ updateProgress: progress }),
      setUpdateChannel: (channel) => set({ updateChannel: channel }),
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

      // Onboarding
      onboardingStatuses: { cliShim: "pending", defaultHandler: "pending", folderContext: "pending" },
      onboardingState: null,
      onboardingErrors: {},
      welcomePanelOpen: false,
      setupPanelOpen: false,
      refreshOnboarding: async () => {
        const [cli, def, folder, state] = await Promise.allSettled([
          ipcCliShimStatus(),
          ipcDefaultHandlerStatus(),
          ipcFolderContextStatus(),
          ipcOnboardingState(),
        ]);
        // Refresh records errors for status reads that fail; it does NOT clear
        // action errors (those are cleared by the action wrapper on success).
        const errors: Record<string, string> = { ...get().onboardingErrors };
        const mapStatus = (
          r: PromiseSettledResult<string>,
          key: OnboardingSectionKey,
        ): OnboardingStatus => {
          if (r.status === "rejected") {
            errors[key] = formatOnboardingError(r.reason);
            return "error";
          }
          if (r.value === "done") return "done";
          if (r.value === "unsupported") return "unsupported";
          return "pending";
        };
        set({
          onboardingStatuses: {
            cliShim: mapStatus(cli, "cliShim"),
            defaultHandler: mapStatus(def, "defaultHandler"),
            folderContext: mapStatus(folder, "folderContext"),
          },
          onboardingState: state.status === "fulfilled" ? state.value : get().onboardingState,
          onboardingErrors: errors,
        });
      },
      openWelcome: () => set({ welcomePanelOpen: true, setupPanelOpen: false }),
      closeWelcome: () => set({ welcomePanelOpen: false }),
      openSetup: () => set({ welcomePanelOpen: false, setupPanelOpen: true }),
      closeSetup: () => set({ setupPanelOpen: false }),
      markOnboardingWelcomed: async (version) => {
        await ipcMarkWelcomed(version);
        await useStore.getState().refreshOnboarding();
      },
      dismissOnboardingWelcome: () => set({ welcomePanelOpen: false }),
      installCliShim: () => runOnboardingAction("cliShim", ipcInstallCliShim),
      removeCliShim: () => runOnboardingAction("cliShim", ipcRemoveCliShim),
      setDefaultHandler: () => runOnboardingAction("defaultHandler", ipcSetDefaultHandler),
      registerFolderContext: () => runOnboardingAction("folderContext", ipcRegisterFolderContext),
      unregisterFolderContext: () => runOnboardingAction("folderContext", ipcUnregisterFolderContext),
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
        authorName: state.authorName,
        readingWidth: state.readingWidth,
        recentItems: state.recentItems,
        tabs: state.tabs,
        activeTabPath: state.activeTabPath,
        updateChannel: state.updateChannel,
        zoomByFiletype: state.zoomByFiletype,
      }),
      onRehydrateStorage: () => () => {
        queueMicrotask(() => {
          const { tabs, activeTabPath } = useStore.getState();
          if (tabs.length === 0) return;
          // Enforce MAX_TABS immediately at rehydrate time so the cap holds
          // even if every persisted file still exists (validatePersistedTabs
          // also enforces it after the existence check).
          if (tabs.length > MAX_TABS) {
            const trimmed = filterStaleTabs(tabs, activeTabPath, new Map());
            useStore.setState(trimmed);
          }
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

// ── Onboarding helpers ────────────────────────────────────────────────────

function isCliShimError(r: unknown): r is CliShimError {
  if (typeof r !== "object" || r === null || !("kind" in r)) return false;
  const kind = (r as { kind: unknown }).kind;
  return kind === "permission_denied" || kind === "io";
}

/** Convert any IPC rejection into a user-facing error string. */
export function formatOnboardingError(reason: unknown): string {
  if (isCliShimError(reason)) {
    switch (reason.kind) {
      case "permission_denied":
        return `Permission denied — try \`sudo ln -sf ${reason.target} ${reason.path}\``;
      case "io":
        return reason.message;
      default: {
        const _exhaustive: never = reason;
        return String(_exhaustive);
      }
    }
  }
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

/**
 * Run a per-section onboarding command and chain a status refresh on settle.
 * Mirrors `useMenuListeners` (`getState()` for actions) so action chaining
 * stays inside the slice without re-invoking commands.
 */
async function runOnboardingAction(
  sectionKey: OnboardingSectionKey,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
    // Clear any prior error for this section on success.
    const { onboardingErrors } = useStore.getState();
    if (onboardingErrors[sectionKey]) {
      const next = { ...onboardingErrors };
      delete next[sectionKey];
      useStore.setState({ onboardingErrors: next });
    }
  } catch (err) {
    const { onboardingErrors } = useStore.getState();
    useStore.setState({
      onboardingErrors: { ...onboardingErrors, [sectionKey]: formatOnboardingError(err) },
    });
  } finally {
    await useStore.getState().refreshOnboarding();
  }
}

// Convenience selector for update state
export function useUpdateState() {
  return useStore(
    useShallow((s) => ({
      updateStatus: s.updateStatus,
      updateVersion: s.updateVersion,
      updateProgress: s.updateProgress,
      updateChannel: s.updateChannel,
      setUpdateStatus: s.setUpdateStatus,
      setUpdateProgress: s.setUpdateProgress,
      setUpdateChannel: s.setUpdateChannel,
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
