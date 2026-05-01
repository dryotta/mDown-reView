/**
 * Workspace slice — extracted from index.ts to keep that file under the
 * 500-line shared-chokepoint budget (rule 23 in `docs/architecture.md`).
 *
 * Owns the workspace root + folder-expansion map. The root setter
 * canonicalises the incoming path via the Rust IPC so the stored form
 * matches what `scan_review_files` emits — without this, ghost-entry
 * detection fails on Windows paths in 8.3 short-name form.
 *
 * Cross-slice action: `setRoot` and `closeFolder` close the mermaid
 * popout (rule 16 — issue #276).
 */
import type { StoreApi } from "zustand";
import { canonicalizeOrFallback } from "./canonicalize";
import type { Store } from "./index";

export interface WorkspaceSlice {
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

type SliceSet = StoreApi<Store>["setState"];
type SliceGet = StoreApi<Store>["getState"];

export function createWorkspaceSlice(set: SliceSet, get: SliceGet): WorkspaceSlice {
  return {
    root: null,
    expandedFolders: {},
    setRoot: async (root) => {
      const canonical = root === null ? null : await canonicalizeOrFallback(root);
      set({ root: canonical, expandedFolders: {} });
      get().closeMermaidPopout();
    },
    toggleFolder: (path) =>
      set((s) => ({
        expandedFolders: { ...s.expandedFolders, [path]: !s.expandedFolders[path] },
      })),
    setFolderExpanded: (path, expanded) =>
      set((s) => ({ expandedFolders: { ...s.expandedFolders, [path]: expanded } })),
    closeFolder: () => {
      set({ root: null, expandedFolders: {} });
      get().closeMermaidPopout();
    },
  };
}
