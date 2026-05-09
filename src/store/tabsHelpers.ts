/**
 * Helpers extracted from `tabs.ts` (iter-17, architect-expert HIGH —
 * file-size budget rule 23). The slice creator was crowding the
 * 500-line shared-chokepoint cap; pulling this helper out brings it
 * back inside budget without losing co-location of the cleanup-atomicity
 * logic (which still lives in tabs.ts where the setters are).
 *
 * - `claimOrRevert` — multi-window file singleton (iter-15).
 *   Synchronous tab-add + async ownership claim with revert-on-conflict.
 *   See full design rationale in `docs/features/excalidraw.md`
 *   "Multi-window same-file singleton" section.
 *
 * Takes `set` / `get` typed against the combined `Store` so it can
 * mutate any slice (tabs + lastSaveByPath in WatcherSlice +
 * fileMetaByPath in TabsSlice) atomically per rule 16.
 *
 * Note (issue #359): the previous `classifyAndMarkReadOnly` helper —
 * which fired a separate `path_classify` IPC after openFile to backfill
 * `Tab.readOnly` — was deleted. Classification is now derived from the
 * `register_window_file` result inside `openFile` itself and applied
 * atomically with tab insertion (single set(), no transient
 * `readOnly === undefined` frame). The dead-code seal lives in
 * `src/__tests__/no-classify-and-mark-readonly.test.ts`.
 */

import type { StoreApi } from "zustand";

import { claimOpenFile } from "@/lib/tauri-commands";
import { warn as logWarn, debug as logDebug } from "@/logger";

import type { Store } from "./index";

type SliceSet = StoreApi<Store>["setState"];
type SliceGet = StoreApi<Store>["getState"];

/**
 * Iter-15 — multi-window file singleton revert helper.
 *
 * On `OwnedElsewhere`, Rust has already focused the owner window and
 * emitted `focus-tab` to it; this helper removes the just-added local
 * tab if it's still present. Re-reads the latest store state so a
 * concurrent close / re-open doesn't get clobbered by a stale revert.
 */
export async function claimOrRevert(
  path: string,
  set: SliceSet,
  get: SliceGet,
): Promise<void> {
  let result;
  try {
    result = await claimOpenFile(path);
  } catch (err: unknown) {
    // IPC failure (registry state missing, canonicalize threw): degrade
    // to pre-iter-15 behaviour — leave the tab open in this window.
    // The Rust-side destroy sweep is the last line of defence.
    void logWarn(
      `[claim] IPC failed for ${path}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return;
  }
  if (result.kind === "claimed") {
    void logDebug(`[claim] Claimed ${path}`);
    return;
  }
  void logDebug(
    `[claim] ${path} owned by window=${result.window_label}; reverting local tab`,
  );
  const stillOpen = get().tabs.some((t) => t.path === path);
  if (!stillOpen) return;
  // Re-derive the tab-removal in a single set() call so subscribers
  // never observe an intermediate state (rule 16 in
  // `docs/architecture.md`).
  const tabs = get().tabs;
  const newTabs = tabs.filter((t) => t.path !== path);
  let newActive = get().activeTabPath;
  if (newActive === path) {
    const fallback = [...newTabs].sort(
      (a, b) => (b.lastAccessedAt ?? 0) - (a.lastAccessedAt ?? 0),
    )[0];
    newActive = fallback?.path ?? null;
  }
  const { [path]: _v, ...restView } = get().viewModeByTab;
  const { [path]: _s, ...restSave } = get().lastSaveByPath;
  const { [path]: _m, ...restMeta } = get().fileMetaByPath;
  const { [path]: _d, ...restDirty } = get().excalidrawDirtyByTab;
  const { [path]: _p, ...restPending } = get().externalChangePendingByTab;
  const restMounts = get().excalidrawEditorMounts.filter((p) => p !== path);
  set({
    tabs: newTabs,
    activeTabPath: newActive,
    viewModeByTab: restView,
    lastSaveByPath: restSave,
    fileMetaByPath: restMeta,
    excalidrawDirtyByTab: restDirty,
    externalChangePendingByTab: restPending,
    excalidrawEditorMounts: restMounts,
  });
}
