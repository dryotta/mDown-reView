/**
 * Workspace slice — extracted from index.ts to keep that file under the
 * 500-line shared-chokepoint budget (rule 23 in `docs/architecture.md`).
 *
 * Owns the workspace root + folder-expansion map. The root setter
 * canonicalises the incoming path via the Rust IPC so the stored form
 * matches what `scan_review_files` emits — without this, ghost-entry
 * detection fails on Windows paths in 8.3 short-name form.
 *
 * Cross-slice actions:
 * - `setRoot` and `closeFolder` close the mermaid popout (rule 16 — issue #276).
 * - `openFolderPath` orchestrates `registerWindowFolder` IPC →
 *   `setRoot` → `addRecentItem` for ALL "open this folder" entry points
 *   (toolbar dialog, welcome-view recents, future drag-drop) so the
 *   register-then-setRoot ordering can never drift between callers.
 * - `openFilePath` symmetrically orchestrates `openFile` + `addRecentItem`.
 */
import type { StoreApi } from "zustand";
import { registerWindowFolder } from "@/lib/tauri-commands";
import { warn } from "@/logger";
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
  /**
   * Open a folder by canonical path — single canonical entry point used
   * by the toolbar dialog flow and the welcome-view recent list. Calls
   * `register_window_folder` BEFORE `setRoot`: when the folder is
   * already claimed by another window, Rust focuses that window and
   * returns Err — `setRoot` must NOT run on rejection. See rule
   * `multiwin-window-folder-claim` in `v2-patterns.md`.
   */
  openFolderPath: (folder: string) => Promise<void>;
  /** Open a file as a tab + record in recents. Single entry point. */
  openFilePath: (path: string) => void;
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
    // allow-chained-invokes: register MUST resolve before setRoot —
    // a rejection (folder already open in another window) keeps THIS
    // window's state untouched; the existing window is focused by Rust.
    openFolderPath: async (folder) => {
      try {
        await registerWindowFolder(folder);
        await get().setRoot(folder);
        get().addRecentItem(folder, "folder");
      } catch (err) {
        // Tauri's IPC chokepoint wraps `Result<_, String>` rejections
        // in `new Error(string)` (see `src/lib/tauri-commands.ts::unwrap`),
        // so check `err.message`. The "already open" path is expected
        // (Rust focused the existing window already); other rejections
        // are real failures and MUST be logged — pre-PR shape always
        // logged unconditionally.
        const message =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : String(err);
        if (message.includes("already open")) {
          void warn(`[workspace] folder already open in another window: ${folder}`);
        } else {
          void warn(`[workspace] register_window_folder failed for ${folder}: ${message}`);
        }
      }
    },
    openFilePath: (path) => {
      get().openFile(path);
      get().addRecentItem(path, "file");
    },
  };
}
