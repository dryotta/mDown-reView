# Folder/File Opening UX Refactoring

Design spec for restructuring how mdownreview handles opening files and folders, the folder pane lifecycle, the welcome view, and CLI arguments.

## 1. Keyboard Shortcuts & Menu Restructure

### Shortcuts

| Action | Current | New |
|---|---|---|
| Open File | _(none)_ | `Ctrl+O` / `Cmd+O` |
| Open Folder | `Ctrl+O` / `Cmd+O` | `Ctrl+Shift+O` / `Cmd+Shift+O` |

### File Menu (new structure)

1. Open File — `Ctrl+O`
2. Open Folder — `Ctrl+Shift+O`
3. Close Folder _(disabled when no folder is open)_
4. _(separator)_
5. Close Tab — `Ctrl+W`
6. Close All Tabs — `Ctrl+Shift+W`
7. Quit — `Ctrl+Q`

### View Menu (new structure)

Removed items: Toggle Folder Pane, Expand All, Collapse All.

Remaining items:
1. Toggle Comments Pane — `Ctrl+Shift+C`
2. Next Tab — `Ctrl+Tab`
3. Previous Tab — `Ctrl+Shift+Tab`
4. Theme submenu (System / Light / Dark)

### Toolbar (new structure)

Removed items: folder pane toggle button.

Remaining items: Open File, Open Folder, Comments toggle, Theme, About.

## 2. CLI Changes

### New Flags

- `--folder <path>` — sets the workspace root. Only the last `--folder` wins.
- `--file <path>` — opens a file tab. Can appear multiple times.

### Syntax Examples

```sh
mdownreview --folder ./docs --file ./readme.md     # explicit flags
mdownreview ./docs ./readme.md                      # auto-detect fallback (backwards compatible)
mdownreview --folder ./docs readme.md               # mixed: explicit folder + positional file
```

### Path Resolution

All paths (both flagged and positional) are resolved relative to the current working directory before being passed to the frontend.

### Behavior

- Positional args without flags use existing auto-detect logic (is_dir → folder, is_file → file).
- When both folder and files are provided: set root to the folder first, then open file tabs.
- Second-instance `args-received` event follows the same parsing logic.
- macOS `RunEvent::Opened` continues to handle file URLs as before.

## 3. Folder Pane Visibility

### Core Rule

The folder pane is **only shown when a folder is open** (`root !== null`). There is no manual toggle.

### Removed

- `folderPaneVisible` state field
- `toggleFolderPane()` action
- Folder pane toggle button in toolbar
- "Toggle Folder Pane" in View menu
- `Ctrl+B` / `Cmd+B` keyboard shortcut

### Transition

The folder pane appears/disappears with a CSS slide transition (~200ms, ease-out) from the left edge.

### Close Folder Action

- Sets `root` to `null`
- Clears `expandedFolders`
- Stops the file watcher for the folder directory
- **Keeps all open tabs** (does not close files)
- Triggered by: "Close Folder" menu item, or `×` button in folder pane header

## 4. Welcome View (Empty State)

### When Shown

Displayed in the main content area when no tab is active (all tabs closed or no file ever opened). Replaces the current "Open a folder to get started" placeholder.

### Layout

Centered vertically and horizontally. Respects the active theme (light/dark).

```
        ┌──────────────────────────────────┐
        │                                  │
        │         📂  mdownreview          │
        │                                  │
        │   Open File         Ctrl+O       │
        │   Open Folder       Ctrl+Shift+O │
        │                                  │
        │   ── Recent ──────────────────   │
        │   📁 C:\projects\docs            │
        │   📄 C:\notes\readme.md          │
        │   📁 D:\reviews\sprint-42        │
        │                                  │
        └──────────────────────────────────┘
```

### Behavior

- "Open File" and "Open Folder" are clickable links that trigger the same dialog actions as toolbar/menu items.
- Keyboard shortcuts shown as styled `<kbd>` badges beside each action.
- **Recent section** shows up to 5 items (mixed folders and files, most recent first).
- Each recent item is clickable — folders call `setRoot()`, files open in a tab.
- Recent items show an icon (📁 for folder, 📄 for file) and the full path with filename/foldername bolded.
- If a recent path no longer exists on disk, it is shown dimmed with strikethrough. Existence is checked via Tauri `read_text_file` / `read_dir` commands when the welcome view mounts.
- Recent section is hidden if there are no recent items.

### Recent Items Data Model

```typescript
interface RecentItem {
  path: string;        // absolute path
  type: 'file' | 'folder';
  timestamp: number;   // Date.now() at time of open
}
```

- Stored in Zustand persisted state as `recentItems: RecentItem[]`, max 5.
- Items added whenever a file or folder is successfully opened via any path (dialog, CLI, recent click, drag-drop).
- Duplicates are deduplicated: re-opening a path moves it to the top (updates timestamp).
- Oldest items are evicted when the list exceeds 5.

## 5. Folder Tree Changes

### Removed

- Expand All / Collapse All buttons from folder tree toolbar
- Expand All / Collapse All from native View menu
- Menu event handlers for expand-all / collapse-all

### Added

- `×` close button in folder pane header (right-aligned, next to the auto-reveal 📍 toggle)

### Folder Pane Header Layout

```
┌─────────────────────────────────┐
│ 📁 docs              📍  ×     │
│─────────────────────────────────│
│  ▸ subfolder/                   │
│  ▸ readme.md                    │
```

### Auto-Reveal Sync

Auto-reveal only activates when a folder is open (`root !== null`). With no folder open, auto-reveal is a no-op. This is already effectively the case since the tree is not rendered without a root, but the logic should include an explicit guard.

## 6. State Changes Summary

### New State

| Field | Type | Persisted | Description |
|---|---|---|---|
| `recentItems` | `RecentItem[]` | Yes | Up to 5 recently opened files/folders |

### New Actions

| Action | Description |
|---|---|
| `addRecentItem(path, type)` | Add or promote an item in recent list |
| `closeFolder()` | Set root to null, clear expandedFolders, stop watcher |

### Removed State

| Field | Notes |
|---|---|
| `folderPaneVisible` | Removed from state and persistence |
| `toggleFolderPane()` | Removed action |

### Persistence Changes

- Remove `folderPaneVisible` from persisted keys
- Add `recentItems` to persisted keys

## 7. Files Affected

### Rust Layer (`src-tauri/src/`)

- `lib.rs` — Menu restructure (shortcuts, items), CLI flag parsing, remove expand/collapse handlers
- `commands.rs` — Update `LaunchArgs` struct to support `--folder`/`--file` flags with relative path resolution

### Frontend (`src/`)

- `store/index.ts` — New state fields, actions, persistence config changes
- `App.tsx` — Remove folder pane toggle, update menu event handlers, update toolbar, wire close-folder
- `components/FolderTree/FolderTree.tsx` — Remove expand/collapse buttons, add close button, explicit auto-reveal guard
- `components/WelcomeView.tsx` — **New component** for empty state with actions and recent items
- CSS/styles — Folder pane slide transition

### Tests

- Update persistence tests to reflect removed/added persisted keys
- Add unit tests for `addRecentItem` and `closeFolder` actions
- Add component tests for `WelcomeView`
- Update E2E tests for new menu structure and shortcuts
- Update any tests that reference `folderPaneVisible` or expand/collapse

## 8. Non-Goals

- Drag-and-drop folder opening (future enhancement)
- Pinned/favorite folders
- Recent items in native OS "Open Recent" submenu (future enhancement)
- Folder pane resizing animation (existing resize behavior is unchanged)
