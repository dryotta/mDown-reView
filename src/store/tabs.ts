/**
 * Tabs slice — extracted from index.ts to keep that file under the
 * 500-line shared-chokepoint budget (rule 23 in `docs/architecture.md`).
 *
 * Owns the open-tabs list, active tab pointer, and a small set of session-only
 * per-path maps that are NEVER persisted (rule 15):
 *   - viewModeByTab — last chosen viewer mode (source/visual)
 *   - fileMetaByPath — { sizeBytes, lineCount, fileMtime, commentsMtime } cached
 *     from `read_text_file` / `get_file_comments`. The StatusBar reads mtimes
 *     from this map (see `FileMeta` below); there is no separate
 *     reload-timestamp map (the historic `lastFileReloadedAt` /
 *     `lastCommentsReloadedAt` slices were removed once mtimes covered the use
 *     case). Canonical TextFileResult chokepoint — see commands/fs/read.rs:13-24.
 *
 * The slice creator function is composed into the combined store in
 * `src/store/index.ts`. It uses the typed `set`/`get` signatures from
 * `StoreApi<Store>` so cross-slice access (e.g. `lastSaveByPath` from
 * WatcherSlice) stays type-safe.
 */
import type { StoreApi } from "zustand";

import { commands } from "@/lib/bindings";
import type { ViewMode } from "@/lib/file-types";

import type { Store } from "./index";


/** Maximum number of open tabs. When exceeded, oldest non-active tab (by lastAccessedAt) is evicted. */
export const MAX_TABS = 5;

export interface Tab {
  path: string;
  /**
   * Last persisted scroll position of the *visual-mode* scroll surface
   * (`.viewer-scroll-region`). Owned exclusively by `ViewerRouter`'s
   * onScroll/restore effects. Source-mode tabs persist their scroll
   * position in `sourceScrollTop` instead — see iter 2 of issue #252,
   * which moved source-mode scrolling to the inner `.source-lines`
   * container so virtualisation can measure visible rows.
   */
  scrollTop: number;
  /**
   * Last persisted scroll position of the *source-mode* scroll surface
   * (`.source-lines`, which became the virtualizer's overflow:auto
   * chokepoint in iter 2 of #252). Owned exclusively by `SourceView`'s
   * onScroll/restore effects. Optional only for backwards-compat with
   * persisted snapshots written before the field existed; treat
   * `undefined` as 0.
   */
  sourceScrollTop?: number;
  /**
   * Wall-clock timestamp of the last time this tab was opened or activated.
   * Drives LRU eviction. Optional only for backwards-compatibility with persisted
   * snapshots written before this field existed — `openFile` and `setActiveTab`
   * always set it. Treat `undefined` as 0 (oldest) when sorting.
   */
  lastAccessedAt?: number;
  /**
   * Read-only flag (issue #338 / AC9). `true` when this tab's path canonical
   * is OUTSIDE `tree_watched_dirs` per the `path_classify` IPC. Set eagerly
   * at `openFile` time so the comment-input UI can disable the selection
   * toolbar and surface a "Read-only · outside workspace" badge BEFORE the
   * user attempts a comment write.
   *
   * `undefined` until the eager classification settles (or when openFile is
   * called without a workspace context). Session-only — never persisted.
   */
  readOnly?: boolean;
}

/** Per-path cached file metadata, populated by `useFileContent` after a successful read. */
export interface FileMeta {
  sizeBytes?: number;
  lineCount?: number;
  /**
   * Wall-clock mtime of the file (epoch ms) at the time of the last successful
   * read. Populated by Group D (`useFileContent`) from `TextFileResult.mtime_ms`.
   * `undefined` until first read; `null` is reserved for "FS does not expose
   * mtime" if Group D chooses to forward that distinction.
   */
  fileMtime?: number;
  /**
   * Wall-clock mtime of the `.mrsf.yaml` sidecar (epoch ms) at the time of the
   * last successful comments load. Populated by Group D (`use-comments`) from
   * `GetFileCommentsResult.sidecar_mtime_ms`. `null` means "no sidecar exists";
   * `undefined` means "never loaded".
   */
  commentsMtime?: number | null;
}

export interface TabsSlice {
  tabs: Tab[];
  activeTabPath: string | null;
  viewModeByTab: Record<string, ViewMode>;
  /** Cached `read_text_file` metadata per path. Session-only (not persisted). */
  fileMetaByPath: Record<string, FileMeta>;
  /**
   * Issue #352 / iter-12 — per-tab dirty flag for in-Editor-mode
   * Excalidraw drawings under autosave-only semantics. The flag flips
   * to `true` on every Excalidraw `onChange` while in editor mode and
   * back to `false` when the debounced `performSave` either persists
   * the live scene or determines no divergence vs the on-disk
   * baseline. The dirty-window is therefore at most one autosave
   * debounce (`EXCALIDRAW_AUTOSAVE_DEBOUNCE_MS`).
   *
   * **Sole consumer:** `useFileContent` (`src/hooks/useFileContent.ts`)
   * reads it on `mdownreview:file-changed` to surface the conflict
   * banner instead of silently clobbering the user's mid-edit state.
   * No tab-title indicator is rendered — under autosave the file is
   * always almost-saved and a flickering dot would be more noise than
   * signal (AC6 deliberately dropped in iter-10/iter-12; see
   * `docs/features/excalidraw.md` § "Save semantics").
   *
   * Session-only — never persisted. Closing the app drains pending
   * saves via the Rust `WindowEvent::CloseRequested` handshake (see
   * `src-tauri/src/commands/excalidraw_close.rs`) before tear-down.
   */
  excalidrawDirtyByTab: Record<string, boolean>;
  /**
   * Issue #352 / AC7 — per-tab pending external-change flag. The watcher
   * fired `file-content-changed` on this Excalidraw tab while it was open
   * in Editor mode AND `excalidrawDirtyByTab[path] === true`, so we held
   * off on auto-reload and asked the user. The conflict banner above the
   * canvas reads this flag; clicking [Reload] / [Keep editing] clears it.
   *
   * Session-only — never persisted (same rationale as
   * `excalidrawDirtyByTab`).
   */
  externalChangePendingByTab: Record<string, boolean>;
  openFile: (path: string, opts?: { recordHistory?: boolean }) => void;
  closeTab: (path: string) => void;
  closeAllTabs: () => void;
  setActiveTab: (path: string, opts?: { recordHistory?: boolean }) => void;
  setScrollTop: (path: string, scrollTop: number) => void;
  /**
   * Iter 2 of #252 — persist the source-mode scroll surface separately
   * from `scrollTop` (which still owns the visual-mode scroll surface).
   * Two writers (ViewerRouter for visual, SourceView for source) into one
   * field would cross-pollute coordinate spaces on view-mode toggle and
   * cross-tab navigation. `setSourceScrollTop` is the canonical entry
   * point for `SourceView`; ViewerRouter never touches it.
   */
  setSourceScrollTop: (path: string, sourceScrollTop: number) => void;
  setViewMode: (path: string, mode: ViewMode) => void;
  /** Merge a partial `FileMeta` patch into the cached entry for `path`. */
  setFileMeta: (path: string, patch: Partial<FileMeta>) => void;
  /**
   * Mutate `Tab.readOnly` for the matching path (issue #338 / AC9). Used by
   * the comments slice's typed-error self-heal: when an `add_comment` IPC
   * rejects with `CommentError { kind: "outside-workspace" }`, the renderer
   * flips `readOnly` so the next comment-input render is disabled before
   * the user retries. No-op when no tab matches `path`.
   */
  setTabReadOnly: (path: string, readOnly: boolean) => void;
  /**
   * Issue #352 / iter-12 — set/clear the dirty flag for an Excalidraw
   * editor tab. Setting to `false` removes the entry entirely so a
   * closed tab doesn't linger in the map. Sole consumer is
   * `useFileContent` for the conflict-banner gate (see field doc on
   * `excalidrawDirtyByTab` above for why no tab-title indicator
   * exists under autosave).
   */
  setExcalidrawDirty: (path: string, dirty: boolean) => void;
  /**
   * Issue #352 / AC7 — set/clear the pending-external-change flag for an
   * Excalidraw editor tab. Setting to `false` removes the entry entirely.
   * Subscribed by `ExcalidrawView` to gate the conflict banner.
   */
  setExternalChangePending: (path: string, pending: boolean) => void;
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
    fileMetaByPath: {},
    excalidrawDirtyByTab: {},
    externalChangePendingByTab: {},

    openFile: (path, opts) => {
      get().closeMermaidPopout(); // issue #276 — close popout on file open
      const recordHistory = opts?.recordHistory ?? true;
      const now = Date.now();
      const existing = get().tabs.find((t) => t.path === path);
      if (existing) {
        set((s) => ({
          activeTabPath: path,
          tabs: s.tabs.map((t) => (t.path === path ? { ...t, lastAccessedAt: now } : t)),
        }));
        if (recordHistory) get().pushHistory(path);
        return;
      }
      // Evict LRU non-active tab if at capacity.
      const baseTabs = get().tabs;
      if (baseTabs.length >= MAX_TABS) {
        const activePath = get().activeTabPath;
        // Issue #352 / iter-10 redesign — auto-save means evicted tabs
        // already have their content on disk. The previous "exempt
        // dirty editors from eviction" carve-out (iter-5) is no longer
        // needed: the cap can apply uniformly. Pick the oldest non-active
        // tab as the victim.
        const candidates = baseTabs.filter((t) => t.path !== activePath);
        const accessed = (t: Tab) => t.lastAccessedAt ?? 0;
        const victim = candidates.reduce((oldest, t) =>
          accessed(t) < accessed(oldest) ? t : oldest
        );
        // Issue #352 / iter-5 architect-expert MEDIUM — atomicity.
        // Merge the eviction maps with the new-tab append into a
        // SINGLE set() call so subscribers never observe an
        // intermediate state (victim gone, new tab not yet added,
        // active still pointing at the old active). Per rule 16 in
        // docs/architecture.md.
        const filteredTabs = baseTabs.filter((t) => t.path !== victim.path);
        const { [victim.path]: _v, ...restView } = get().viewModeByTab;
        const { [victim.path]: _s, ...restSave } = get().lastSaveByPath;
        const { [victim.path]: _m, ...restMeta } = get().fileMetaByPath;
        const { [victim.path]: _d, ...restDirty } = get().excalidrawDirtyByTab;
        const { [victim.path]: _p, ...restPending } = get().externalChangePendingByTab;
        set({
          tabs: [...filteredTabs, { path, scrollTop: 0, lastAccessedAt: now }],
          activeTabPath: path,
          viewModeByTab: restView,
          lastSaveByPath: restSave,
          fileMetaByPath: restMeta,
          excalidrawDirtyByTab: restDirty,
          externalChangePendingByTab: restPending,
        });
        if (recordHistory) get().pushHistory(path);
        void classifyAndMarkReadOnly(path, set);
        return;
      }
      set({
        tabs: [...baseTabs, { path, scrollTop: 0, lastAccessedAt: now }],
        activeTabPath: path,
      });
      if (recordHistory) get().pushHistory(path);
      // Issue #338 / AC9 — eagerly classify the just-opened tab so the
      // comment-input UI can branch on `readOnly` BEFORE the user attempts
      // a write. Fire-and-forget; on IPC failure we leave readOnly
      // undefined (fail-closed: the next comment write attempt's typed
      // CommentError will self-heal the flag — see comments slice in the
      // Wave-2 migration scope).
      void classifyAndMarkReadOnly(path, set);
    },

    closeTab: (path) => {
      // Issue #352 / iter-10 redesign — auto-save makes the close
      // confirm obsolete. Edits are flushed to disk on a 2s debounce
      // so there is no "unsaved" state to discard. The dirty-tab
      // map is still maintained for back-compat with tests but is
      // never consulted by close paths.
      get().closeMermaidPopout(); // issue #276 — close popout on tab close
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
      const { [path]: _unusedDirty, ...restDirty } = get().excalidrawDirtyByTab;
      const { [path]: _unusedPending, ...restPending } = get().externalChangePendingByTab;
      set({
        tabs: newTabs,
        activeTabPath: newActive,
        viewModeByTab: restViewModes,
        lastSaveByPath: restSaveByPath,
        fileMetaByPath: restMeta,
        excalidrawDirtyByTab: restDirty,
        externalChangePendingByTab: restPending,
      });
    },

    closeAllTabs: () => {
      // Issue #352 / iter-10 redesign — see closeTab; auto-save
      // means there is no longer a discardable "unsaved" state.
      get().closeMermaidPopout(); // issue #276 — close popout on close-all
      set({
        tabs: [],
        activeTabPath: null,
        viewModeByTab: {},
        lastSaveByPath: {},
        fileMetaByPath: {},
        excalidrawDirtyByTab: {},
        externalChangePendingByTab: {},
      });
    },

    setActiveTab: (path, opts) => {
      // Issue #352 / iter-10 redesign — auto-save flushes pending
      // edits before any tab switch, so the iter-5 prompt is gone.
      get().closeMermaidPopout(); // issue #276 — close popout on tab switch
      const recordHistory = opts?.recordHistory ?? true;
      const now = Date.now();
      set((s) => ({
        activeTabPath: path,
        tabs: s.tabs.map((t) => (t.path === path ? { ...t, lastAccessedAt: now } : t)),
      }));
      if (recordHistory) get().pushHistory(path);
    },

    setScrollTop: (path, scrollTop) => {
      const tab = get().tabs.find((t) => t.path === path);
      if (!tab || tab.scrollTop === scrollTop) return;
      set((s) => ({
        tabs: s.tabs.map((t) => (t.path === path ? { ...t, scrollTop } : t)),
      }));
    },

    setSourceScrollTop: (path, sourceScrollTop) => {
      const tab = get().tabs.find((t) => t.path === path);
      if (!tab || (tab.sourceScrollTop ?? 0) === sourceScrollTop) return;
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.path === path ? { ...t, sourceScrollTop } : t,
        ),
      }));
    },

    setViewMode: (path, mode) => {
      // Issue #352 / iter-10 redesign — auto-save means there is no
      // longer a discardable in-flight scene. Mode switches just
      // change the view; the latest edits are already on disk (or
      // will be after the in-flight debounce fires). The dirty/pending
      // maps are cleared on leaving editor mode so a later return to
      // the tab doesn't see stale flags.
      const prevMode = get().viewModeByTab[path];
      const isLeavingEditor = prevMode === "editor" && mode !== "editor";
      set((s) => {
        if (isLeavingEditor) {
          const { [path]: _d, ...restDirty } = s.excalidrawDirtyByTab;
          const { [path]: _p, ...restPending } = s.externalChangePendingByTab;
          return {
            viewModeByTab: { ...s.viewModeByTab, [path]: mode },
            excalidrawDirtyByTab: restDirty,
            externalChangePendingByTab: restPending,
          };
        }
        return {
          viewModeByTab: { ...s.viewModeByTab, [path]: mode },
        };
      });
    },

    setFileMeta: (path, patch) =>
      set((s) => {
        const prev = s.fileMetaByPath[path];
        const merged: FileMeta = { ...prev, ...patch };
        if (
          prev !== undefined &&
          prev.sizeBytes === merged.sizeBytes &&
          prev.lineCount === merged.lineCount &&
          prev.fileMtime === merged.fileMtime &&
          prev.commentsMtime === merged.commentsMtime
        ) {
          // No observable change — return same state so subscribers don't fire.
          return s;
        }
        return {
          fileMetaByPath: {
            ...s.fileMetaByPath,
            [path]: merged,
          },
        };
      }),

    setTabReadOnly: (path, readOnly) =>
      set((s) => ({
        tabs: s.tabs.map((t) => (t.path === path ? { ...t, readOnly } : t)),
      })),

    setExcalidrawDirty: (path, dirty) =>
      set((s) => {
        const current = s.excalidrawDirtyByTab[path] === true;
        if (current === dirty) return s; // no observable change
        if (!dirty) {
          const { [path]: _d, ...rest } = s.excalidrawDirtyByTab;
          return { excalidrawDirtyByTab: rest };
        }
        return {
          excalidrawDirtyByTab: { ...s.excalidrawDirtyByTab, [path]: true },
        };
      }),

    setExternalChangePending: (path, pending) =>
      set((s) => {
        const current = s.externalChangePendingByTab[path] === true;
        if (current === pending) return s;
        if (!pending) {
          const { [path]: _p, ...rest } = s.externalChangePendingByTab;
          return { externalChangePendingByTab: rest };
        }
        return {
          externalChangePendingByTab: { ...s.externalChangePendingByTab, [path]: true },
        };
      }),
  };
}

/**
 * Eagerly classify the just-opened tab via the `path_classify` IPC and
 * patch `readOnly` on the matching tab entry (issue #338 / AC9).
 *
 * Fail-closed: any IPC failure leaves `readOnly` undefined. The next
 * comment-write attempt's typed CommentError self-heals the flag from
 * the canonical Rust answer (see comments slice — Wave-2 migration).
 */
async function classifyAndMarkReadOnly(path: string, set: SliceSet): Promise<void> {
  try {
    const result = await commands.pathClassify(path, null);
    if (result.status !== "ok") return;
    const isReadOnly = result.data.tier !== "inside";
    set((s) => ({
      tabs: s.tabs.map((t) => (t.path === path ? { ...t, readOnly: isReadOnly } : t)),
    }));
  } catch {
    // Defense-in-depth — already covered by the Result branch above.
  }
}
