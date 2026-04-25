# Navigation

## What it is

Three collaborating surfaces: a folder tree for browsing the workspace, a tab bar for tracking open files (with persistence across sessions), and a workspace-wide search for finding files by name or content.

## How it works

Opening a workspace folder triggers one Rust call that returns the full directory tree (bounded by a depth cap and a canonicalized root per the path rules in [`docs/security.md`](../security.md)). The resulting tree populates `workspaceSlice` in Zustand; `FolderTree` renders from it via `useShallow` to avoid re-render amplification.

Clicking a file opens it in a tab — or reuses an existing tab if the file is already open. `tabsSlice` tracks order, active tab, and dirty state; persist middleware mirrors UI state to `localStorage` so the app rehydrates the tab set on restart. Reactive UI state lives in Zustand; ephemeral view state (scroll position, selection) stays in component-local `useState` per the stratification rule in [`docs/architecture.md`](../architecture.md).

Search is incremental and debounced. The query runs through `useSearch`, which coordinates a Rust scan for file-name matches with an in-memory filter for file-content hits. Results drive a filtered view of the tree without mutating the tree's source of truth.

The folder tree updates live: `useTreeWatcher` registers the root and currently-expanded folders with the Rust watcher, and `useFolderChildren` listens for `folder-changed` events to refresh cached `read_dir` entries — so files created or deleted on disk appear in the tree without the user pressing F5. The tab bar additionally surfaces an "Other files" section that lists open tabs whose paths fall outside the current workspace root, so files opened via the OS shell or CLI remain reachable while a different workspace is open.

## Key source

- **Tree:** `src/components/FolderTree/FolderTree.tsx`
- **Tabs:** `src/components/TabBar/TabBar.tsx`
- **Hooks:** `src/hooks/useSearch.ts`, `src/hooks/useTreeWatcher.ts`, `src/hooks/useFolderChildren.ts`
- **Store slices:** `src/store/index.ts` — `workspaceSlice`, `tabsSlice`, `uiSlice`
- **Rust commands:** `src-tauri/src/commands/fs.rs` — `read_dir`, `update_tree_watched_dirs`; `src-tauri/src/commands/launch.rs` — `scan_review_files`; `src-tauri/src/watcher.rs` — `update_watched_files`

## Related rules

- State stratification (domain vs reactive UI vs ephemeral) — rule 3 in [`docs/architecture.md`](../architecture.md).
- Live folder-tree updates via `folder-changed` events — rule 12 in [`docs/architecture.md`](../architecture.md).
- Path canonicalization and directory-read bounds — [`docs/security.md`](../security.md).
- Tab persistence must rehydrate without running commands that would fail offline — rule 4 in [`docs/architecture.md`](../architecture.md) (commands mutate, events notify).
- Cross-slice coupling budgets — [`docs/architecture.md`](../architecture.md) §Component & viewer boundaries.
