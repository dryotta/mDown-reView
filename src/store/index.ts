import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/shallow";
import { error as logError } from "@/logger";
import {
  cliShimStatus as ipcCliShimStatus,
  defaultHandlerStatus as ipcDefaultHandlerStatus,
  extendWindowScopeFiles as ipcExtendWindowScopeFiles,
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
import { createWorkspaceSlice, type WorkspaceSlice } from "./workspace";
import {
  createUpdateSlice,
  type UpdateChannel,
  type UpdateSlice,
  type UpdateStatus,
} from "./update";

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
// Extracted to ./workspace.ts (rule 23 — file-size budget).

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

export type { UpdateStatus, UpdateChannel };

// ── Update slice ──────────────────────────────────────────────────────
// Extracted to ./update.ts (rule 23 — file-size budget).

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

// ── Outside-workspace allow slice (issue #338 / AC7) ──────────────────────
// Per-tab opt-in to follow tier-2 (outside-workspace) references. NEVER
// persisted (security: trust decisions must not silently survive an app
// restart — same rationale as `allowedRemoteImageDocs`). Excluded from
// `partialize` below; a regression test
// (`__tests__/allowOutsideWorkspace.test.ts`) asserts the persisted
// snapshot does not include this key.
interface OutsideWorkspaceSlice {
  allowOutsideWorkspace: Set<string>;
  /**
   * Issue #359 / iter-2 — monotonic counter that increments each time
   * `extendScopeForTab` successfully grants asset-protocol scope for an
   * outside-workspace tab. Consumed by `MarkdownViewer` to append a nonce
   * query param to `asset://` image URLs so the browser re-fetches them
   * under the just-granted scope (the asset-protocol response is cached
   * by URL, so without a busted URL the previously-blocked image stays
   * broken even though the scope is now valid). Session-only — naturally
   * excluded from the `partialize` allowlist below.
   */
  allowedScopeGen: number;
  allowOutsideForTab: (tabPath: string) => void;
  disallowOutsideForTab: (tabPath: string) => void;
  /**
   * Issue #359 / AC3 — atomic "extend asset-scope + flip allow flag"
   * action for the outside-workspace banner. Awaits
   * `extend_window_scope_files` BEFORE flipping `allowOutsideWorkspace`,
   * so embedded relative-path images (rendered via `convertFileSrc`)
   * resolve against the new asset-protocol scope on the next render.
   * On IPC reject the flag stays UNSET — the banner remains visible so
   * the user knows the grant didn't land. Re-throws so callers can
   * surface failures if needed; the action also logs the failure
   * internally.
   *
   * Architectural rationale (architect-expert): MVVM seam. The View
   * (`ViewerBanner`) no longer calls `commands.extendWindowScopeFiles`
   * directly — the ViewModel (this store action) owns IPC orchestration
   * + flag mutation as a single atomic operation.
   */
  extendScopeForTab: (tabPath: string) => Promise<void>;
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
  MermaidPopoutSlice &
  OutsideWorkspaceSlice;

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      // Workspace (delegated to ./workspace.ts)
      ...createWorkspaceSlice(set, get),

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

      // Outside-workspace allow slice (issue #338 / AC7).
      // Session-only — see comment on `OutsideWorkspaceSlice` and the
      // exclusion in `partialize` below.
      allowOutsideWorkspace: new Set<string>(),
      allowedScopeGen: 0,
      allowOutsideForTab: (tabPath) =>
        set((s) =>
          s.allowOutsideWorkspace.has(tabPath)
            ? s
            : { allowOutsideWorkspace: new Set([...s.allowOutsideWorkspace, tabPath]) }
        ),
      disallowOutsideForTab: (tabPath) =>
        set((s) => {
          if (!s.allowOutsideWorkspace.has(tabPath)) return s;
          const next = new Set(s.allowOutsideWorkspace);
          next.delete(tabPath);
          return { allowOutsideWorkspace: next };
        }),
      // Issue #359 / AC3 — atomic extend-scope + flag-flip. See doc-comment
      // on `OutsideWorkspaceSlice.extendScopeForTab` above for rationale.
      extendScopeForTab: async (tabPath) => {
        try {
          await ipcExtendWindowScopeFiles([tabPath]);
        } catch (err) {
          void logError(
            `[banner] extend_window_scope_files failed for ${tabPath}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          // Do NOT flip the flag. Banner stays visible so the user knows
          // the grant didn't land. Re-throw so the View can decide whether
          // to surface an additional UI cue (currently not needed — the
          // unchanged banner IS the cue).
          throw err;
        }
        // IPC succeeded — flip the per-tab allow flag atomically. Use
        // `get().allowOutsideForTab` to share the single setter so any
        // future changes to that path land here too.
        get().allowOutsideForTab(tabPath);
        // Issue #359 / iter-2 — bump the scope-gen counter so subscribers
        // (currently `MarkdownViewer`'s `<img>` resolver) can bust the
        // browser's `asset://` cache for previously-blocked relative-path
        // images. Without this, the just-granted scope has no observable
        // effect on already-mounted `<img>` nodes — they keep their
        // pre-grant (cached, failed) URL and stay broken.
        set((s) => ({ allowedScopeGen: s.allowedScopeGen + 1 }));
      },

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

      // Update (delegated to ./update.ts)
      ...createUpdateSlice(set),

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
