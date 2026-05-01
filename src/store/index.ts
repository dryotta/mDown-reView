import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/shallow";
import {
  cliShimStatus as ipcCliShimStatus,
  defaultHandlerStatus as ipcDefaultHandlerStatus,
  installCliShim as ipcInstallCliShim,
  onboardingState as ipcOnboardingState,
  removeCliShim as ipcRemoveCliShim,
  setDefaultHandler as ipcSetDefaultHandler,
  type CliShimError,
  type DefaultHandlerStatus,
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
import { createMermaidPopoutSlice, type MermaidPopoutSlice } from "./mermaidPopoutSlice";
import { migrateV1StripVerbatim } from "./migrations/v1-strip-verbatim";
import { canonicalizeOrFallback } from "./canonicalize";

export type { OnboardingState, Tab, TabsSlice, FileMeta };
export { MAX_TABS, filterStaleTabs };

// ── Recent items ──────────────────────────────────────────────────────────

export interface RecentItem {
  path: string;
  type: "file" | "folder";
  timestamp: number;
}

const MAX_RECENT_ITEMS = 5;

// ── Pending-compose seed ──────────────────────────────────────────────────
//
// Authoring is panel-only: every entry point (selection toolbar, source
// gutter `+` button, markdown gutter click on an empty block, the
// Ctrl/Cmd+Shift+M shortcut) seeds a request through this shape. The
// `anchor` mirrors the wire `CommentAnchor` (line is required; the rest
// optional for a full-line/block-level seed). The `draftKey` overrides
// the per-anchor fingerprint default so concurrent seeds for the same
// line (e.g. selection composer vs. line composer) don't collide.
export interface PendingLineCompose {
  filePath: string;
  anchor: {
    line: number;
    end_line?: number;
    start_column?: number;
    end_column?: number;
    selected_text?: string;
    selected_text_hash?: string;
  };
  draftKey?: string;
}

// ── Workspace slice ────────────────────────────────────────────────────────

interface WorkspaceSlice {
  root: string | null;
  expandedFolders: Record<string, boolean>;
  /**
   * Set the workspace root. Canonicalises the incoming path via the Rust
   * IPC so the stored form matches what `scan_review_files` emits (long
   * form, no `\\?\` verbatim prefix) — without this, ghost-entry detection
   * fails on Windows paths in 8.3 short-name form (e.g. `RUNNER~1`).
   * Returns a Promise that callers SHOULD await before relying on the
   * stored value, but workspace-open flows tolerate missed awaits because
   * the canonicalised value just lands a moment later.
   */
  setRoot: (root: string | null) => Promise<void>;
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
  /**
   * Transient: file path whose `CommentsPanel` should auto-open its inline
   * file-level input on the next render. Cleared by the panel after it
   * consumes the request. Iter 5 Group B — entry points for File anchors.
   * NOT persisted (never carried across reloads).
   */
  pendingFileLevelInputFor: string | null;
  /**
   * Transient: a request to seed a line-anchored composer in the
   * `CommentsPanel` (and auto-open the panel). Set by the selection
   * toolbar, source-view gutter `+` button, markdown gutter click on an
   * empty block, and the Ctrl/Cmd+Shift+M shortcut. Consumed once by the
   * panel on its next render. NOT persisted.
   */
  pendingLineCompose: PendingLineCompose | null;
  /**
   * Transient: a `{path, fragment}` request to scroll the next viewer for
   * `path` to the given heading id. Set by viewer link handlers when they
   * open another file (or the same file) with a `#fragment`. Consumed by
   * the destination viewer (markdown or HTML iframe) once its content has
   * rendered. NOT persisted.
   */
  pendingFragment: { path: string; fragment: string } | null;
  setTheme: (theme: Theme) => void;
  setFolderPaneWidth: (width: number) => void;
  toggleCommentsPane: () => void;
  setAuthorName: (name: string) => void;
  setReadingWidth: (n: number) => void;
  requestFileLevelInput: (filePath: string) => void;
  clearFileLevelInput: () => void;
  /**
   * Seed a line-anchored composer in the panel and force the panel
   * visible. The panel renders a `CommentInput` against the supplied
   * anchor on its next render, then calls `clearLineCompose` once the
   * input has been mounted (so reload mid-typing recovers via the
   * draft store, not via this transient flag).
   */
  requestLineCompose: (req: PendingLineCompose) => void;
  clearLineCompose: () => void;
  setPendingFragment: (entry: { path: string; fragment: string } | null) => void;
  /** Returns + clears the pending fragment iff its path matches; else null. */
  consumePendingFragment: (path: string) => string | null;
  /** When true, .review.yaml/.review.json files appear in the folder tree. */
  showSidecarFiles: boolean;
  toggleShowSidecarFiles: () => void;
  /** Controls visibility of the sidecar config dialog. */
  sidecarConfigDialogOpen: boolean;
  openSidecarConfig: () => void;
  closeSidecarConfig: () => void;
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
}

/** Section keys used as map keys in onboardingErrors. */
export type OnboardingSectionKey = "cliShim" | "defaultHandler";

interface OnboardingSlice {
  // Read state
  onboardingStatuses: OnboardingStatuses;
  /** Raw value from `default_handler_status` IPC — preserves "other"/"unknown" distinction. */
  defaultHandlerRawStatus: DefaultHandlerStatus | null;
  onboardingState: OnboardingState | null;
  onboardingErrors: Record<string, string>;
  /**
   * Settings dialog visibility (issue #160).
   *
   * `true` → `<SettingsView/>` is mounted as a `<dialog>` over the
   * content area. NOT persisted (transient UI state).
   */
  settingsDialogOpen: boolean;
  // Actions
  refreshOnboarding: () => Promise<void>;
  openSettings: () => void;
  closeSettings: () => void;
  installCliShim: () => Promise<void>;
  removeCliShim: () => Promise<void>;
  setDefaultHandler: () => Promise<void>;
}

// ── Combined store ─────────────────────────────────────────────────────────

export type Store = WorkspaceSlice &
  TabsSlice &
  UISlice &
  UpdateSlice &
  WatcherSlice &
  RecentSlice &
  OnboardingSlice &
  ViewerPrefsSlice &
  TabHistorySlice &
  CommentsSlice &
  MermaidPopoutSlice;

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      // Workspace
      root: null,
      expandedFolders: {},
      setRoot: async (root) => {
        if (root === null) {
          set({ root: null, expandedFolders: {} });
          get().closeMermaidPopout();
          return;
        }
        const canonical = await canonicalizeOrFallback(root);
        set({ root: canonical, expandedFolders: {} });
        get().closeMermaidPopout();
      },
      toggleFolder: (path) =>
        set((s) => ({
          expandedFolders: { ...s.expandedFolders, [path]: !s.expandedFolders[path] },
        })),
      setFolderExpanded: (path, expanded) =>
        set((s) => ({ expandedFolders: { ...s.expandedFolders, [path]: expanded } })),
      closeFolder: () => { set({ root: null, expandedFolders: {} }); get().closeMermaidPopout(); },

      // Tabs (delegated to ./tabs.ts)
      ...createTabsSlice(set, get),

      // ViewerPrefs (delegated to ./viewerPrefs.ts).
      // - `allowedRemoteImageDocs` is intentionally NOT in `partialize` below:
      //   trust decisions must not silently survive an app restart.
      // - `zoomByFiletype` is intentionally NOT in `partialize`: zoom is
      //   per-window session-only state (persisting/syncing it causes a
      //   storage-event ping-pong loop between windows).
      ...createViewerPrefsSlice(set, get),

      // TabHistory (delegated to ./tabHistory.ts) — per-window back/forward.
      // Intentionally NOT added to `partialize` below (session-only).
      ...createTabHistorySlice(set, get),

      // Comments (F1 nav state). Session-only — never persisted.
      ...createCommentsSlice(set, get),

      // MermaidPopout (./mermaidPopoutSlice.ts) — session-only; NOT in partialize.
      ...createMermaidPopoutSlice(set, get),

      // UI
      theme: "system",
      folderPaneWidth: 240,
      commentsPaneVisible: true,
      authorName: "",
      readingWidth: 720,
      pendingFileLevelInputFor: null,
      pendingLineCompose: null,
      pendingFragment: null,
      setTheme: (theme) => set({ theme }),
      setFolderPaneWidth: (width) =>
        set((s) => (s.folderPaneWidth === width ? s : { folderPaneWidth: width })),
      toggleCommentsPane: () => { get().closeMermaidPopout(); set((s) => ({ commentsPaneVisible: !s.commentsPaneVisible })); },
      setAuthorName: (name) => set({ authorName: name }),
      setReadingWidth: (n) => set({ readingWidth: Math.max(400, Math.min(1600, n)) }),
      requestFileLevelInput: (filePath) =>
        set({ pendingFileLevelInputFor: filePath, commentsPaneVisible: true }),
      clearFileLevelInput: () => set({ pendingFileLevelInputFor: null }),
      requestLineCompose: (req) => set({ pendingLineCompose: req, commentsPaneVisible: true }),
      clearLineCompose: () => set({ pendingLineCompose: null }),
      setPendingFragment: (entry) => set({ pendingFragment: entry }),
      consumePendingFragment: (path) => {
        const pending = get().pendingFragment;
        if (!pending || pending.path !== path) return null;
        set({ pendingFragment: null });
        return pending.fragment;
      },
      showSidecarFiles: false,
      toggleShowSidecarFiles: () => set((s) => ({ showSidecarFiles: !s.showSidecarFiles })),
      sidecarConfigDialogOpen: false,
      openSidecarConfig: () => set({ sidecarConfigDialogOpen: true }),
      closeSidecarConfig: () => set({ sidecarConfigDialogOpen: false }),

      // Watcher
      ghostEntries: [],
      setGhostEntries: (entries) => {
        const current = get().ghostEntries;
        if (
          current.length === entries.length &&
          current.every(
            (e, i) =>
              e.sidecarPath === entries[i].sidecarPath && e.sourcePath === entries[i].sourcePath
          )
        )
          return;
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
      onboardingStatuses: { cliShim: "pending", defaultHandler: "pending" },
      defaultHandlerRawStatus: null,
      onboardingState: null,
      onboardingErrors: {},
      settingsDialogOpen: false,
      refreshOnboarding: async () => {
        const [cli, def, state] = await Promise.allSettled([
          ipcCliShimStatus(),
          ipcDefaultHandlerStatus(),
          ipcOnboardingState(),
        ]);
        // Refresh records errors for status reads that fail; it does NOT clear
        // action errors (those are cleared by the action wrapper on success).
        const errors: Record<string, string> = { ...get().onboardingErrors };
        const mapStatus = (
          r: PromiseSettledResult<string>,
          key: OnboardingSectionKey
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
          },
          defaultHandlerRawStatus:
            def.status === "fulfilled"
              ? (def.value as DefaultHandlerStatus)
              : get().defaultHandlerRawStatus,
          onboardingState: state.status === "fulfilled" ? state.value : get().onboardingState,
          onboardingErrors: errors,
        });
      },
      openSettings: () => set({ settingsDialogOpen: true }),
      closeSettings: () => set({ settingsDialogOpen: false }),
      installCliShim: () => runOnboardingAction("cliShim", ipcInstallCliShim),
      removeCliShim: () => runOnboardingAction("cliShim", ipcRemoveCliShim),
      setDefaultHandler: () => runOnboardingAction("defaultHandler", ipcSetDefaultHandler),
    }),
    {
      name: "mdownreview-ui",
      // Bump when persisted-shape migrations land. v1 (issue #89) strips
      // Windows `\\?\` verbatim prefixes from every persisted path field
      // so old clients agree with the post-fix Rust IPC chokepoint
      // (`core::paths::canonicalize_no_verbatim`) on string identity.
      version: 1,
      migrate: (persistedState, fromVersion) => {
        // v1 (issue #89): strip Windows `\\?\` verbatim prefixes from
        // every persisted path field. Body lives in
        // `migrations/v1-strip-verbatim.ts` (architecture rule 23
        // 500-LOC budget). The persist signature requires the
        // partialize-shape return; runtime shape is identical so we cast
        // through the partialize result type.
        const migrated = fromVersion < 1 ? migrateV1StripVerbatim(persistedState) : persistedState;
        return migrated as ReturnType<NonNullable<Parameters<typeof persist>[1]["partialize"]>>;
      },
      // Only persist global prefs — per-window state (tabs, activeTabPath,
      // expandedFolders, root) starts fresh each window / app launch.
      // `showSidecarFiles` is also intentionally NOT persisted — it's a
      // per-window viewing toggle that must default to OFF on every fresh
      // window so a user who flipped it on in one workspace doesn't have
      // raw sidecars surfaced when they open another.
      partialize: (state) => ({
        theme: state.theme,
        folderPaneWidth: state.folderPaneWidth,
        commentsPaneVisible: state.commentsPaneVisible,
        authorName: state.authorName,
        readingWidth: state.readingWidth,
        recentItems: state.recentItems,
        updateChannel: state.updateChannel,
      }),
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

/**
 * Convert any IPC rejection into a user-facing error string.
 *
 * Tagged enums (Rust `#[serde(tag = "kind")]`) MUST be matched
 * exhaustively — falling through to `JSON.stringify` would render raw
 * `{"kind":"permission_denied",...}` blobs in the UI (see repo-wide
 * "tagged enum" rule in docs/architecture.md / agent memory).
 *
 * Today only `CliShimError` is a tagged enum; `set_default_handler`
 * rejects with plain `Result<(), String>`,
 * caught by the `typeof reason === "string"` branch. When those grow
 * structured errors, add a matching `is*Error` guard + `switch` block
 * here with its own `never` exhaustiveness check.
 */
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
  // Deliberate: no JSON.stringify fallthrough. Any unknown shape that
  // reaches here is a contract bug — surface a stable sentinel rather than
  // leaking serialized internals into the UI.
  return "Unexpected error";
}

/**
 * Run a per-section onboarding command and chain a status refresh on settle.
 * Mirrors `useMenuListeners` (`getState()` for actions) so action chaining
 * stays inside the slice without re-invoking commands.
 */
async function runOnboardingAction(
  sectionKey: OnboardingSectionKey,
  action: () => Promise<void>
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

// `openFilesFromArgs` lives in `./launchArgs.ts` (extracted to keep this
// file under the 500-line shared-chokepoint budget — rule 23 in
// `docs/architecture.md`). Re-exported below for back-compat.
export { openFilesFromArgs } from "./launchArgs";
