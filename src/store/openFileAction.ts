/**
 * `openFile` orchestration body — extracted from `tabs.ts` so that file
 * stays under the 500-line shared-chokepoint budget (rule 23 in
 * `docs/architecture.md`). The discard-guard logic in `closeTab` /
 * `setActiveTab` / `setViewMode` is the rule-23-protected core that
 * remains co-located in `tabs.ts`; ONLY the `openFile` body lives here.
 *
 * Issue #359 — async tab-open with stale-request guard. The guard uses a
 * module-scope monotonic counter (`openFileSeq`) plus a "latest accepted"
 * sentinel (`latestAcceptedSeq`); a late-resolving register call whose
 * captured sentinel no longer matches drops its insert. This replaces the
 * earlier `pendingOpenAt` slice field — the field had no UI subscriber
 * (its own doc-comment said so) and a module-scope variable is the
 * minimum-surface implementation of the guard.
 */
import type { StoreApi } from "zustand";

import {
  registerWindowFile,
  releaseOpenFile,
} from "@/lib/tauri-commands";
import { warn as logWarn } from "@/logger";

import type { Store } from "./index";
import { MAX_TABS, type Tab } from "./tabs";
import { claimOrRevert } from "./tabsHelpers";

type SliceSet = StoreApi<Store>["setState"];
type SliceGet = StoreApi<Store>["getState"];

/**
 * Per-call sentinel source. `Date.now()` alone can collide for synchronous
 * back-to-back calls in tests (and on fast machines), defeating the
 * rapid-switch de-clobber check. The counter advances per-call so every
 * outstanding open has a distinct sentinel.
 */
let openFileSeq = 0;
/**
 * Sentinel of the most-recently-accepted open call. A late resolution
 * whose captured `requestedAt` no longer matches this value MUST drop
 * its insert (a newer open has overtaken it).
 */
let latestAcceptedSeq: number | null = null;

/** Test-only — reset module-scope sentinels between unit tests. */
export function __resetOpenFileSeqForTests(): void {
  openFileSeq = 0;
  latestAcceptedSeq = null;
}

export async function openFileImpl(
  path: string,
  opts: { recordHistory?: boolean } | undefined,
  set: SliceSet,
  get: SliceGet,
): Promise<void> {
  get().closeMermaidPopout(); // issue #276 — close popout on file open
  const recordHistory = opts?.recordHistory ?? true;
  const now = Date.now();

  const existing = get().tabs.find((t) => t.path === path);
  if (existing) {
    // Existing-tab activation path: no register/canonicalize work needed
    // (the tab's path was already vetted at original open time).
    set((s) => ({
      activeTabPath: path,
      tabs: s.tabs.map((t) => (t.path === path ? { ...t, lastAccessedAt: now } : t)),
    }));
    if (recordHistory) get().pushHistory(path);
    // Same-window re-claim is a no-op success in Rust; firing here keeps
    // the registry warm in case the prior owner's entry was reaped.
    void claimOrRevert(path, set, get);
    return;
  }

  // Issue #359 — register BEFORE inserting the tab so the file is in the
  // runtime allowlist by the time `useFileContent` reads it.
  const requestedAt = ++openFileSeq;
  latestAcceptedSeq = requestedAt;

  let result;
  try {
    result = await registerWindowFile(path);
  } catch (err) {
    // Register rejected (system-tier path / canonicalize failure). Do NOT
    // insert a tab — the file is unsafe to open in this window.
    void logWarn(
      `[openFile] register_window_file failed for ${path}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    throw err;
  }

  if (latestAcceptedSeq !== requestedAt) {
    // A newer open superseded this one between await and set(). Drop the
    // late insert so we don't clobber the newer tab as active.
    return;
  }

  // Issue #338 / AC9 — readOnly is `true` whenever the canonical path
  // resolves OUTSIDE the window's tree_watched_dirs (tier !== "inside").
  // Set atomically with tab insertion (rule 16) so subscribers never
  // observe a transient frame where readOnly is undefined.
  const isReadOnly = result.classification.tier !== "inside";
  const canonical = result.canonical;

  // Evict LRU non-active tab if at capacity.
  const baseTabs = get().tabs;
  if (baseTabs.length >= MAX_TABS) {
    const activePath = get().activeTabPath;
    // Issue #352 / iter-10 — auto-save means evicted tabs already have
    // their content on disk; the cap can apply uniformly.
    const candidates = baseTabs.filter((t) => t.path !== activePath);
    const accessed = (t: Tab) => t.lastAccessedAt ?? 0;
    const victim = candidates.reduce((oldest, t) =>
      accessed(t) < accessed(oldest) ? t : oldest,
    );
    // Rule 16 (atomic multi-slice mutation): merge eviction with append
    // into a SINGLE set() so subscribers never observe an intermediate
    // state.
    const filteredTabs = baseTabs.filter((t) => t.path !== victim.path);
    const { [victim.path]: _v, ...restView } = get().viewModeByTab;
    const { [victim.path]: _s, ...restSave } = get().lastSaveByPath;
    const { [victim.path]: _m, ...restMeta } = get().fileMetaByPath;
    const { [victim.path]: _d, ...restDirty } = get().excalidrawDirtyByTab;
    const { [victim.path]: _p, ...restPending } = get().externalChangePendingByTab;
    const restMounts = get().excalidrawEditorMounts.filter(
      (p) => p !== victim.path,
    );
    set({
      tabs: [
        ...filteredTabs,
        { path: canonical, scrollTop: 0, lastAccessedAt: now, readOnly: isReadOnly },
      ],
      activeTabPath: canonical,
      viewModeByTab: restView,
      lastSaveByPath: restSave,
      fileMetaByPath: restMeta,
      excalidrawDirtyByTab: restDirty,
      externalChangePendingByTab: restPending,
      excalidrawEditorMounts: restMounts,
    });
    if (recordHistory) get().pushHistory(canonical);
    // Iter-15 — release the LRU victim's claim. Fire-and-forget; the
    // destroy sweep is the safety net for IPC failures.
    void releaseOpenFile(victim.path).catch((err: unknown) => {
      void logWarn(
        `[release] LRU victim ${victim.path} release failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
    // Iter-15 — claim the new path; revert on conflict.
    void claimOrRevert(canonical, set, get);
    return;
  }
  set({
    tabs: [
      ...baseTabs,
      { path: canonical, scrollTop: 0, lastAccessedAt: now, readOnly: isReadOnly },
    ],
    activeTabPath: canonical,
  });
  if (recordHistory) get().pushHistory(canonical);
  // Iter-15 — claim ownership; revert on conflict.
  void claimOrRevert(canonical, set, get);
}
