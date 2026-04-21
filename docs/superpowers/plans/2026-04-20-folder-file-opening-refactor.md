# Folder/File Opening UX Refactoring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure folder/file opening UX — new shortcuts, CLI flags, conditional folder pane, welcome view with recent items, simplified folder tree.

**Architecture:** Remove the manual folder pane toggle; pane visibility is derived from `root !== null`. Add `recentItems` and `closeFolder()` to Zustand store. Add `--folder`/`--file` CLI flags in Rust with relative path resolution. Create a `WelcomeView` component for the empty state. Restructure native menus and toolbar.

**Tech Stack:** Tauri v2 (Rust), React 18, TypeScript, Zustand, Vitest, Playwright

---

### Task 1: Store — Remove `folderPaneVisible` and `toggleFolderPane`, add `closeFolder` and `recentItems`

**Files:**
- Modify: `src/store/index.ts`
- Test: `src/__tests__/store/persistence.test.ts`
- Test: `src/__tests__/store/workspace.test.ts`

This task removes the manual folder pane toggle from the store and adds the new `closeFolder()` action and `recentItems` state with `addRecentItem()`.

- [ ] **Step 1: Write failing tests for `closeFolder` and `recentItems`**

Add a new test file for the new store actions:

```typescript
// src/__tests__/store/recentItems.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store/index";

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
});

describe("recentItems — addRecentItem", () => {
  it("adds a file to recentItems", () => {
    useStore.getState().addRecentItem("/docs/readme.md", "file");
    const items = useStore.getState().recentItems;
    expect(items).toHaveLength(1);
    expect(items[0].path).toBe("/docs/readme.md");
    expect(items[0].type).toBe("file");
    expect(typeof items[0].timestamp).toBe("number");
  });

  it("adds a folder to recentItems", () => {
    useStore.getState().addRecentItem("/workspace/docs", "folder");
    const items = useStore.getState().recentItems;
    expect(items).toHaveLength(1);
    expect(items[0].path).toBe("/workspace/docs");
    expect(items[0].type).toBe("folder");
  });

  it("deduplicates by moving existing item to front", () => {
    useStore.getState().addRecentItem("/a.md", "file");
    useStore.getState().addRecentItem("/b.md", "file");
    useStore.getState().addRecentItem("/a.md", "file");
    const items = useStore.getState().recentItems;
    expect(items).toHaveLength(2);
    expect(items[0].path).toBe("/a.md");
    expect(items[1].path).toBe("/b.md");
  });

  it("evicts oldest item when exceeding max 5", () => {
    for (let i = 1; i <= 6; i++) {
      useStore.getState().addRecentItem(`/file${i}.md`, "file");
    }
    const items = useStore.getState().recentItems;
    expect(items).toHaveLength(5);
    expect(items[0].path).toBe("/file6.md");
    expect(items[4].path).toBe("/file2.md");
    // /file1.md should have been evicted
    expect(items.find((i) => i.path === "/file1.md")).toBeUndefined();
  });

  it("most recent item is first in the array", () => {
    useStore.getState().addRecentItem("/first.md", "file");
    useStore.getState().addRecentItem("/second.md", "file");
    const items = useStore.getState().recentItems;
    expect(items[0].path).toBe("/second.md");
    expect(items[1].path).toBe("/first.md");
  });
});

describe("closeFolder", () => {
  it("sets root to null", () => {
    useStore.getState().setRoot("/workspace");
    useStore.getState().closeFolder();
    expect(useStore.getState().root).toBeNull();
  });

  it("clears expandedFolders", () => {
    useStore.getState().setRoot("/workspace");
    useStore.getState().setFolderExpanded("/workspace/sub", true);
    useStore.getState().closeFolder();
    expect(useStore.getState().expandedFolders).toEqual({});
  });

  it("keeps open tabs unchanged", () => {
    useStore.getState().setRoot("/workspace");
    useStore.getState().openFile("/workspace/readme.md");
    useStore.getState().closeFolder();
    expect(useStore.getState().tabs).toHaveLength(1);
    expect(useStore.getState().activeTabPath).toBe("/workspace/readme.md");
  });

  it("is a no-op when root is already null", () => {
    useStore.getState().closeFolder();
    expect(useStore.getState().root).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/store/recentItems.test.ts`
Expected: FAIL — `addRecentItem` and `closeFolder` are not defined on the store.

- [ ] **Step 3: Implement store changes**

Edit `src/store/index.ts`:

1. Add `RecentItem` interface and export it:

```typescript
export interface RecentItem {
  path: string;
  type: "file" | "folder";
  timestamp: number;
}

const MAX_RECENT_ITEMS = 5;
```

2. Mark `folderPaneVisible` and `toggleFolderPane` as deprecated in the `UISlice` interface (keep them temporarily so App.tsx/FolderTree still compile — they'll be removed in Tasks 4/5):

```typescript
interface UISlice {
  theme: Theme;
  folderPaneWidth: number;
  /** @deprecated — will be removed. Pane visibility is now derived from root !== null */
  folderPaneVisible: boolean;
  commentsPaneVisible: boolean;
  setTheme: (theme: Theme) => void;
  setFolderPaneWidth: (width: number) => void;
  /** @deprecated — will be removed in Task 4 */
  toggleFolderPane: () => void;
  toggleCommentsPane: () => void;
}
```

3. Add `recentItems`, `addRecentItem`, and `closeFolder` to slices:

Add to `WorkspaceSlice`:
```typescript
closeFolder: () => void;
```

Add a new `RecentSlice`:
```typescript
interface RecentSlice {
  recentItems: RecentItem[];
  addRecentItem: (path: string, type: "file" | "folder") => void;
}
```

4. Update the combined Store type:
```typescript
type Store = WorkspaceSlice & TabsSlice & CommentsSlice & UISlice & UpdateSlice & WatcherSlice & RecentSlice;
```

5. Implement in the `create()` body:

Keep `folderPaneVisible` and `toggleFolderPane` implementations intact for now (they'll be removed in Task 4 when App.tsx stops using them).

Add `closeFolder`:
```typescript
closeFolder: () => set({ root: null, expandedFolders: {} }),
```

Add recent items state:
```typescript
// Recent items
recentItems: [],
addRecentItem: (path, type) =>
  set((s) => {
    const filtered = s.recentItems.filter((item) => item.path !== path);
    const newItem: RecentItem = { path, type, timestamp: Date.now() };
    const updated = [newItem, ...filtered].slice(0, MAX_RECENT_ITEMS);
    return { recentItems: updated };
  }),
```

6. Update `partialize` in persist config — remove `folderPaneVisible`, add `recentItems`:
```typescript
partialize: (state) => ({
  theme: state.theme,
  folderPaneWidth: state.folderPaneWidth,
  commentsPaneVisible: state.commentsPaneVisible,
  root: state.root,
  expandedFolders: state.expandedFolders,
  autoReveal: state.autoReveal,
  authorName: state.authorName,
  recentItems: state.recentItems,
}),
```

- [ ] **Step 4: Update persistence tests**

Edit `src/__tests__/store/persistence.test.ts`:

1. Add `recentItems` to `getPersistedSnapshot()`:
```typescript
function getPersistedSnapshot() {
  const state = useStore.getState();
  return {
    theme: state.theme,
    folderPaneWidth: state.folderPaneWidth,
    folderPaneVisible: state.folderPaneVisible,
    commentsPaneVisible: state.commentsPaneVisible,
    root: state.root,
    expandedFolders: state.expandedFolders,
    autoReveal: state.autoReveal,
    authorName: state.authorName,
    recentItems: state.recentItems,
  };
}
```
2. Add a test for `recentItems`:
```typescript
it("includes recentItems in the persisted snapshot", () => {
  useStore.getState().addRecentItem("/test/file.md", "file");
  const snapshot = getPersistedSnapshot();
  expect(snapshot).toHaveProperty("recentItems");
  expect(snapshot.recentItems).toHaveLength(1);
});
```
3. Update the `"persisted snapshot has exactly the expected keys"` test — add `"recentItems"` and `"authorName"` and `"autoReveal"` to the expected keys:
```typescript
expect(keys).toEqual(
  ["authorName", "autoReveal", "commentsPaneVisible", "expandedFolders", "folderPaneVisible", "folderPaneWidth", "recentItems", "root", "theme"].sort()
);
```

Note: `folderPaneVisible` is kept for now (deprecated but still persisted). It will be removed from the persistence snapshot when Task 4 fully removes it from the store.

- [ ] **Step 5: Run all store tests**

Run: `npx vitest run src/__tests__/store/`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/store/index.ts src/__tests__/store/recentItems.test.ts src/__tests__/store/persistence.test.ts
git commit -m "feat: add closeFolder, recentItems; remove folderPaneVisible from store

- Add closeFolder() action (sets root null, clears expandedFolders)
- Add recentItems state with addRecentItem() (max 5, dedup, MRU order)
- Remove folderPaneVisible and toggleFolderPane from UISlice
- Update persistence: remove folderPaneVisible, add recentItems"
```

---

### Task 2: Rust — CLI flag parsing (`--folder`, `--file`) with relative path resolution

**Files:**
- Modify: `src-tauri/src/lib.rs:89-101` (setup hook CLI parsing)
- Modify: `src-tauri/src/lib.rs:52-67` (single-instance handler)
- Modify: `src-tauri/src/commands.rs` (add `check_path_exists` command)
- Test: `src-tauri/tests/commands_integration.rs` (if exists, add test)

- [ ] **Step 1: Add `check_path_exists` Tauri command**

The welcome view needs to check if recent items still exist on disk. Add to `src-tauri/src/commands.rs`:

```rust
/// Check if a path exists and whether it is a directory or file.
/// Returns "file", "dir", or "missing".
#[tauri::command]
pub fn check_path_exists(path: String) -> String {
    match std::fs::metadata(&path) {
        Ok(meta) if meta.is_dir() => "dir".to_string(),
        Ok(_) => "file".to_string(),
        Err(_) => "missing".to_string(),
    }
}
```

Register it in `src-tauri/src/lib.rs` invoke_handler:
```rust
.invoke_handler(tauri::generate_handler![
    commands::read_dir,
    commands::read_text_file,
    commands::read_binary_file,
    commands::save_review_comments,
    commands::load_review_comments,
    commands::get_launch_args,
    commands::get_log_path,
    commands::scan_review_files,
    commands::get_git_head,
    commands::check_path_exists,
    watcher::update_watched_files,
])
```

- [ ] **Step 2: Add typed wrapper in `tauri-commands.ts`**

Add to `src/lib/tauri-commands.ts`:

```typescript
export const checkPathExists = (path: string): Promise<"file" | "dir" | "missing"> =>
  invoke<"file" | "dir" | "missing">("check_path_exists", { path });
```

- [ ] **Step 3: Implement `--folder`/`--file` flag parsing in Rust**

Replace the CLI parsing block in `src-tauri/src/lib.rs` setup hook (lines ~89-101):

```rust
// Parse CLI args: support --folder <path> and --file <path> flags,
// with fallback to auto-detect for positional args.
let raw_args: Vec<String> = std::env::args().skip(1).collect();
let cwd = std::env::current_dir().unwrap_or_default();
let mut files = Vec::new();
let mut folders = Vec::new();
let mut i = 0;
while i < raw_args.len() {
    let arg = &raw_args[i];
    if arg == "--folder" {
        i += 1;
        if let Some(val) = raw_args.get(i) {
            let resolved = cwd.join(val);
            if let Ok(canon) = std::fs::canonicalize(&resolved) {
                folders.push(canon.to_string_lossy().into_owned());
            }
        }
    } else if arg == "--file" {
        i += 1;
        if let Some(val) = raw_args.get(i) {
            let resolved = cwd.join(val);
            if let Ok(canon) = std::fs::canonicalize(&resolved) {
                files.push(canon.to_string_lossy().into_owned());
            }
        }
    } else if !arg.starts_with('-') {
        // Positional arg: auto-detect
        let resolved = cwd.join(arg);
        if let Ok(canon) = std::fs::canonicalize(&resolved) {
            match std::fs::metadata(&canon) {
                Ok(meta) if meta.is_dir() => folders.push(canon.to_string_lossy().into_owned()),
                Ok(_) => files.push(canon.to_string_lossy().into_owned()),
                Err(_) => {}
            }
        }
    }
    i += 1;
}
```

- [ ] **Step 4: Update single-instance handler with same parsing logic**

Replace the single-instance arg parsing in `src-tauri/src/lib.rs` (lines ~52-67). The `_cwd` parameter from `tauri_plugin_single_instance::init` provides the second instance's working directory:

```rust
tauri_plugin_single_instance::init(|app, argv, cwd| {
    let cwd_path = std::path::PathBuf::from(&cwd);
    let mut files = Vec::new();
    let mut folders = Vec::new();
    let mut i = 1; // skip binary name
    while i < argv.len() {
        let arg = &argv[i];
        if arg == "--folder" {
            i += 1;
            if let Some(val) = argv.get(i) {
                let resolved = cwd_path.join(val);
                if let Ok(canon) = std::fs::canonicalize(&resolved) {
                    folders.push(canon.to_string_lossy().into_owned());
                }
            }
        } else if arg == "--file" {
            i += 1;
            if let Some(val) = argv.get(i) {
                let resolved = cwd_path.join(val);
                if let Ok(canon) = std::fs::canonicalize(&resolved) {
                    files.push(canon.to_string_lossy().into_owned());
                }
            }
        } else if !arg.starts_with('-') {
            let resolved = cwd_path.join(arg);
            if let Ok(canon) = std::fs::canonicalize(&resolved) {
                match std::fs::metadata(&canon) {
                    Ok(meta) if meta.is_dir() => folders.push(canon.to_string_lossy().into_owned()),
                    Ok(_) => files.push(canon.to_string_lossy().into_owned()),
                    Err(_) => {}
                }
            }
        }
        i += 1;
    }
    let payload = serde_json::json!({ "files": files, "folders": folders });
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("args-received", payload);
    }
})
```

- [ ] **Step 5: Extract shared parse function to avoid duplication**

Both the setup hook and single-instance handler now share the same parsing logic. Extract it into a helper function in `lib.rs`:

```rust
/// Parse CLI-style arguments into files and folders lists.
/// Supports --folder <path>, --file <path>, and positional auto-detect.
/// All paths are resolved relative to `cwd`.
fn parse_args(args: &[String], cwd: &std::path::Path) -> (Vec<String>, Vec<String>) {
    let mut files = Vec::new();
    let mut folders = Vec::new();
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        if arg == "--folder" {
            i += 1;
            if let Some(val) = args.get(i) {
                let resolved = cwd.join(val);
                if let Ok(canon) = std::fs::canonicalize(&resolved) {
                    folders.push(canon.to_string_lossy().into_owned());
                }
            }
        } else if arg == "--file" {
            i += 1;
            if let Some(val) = args.get(i) {
                let resolved = cwd.join(val);
                if let Ok(canon) = std::fs::canonicalize(&resolved) {
                    files.push(canon.to_string_lossy().into_owned());
                }
            }
        } else if !arg.starts_with('-') {
            let resolved = cwd.join(arg);
            if let Ok(canon) = std::fs::canonicalize(&resolved) {
                match std::fs::metadata(&canon) {
                    Ok(meta) if meta.is_dir() => folders.push(canon.to_string_lossy().into_owned()),
                    Ok(_) => files.push(canon.to_string_lossy().into_owned()),
                    Err(_) => {}
                }
            }
        }
        i += 1;
    }
    (files, folders)
}
```

Then both call sites become:
```rust
// Setup hook:
let raw_args: Vec<String> = std::env::args().skip(1).collect();
let cwd = std::env::current_dir().unwrap_or_default();
let (files, folders) = parse_args(&raw_args, &cwd);

// Single-instance:
let cwd_path = std::path::PathBuf::from(&cwd);
let (files, folders) = parse_args(&argv[1..], &cwd_path);
```

- [ ] **Step 6: Build and test Rust**

Run: `cd src-tauri && cargo test`
Expected: ALL PASS (or no Rust tests break)

Run: `cd src-tauri && cargo build`
Expected: BUILD SUCCESS

- [ ] **Step 7: Update Tauri mock in test infrastructure**

Update `src/__mocks__/@tauri-apps/api/core.ts` to include `check_path_exists` in the `InvokeResult` type:

```typescript
type InvokeResult =
  | string
  | string[]
  | DirEntry[]
  | LaunchArgs
  | ReviewComments
  | "file" | "dir" | "missing"
  | null
  | void;
```

(Note: `string` already covers these values, but keeping explicit for documentation.)

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/commands.rs src/lib/tauri-commands.ts src/__mocks__/@tauri-apps/api/core.ts
git commit -m "feat: add --folder/--file CLI flags with relative path resolution

- Extract parse_args() helper for shared CLI parsing logic
- Support --folder <path> and --file <path> with CWD resolution
- Keep positional auto-detect as backwards-compatible fallback
- Add check_path_exists Tauri command for welcome view"
```

---

### Task 3: Rust — Menu restructure (shortcuts, Close Folder, remove expand/collapse)

**Files:**
- Modify: `src-tauri/src/lib.rs:104-191` (menu building and event handling)

- [ ] **Step 1: Update the menu definition in lib.rs**

Replace the entire menu building section (lines ~104-166) with:

```rust
// ── Build application menu ────────────────────────────────────────

// File menu
let open_file = MenuItem::with_id(app, "open-file", "Open File…", true, Some("CmdOrCtrl+O"))?;
let open_folder = MenuItem::with_id(app, "open-folder", "Open Folder…", true, Some("CmdOrCtrl+Shift+O"))?;
let close_folder = MenuItem::with_id(app, "close-folder", "Close Folder", true, None::<&str>)?;
let close_tab = MenuItem::with_id(app, "close-tab", "Close Tab", true, Some("CmdOrCtrl+W"))?;
let close_all_tabs = MenuItem::with_id(app, "close-all-tabs", "Close All Tabs", true, Some("CmdOrCtrl+Shift+W"))?;
let file_menu = SubmenuBuilder::new(app, "File")
    .item(&open_file)
    .item(&open_folder)
    .item(&close_folder)
    .separator()
    .item(&close_tab)
    .item(&close_all_tabs)
    .separator()
    .quit()
    .build()?;

// View menu — panes (no folder pane toggle, no expand/collapse)
let toggle_comments_pane = MenuItem::with_id(app, "toggle-comments-pane", "Toggle Comments Pane", true, Some("CmdOrCtrl+Shift+C"))?;
// View menu — tab navigation
let next_tab = MenuItem::with_id(app, "next-tab", "Next Tab", true, None::<&str>)?;
let prev_tab = MenuItem::with_id(app, "prev-tab", "Previous Tab", true, None::<&str>)?;
// View menu — theme submenu
let theme_system = MenuItem::with_id(app, "theme-system", "System Theme", true, None::<&str>)?;
let theme_light = MenuItem::with_id(app, "theme-light", "Light Theme", true, None::<&str>)?;
let theme_dark = MenuItem::with_id(app, "theme-dark", "Dark Theme", true, None::<&str>)?;
let theme_menu = SubmenuBuilder::new(app, "Theme")
    .item(&theme_system)
    .item(&theme_light)
    .item(&theme_dark)
    .build()?;
let view_menu = SubmenuBuilder::new(app, "View")
    .item(&toggle_comments_pane)
    .separator()
    .item(&next_tab)
    .item(&prev_tab)
    .separator()
    .item(&theme_menu)
    .build()?;

// Help menu (unchanged)
let about_item = MenuItem::with_id(app, "about", "About mdownreview", true, None::<&str>)?;
let check_updates = MenuItem::with_id(app, "check-updates", "Check for Updates…", true, None::<&str>)?;
let help_menu = SubmenuBuilder::new(app, "Help")
    .item(&about_item)
    .separator()
    .item(&check_updates)
    .build()?;

let menu = MenuBuilder::new(app)
    .item(&file_menu)
    .item(&view_menu)
    .item(&help_menu)
    .build()?;

app.set_menu(menu)?;
```

- [ ] **Step 2: Update menu event handler**

Replace the `on_menu_event` handler (lines ~170-191) — remove `toggle-folder-pane`, `expand-all`, `collapse-all`, add `close-folder`:

```rust
app.on_menu_event(|app, event| {
    let Some(window) = app.get_webview_window("main") else { return };
    let event_name = match event.id().as_ref() {
        "open-file" => "menu-open-file",
        "open-folder" => "menu-open-folder",
        "close-folder" => "menu-close-folder",
        "close-tab" => "menu-close-tab",
        "close-all-tabs" => "menu-close-all-tabs",
        "toggle-comments-pane" => "menu-toggle-comments-pane",
        "next-tab" => "menu-next-tab",
        "prev-tab" => "menu-prev-tab",
        "theme-system" => "menu-theme-system",
        "theme-light" => "menu-theme-light",
        "theme-dark" => "menu-theme-dark",
        "about" => "menu-about",
        "check-updates" => "menu-check-updates",
        _ => return,
    };
    let _ = window.emit(event_name, ());
});
```

- [ ] **Step 3: Build Rust**

Run: `cd src-tauri && cargo build`
Expected: BUILD SUCCESS

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: restructure native menus — new shortcuts, close folder, remove expand/collapse

- Ctrl+O now opens file, Ctrl+Shift+O opens folder
- Add Close Folder menu item
- Remove Toggle Folder Pane, Expand All, Collapse All from View menu
- Update menu event forwarding"
```

---

### Task 4: Frontend — App.tsx toolbar and menu event cleanup

**Files:**
- Modify: `src/App.tsx`

This task removes the folder pane toggle from the toolbar, removes stale keyboard shortcuts and menu listeners, and wires up new ones.

- [ ] **Step 1: Remove deprecated store fields from App**

Remove `folderPaneVisible` and `toggleFolderPane` from the useStore() destructure. Add `root`, `closeFolder`, and `addRecentItem`:

```typescript
const {
  theme,
  setTheme,
  root,
  folderPaneWidth,
  setFolderPaneWidth,
  commentsPaneVisible,
  toggleCommentsPane,
  activeTabPath,
  openFile,
  setRoot,
  closeFolder,
  addRecentItem,
} = useStore();
```

After this step, also go back to `src/store/index.ts` and fully remove `folderPaneVisible`, `toggleFolderPane`, and their persistence. Remove from UISlice interface, remove the implementations, remove from `partialize`. Update `src/__tests__/store/persistence.test.ts` to remove `folderPaneVisible` from the snapshot helper and expected keys:

```typescript
function getPersistedSnapshot() {
  const state = useStore.getState();
  return {
    theme: state.theme,
    folderPaneWidth: state.folderPaneWidth,
    commentsPaneVisible: state.commentsPaneVisible,
    root: state.root,
    expandedFolders: state.expandedFolders,
    autoReveal: state.autoReveal,
    authorName: state.authorName,
    recentItems: state.recentItems,
  };
}
```

Remove the test `"includes folderPaneVisible in the persisted snapshot"`. Update expected keys:
```typescript
expect(keys).toEqual(
  ["authorName", "autoReveal", "commentsPaneVisible", "expandedFolders", "folderPaneWidth", "recentItems", "root", "theme"].sort()
);
```

- [ ] **Step 2: Remove Ctrl+B from keyboard handler**

In the `useEffect` for global keyboard shortcuts (lines ~168-209), remove the `Ctrl+B` handler block and add `Ctrl+O` / `Ctrl+Shift+O`:

```typescript
// REMOVE this block:
if (mod && e.key === "b") {
  e.preventDefault();
  toggleFolderPane();
}
```

Add handlers for opening files/folders (non-native fallback for e2e/web):
```typescript
if (mod && !e.shiftKey && e.key === "o") {
  e.preventDefault();
  handleOpenFile();
}
if (mod && e.shiftKey && e.key === "O") {
  e.preventDefault();
  handleOpenFolder();
}
```

Update the effect dependencies — remove `toggleFolderPane`, add `handleOpenFile`, `handleOpenFolder`.

- [ ] **Step 3: Wire recent items into handleOpenFile and handleOpenFolder**

Update `handleOpenFile` to call `addRecentItem`:
```typescript
const handleOpenFile = useCallback(async () => {
  try {
    const selected = await open({ directory: false, multiple: true });
    if (Array.isArray(selected)) {
      for (const f of selected) {
        openFile(f);
        addRecentItem(f, "file");
      }
    } else if (typeof selected === "string") {
      openFile(selected);
      addRecentItem(selected, "file");
    }
  } catch {
    // User cancelled or dialog error — ignore
  }
}, [openFile, addRecentItem]);
```

Update `handleOpenFolder` to call `addRecentItem`:
```typescript
const handleOpenFolder = useCallback(async () => {
  try {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setRoot(selected);
      addRecentItem(selected, "folder");
    }
  } catch {
    // User cancelled or dialog error — ignore
  }
}, [setRoot, addRecentItem]);
```

- [ ] **Step 4: Update native menu event listeners**

In the `useEffect` for native menu events (lines ~265-297):
- Remove `listen("menu-toggle-folder-pane", ...)` line
- Remove `listen("menu-collapse-all", ...)` line
- Add `listen("menu-close-folder", () => useStore.getState().closeFolder())`
- Update `listen("menu-open-folder", ...)` to call `handleOpenFolder()` (it currently isn't wired here — it's in FolderTree):

```typescript
useEffect(() => {
  const pending = [
    listen("menu-open-file", () => handleOpenFile()),
    listen("menu-open-folder", () => handleOpenFolder()),
    listen("menu-close-folder", () => useStore.getState().closeFolder()),
    listen("menu-toggle-comments-pane", () => toggleCommentsPane()),
    listen("menu-close-tab", () => {
      const { activeTabPath, closeTab } = useStore.getState();
      if (activeTabPath) closeTab(activeTabPath);
    }),
    listen("menu-close-all-tabs", () => useStore.getState().closeAllTabs()),
    listen("menu-next-tab", () => {
      const { tabs, activeTabPath, setActiveTab } = useStore.getState();
      if (tabs.length < 2) return;
      const idx = tabs.findIndex((t) => t.path === activeTabPath);
      setActiveTab(tabs[(idx + 1) % tabs.length].path);
    }),
    listen("menu-prev-tab", () => {
      const { tabs, activeTabPath, setActiveTab } = useStore.getState();
      if (tabs.length < 2) return;
      const idx = tabs.findIndex((t) => t.path === activeTabPath);
      setActiveTab(tabs[(idx - 1 + tabs.length) % tabs.length].path);
    }),
    listen("menu-theme-system", () => setTheme("system")),
    listen("menu-theme-light", () => setTheme("light")),
    listen("menu-theme-dark", () => setTheme("dark")),
    listen("menu-about", () => setAboutOpen(true)),
    listen("menu-check-updates", () => triggerUpdateCheck()),
  ];
  return () => {
    pending.forEach((p) => p.then((fn) => fn()).catch(() => {}));
  };
}, [handleOpenFile, handleOpenFolder, toggleCommentsPane, setTheme, triggerUpdateCheck]);
```

- [ ] **Step 5: Remove the Folders toggle button from toolbar and the `IconSidebar` component**

Remove from toolbar JSX — delete the entire `<button>` for folder pane toggle:

```tsx
{/* REMOVE THIS BUTTON: */}
<button
  className={`toolbar-btn toolbar-btn-toggle${folderPaneVisible ? " active" : ""}`}
  onClick={toggleFolderPane}
  title="Toggle folder pane (Ctrl+B)"
>
  <IconSidebar /> Folders
</button>
```

Also remove the `IconSidebar` function component (lines ~42-50) since it's no longer used.

- [ ] **Step 6: Update folder pane rendering — conditional on `root`**

Replace the current folder pane section in the main-area JSX. The pane wrapper is always mounted for CSS transitions, but children only render when root is set:

```tsx
<div className="main-area">
  <div
    className={`folder-pane-wrapper${root === null ? " folder-pane-hidden" : ""}`}
    style={{ "--folder-pane-width": `${folderPaneWidth}px` } as React.CSSProperties}
  >
    {root !== null && (
      <>
        <ErrorBoundary>
          <FolderTree onFileOpen={openFile} onCloseFolder={closeFolder} />
        </ErrorBoundary>
        <div className="drag-handle" onMouseDown={onDragStart} />
      </>
    )}
  </div>

  <div className="viewer-area">
    <TabBar />
    <ErrorBoundary>
      {activeTabPath ? (
        <ViewerRouter path={activeTabPath} />
      ) : (
        <WelcomeView onOpenFile={handleOpenFile} onOpenFolder={handleOpenFolder} />
      )}
    </ErrorBoundary>
  </div>

  {commentsPaneVisible && activeTabPath && getFileCategory(activeTabPath) !== "image" && (
    <ErrorBoundary>
      <CommentsPanel filePath={activeTabPath} />
    </ErrorBoundary>
  )}
</div>
```

- [ ] **Step 7: Add WelcomeView import (placeholder — component created in Task 6)**

Add import at the top of App.tsx:
```typescript
import { WelcomeView } from "@/components/WelcomeView";
```

For now, create a minimal placeholder so the build doesn't break:

Create `src/components/WelcomeView.tsx`:
```tsx
interface WelcomeViewProps {
  onOpenFile: () => void;
  onOpenFolder: () => void;
}

export function WelcomeView({ onOpenFile, onOpenFolder }: WelcomeViewProps) {
  return (
    <div className="empty-state">
      <p>Open a folder to get started</p>
    </div>
  );
}
```

- [ ] **Step 8: Build frontend**

Run: `npm run build`
Expected: BUILD SUCCESS

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/components/WelcomeView.tsx
git commit -m "feat: update App.tsx — remove folder toggle, wire close folder, conditional pane

- Remove folder pane toggle button and Ctrl+B shortcut
- Remove IconSidebar component
- Folder pane conditional on root !== null
- Wire menu-close-folder and menu-open-folder events
- Add recentItem tracking to handleOpenFile/handleOpenFolder
- Add WelcomeView placeholder"
```

---

### Task 5: FolderTree — Remove expand/collapse, add close button

**Files:**
- Modify: `src/components/FolderTree/FolderTree.tsx`
- Modify: `src/styles/folder-tree.css`

- [ ] **Step 1: Update FolderTree props to accept `onCloseFolder`**

```typescript
interface FolderTreeProps {
  onFileOpen: (path: string) => void;
  onCloseFolder: () => void;
}

export function FolderTree({ onFileOpen, onCloseFolder }: FolderTreeProps) {
```

- [ ] **Step 2: Remove expand/collapse from toolbar**

Remove the Collapse All and Expand All buttons from the first toolbar `<div>`. Replace with a header showing the folder name, auto-reveal toggle, and close button:

```tsx
<div className="folder-tree-toolbar folder-tree-header">
  <span className="folder-tree-title" title={root ?? ""}>
    📁 {root ? root.split(/[/\\]/).pop() : ""}
  </span>
  <span className="folder-tree-header-actions">
    <button
      className={`folder-tree-btn${autoReveal ? " active" : ""}`}
      onClick={toggleAutoReveal}
      title={autoReveal ? "Auto-reveal: ON" : "Auto-reveal: OFF"}
    >
      📍
    </button>
    <button
      className="folder-tree-btn folder-tree-close-btn"
      onClick={onCloseFolder}
      title="Close folder"
    >
      ✕
    </button>
  </span>
</div>
```

- [ ] **Step 3: Remove expand/collapse-related code and auto-root logic**

1. Remove `handleExpandAll` callback and related state (`isExpanding`, `expandGenRef`, `cancelExpand`).
2. Remove `MAX_EXPAND_DEPTH` constant.
3. Remove menu event listeners for `menu-open-folder`, `menu-expand-all`, `menu-collapse-all` (these are now handled in App.tsx).
4. Remove the `expandAllRef` ref.
5. Keep `collapseAll` in store import (it's still used by `setRoot`).
6. **Remove the auto-root `useEffect`** (lines 62-84 in current FolderTree.tsx) and the `autoRootRef`. Auto-root is incompatible with the new design where pane visibility = root set. Without this removal, `closeFolder()` would immediately re-root when an active tab exists, re-showing the pane.

Remove this entire block:
```typescript
// Auto-root to active file's parent when no workspace
useEffect(() => {
  if (!activeTabPath) {
    if (autoRootRef.current && root === autoRootRef.current) {
      useStore.setState({ root: null });
      autoRootRef.current = null;
    }
    return;
  }
  if (root && root !== autoRootRef.current) return;
  const sep = activeTabPath.includes("/") ? "/" : "\\";
  const parts = activeTabPath.split(sep);
  parts.pop();
  const parentDir = parts.join(sep);
  if (parentDir && parentDir !== root) {
    autoRootRef.current = parentDir;
    useStore.setState({ root: parentDir, expandedFolders: {} });
  }
}, [activeTabPath, root]);
```

And remove `autoRootRef`:
```typescript
const autoRootRef = useRef<string | null>(null);
```

- [ ] **Step 4: Remove the "No folder open" empty state**

Since the FolderTree component is now only rendered when `root !== null`, remove the `!root` branch from the scroll area:

```tsx
<div className="folder-tree-scroll" ref={containerRef}>
  {mergedList.length === 0 ? (
    <div className="folder-tree-empty">{filter ? "No matches" : "Empty folder"}</div>
  ) : (
    mergedList.map(({ path, isDir, depth, name, isGhost }) => {
      // ... existing tree rendering
    })
  )}
</div>
```

- [ ] **Step 5: Add CSS for folder tree header**

Add to `src/styles/folder-tree.css`:

```css
.folder-tree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px;
  gap: 4px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.folder-tree-title {
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.folder-tree-header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.folder-tree-close-btn {
  font-size: 13px;
  line-height: 1;
}
```

- [ ] **Step 6: Build frontend**

Run: `npm run build`
Expected: BUILD SUCCESS

- [ ] **Step 7: Commit**

```bash
git add src/components/FolderTree/FolderTree.tsx src/styles/folder-tree.css
git commit -m "feat: simplify folder tree — remove expand/collapse, add close button

- Remove Expand All / Collapse All buttons and menu listeners
- Add folder name header with auto-reveal toggle and close (×) button
- Remove 'No folder open' empty state (component only renders when root set)
- Accept onCloseFolder prop from App"
```

---

### Task 6: WelcomeView component with recent items

**Files:**
- Modify: `src/components/WelcomeView.tsx` (replace placeholder)
- Create: `src/styles/welcome-view.css`
- Create: `src/__tests__/components/WelcomeView.test.tsx`

- [ ] **Step 1: Write failing component tests**

```typescript
// src/__tests__/components/WelcomeView.test.tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WelcomeView } from "@/components/WelcomeView";
import { useStore } from "@/store/index";

vi.mock("@/lib/tauri-commands", () => ({
  checkPathExists: vi.fn().mockResolvedValue("file"),
}));

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
});

describe("WelcomeView", () => {
  it("renders Open File and Open Folder actions", () => {
    render(<WelcomeView onOpenFile={vi.fn()} onOpenFolder={vi.fn()} />);
    expect(screen.getByText("Open File")).toBeInTheDocument();
    expect(screen.getByText("Open Folder")).toBeInTheDocument();
  });

  it("shows keyboard shortcuts", () => {
    render(<WelcomeView onOpenFile={vi.fn()} onOpenFolder={vi.fn()} />);
    // Kbd elements for shortcuts
    expect(screen.getByText("Ctrl+O")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+Shift+O")).toBeInTheDocument();
  });

  it("calls onOpenFile when Open File is clicked", () => {
    const onOpenFile = vi.fn();
    render(<WelcomeView onOpenFile={onOpenFile} onOpenFolder={vi.fn()} />);
    fireEvent.click(screen.getByText("Open File"));
    expect(onOpenFile).toHaveBeenCalledOnce();
  });

  it("calls onOpenFolder when Open Folder is clicked", () => {
    const onOpenFolder = vi.fn();
    render(<WelcomeView onOpenFile={vi.fn()} onOpenFolder={onOpenFolder} />);
    fireEvent.click(screen.getByText("Open Folder"));
    expect(onOpenFolder).toHaveBeenCalledOnce();
  });

  it("hides recent section when no recent items", () => {
    render(<WelcomeView onOpenFile={vi.fn()} onOpenFolder={vi.fn()} />);
    expect(screen.queryByText("Recent")).not.toBeInTheDocument();
  });

  it("shows recent items when they exist in store", () => {
    useStore.getState().addRecentItem("/docs/readme.md", "file");
    useStore.getState().addRecentItem("/workspace/project", "folder");
    render(<WelcomeView onOpenFile={vi.fn()} onOpenFolder={vi.fn()} />);
    expect(screen.getByText("Recent")).toBeInTheDocument();
    expect(screen.getByText(/readme\.md/)).toBeInTheDocument();
    expect(screen.getByText(/project/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/components/WelcomeView.test.tsx`
Expected: FAIL (placeholder component doesn't have the expected content)

- [ ] **Step 3: Implement WelcomeView component**

Replace `src/components/WelcomeView.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useStore } from "@/store";
import type { RecentItem } from "@/store";
import { checkPathExists } from "@/lib/tauri-commands";
import "@/styles/welcome-view.css";

interface WelcomeViewProps {
  onOpenFile: () => void;
  onOpenFolder: () => void;
}

export function WelcomeView({ onOpenFile, onOpenFolder }: WelcomeViewProps) {
  const recentItems = useStore((s) => s.recentItems);
  const openFile = useStore((s) => s.openFile);
  const setRoot = useStore((s) => s.setRoot);
  const addRecentItem = useStore((s) => s.addRecentItem);
  const [pathStatus, setPathStatus] = useState<Record<string, "file" | "dir" | "missing">>({});

  useEffect(() => {
    let cancelled = false;
    async function checkAll() {
      const results: Record<string, "file" | "dir" | "missing"> = {};
      await Promise.all(
        recentItems.map(async (item) => {
          try {
            results[item.path] = await checkPathExists(item.path);
          } catch {
            results[item.path] = "missing";
          }
        })
      );
      if (!cancelled) setPathStatus(results);
    }
    if (recentItems.length > 0) checkAll();
    return () => { cancelled = true; };
  }, [recentItems]);

  const isMac = navigator.platform.toUpperCase().includes("MAC");
  const mod = isMac ? "⌘" : "Ctrl";

  const handleRecentClick = (item: RecentItem) => {
    const status = pathStatus[item.path];
    if (status === "missing") return;
    if (item.type === "folder") {
      setRoot(item.path);
      addRecentItem(item.path, "folder");
    } else {
      openFile(item.path);
      addRecentItem(item.path, "file");
    }
  };

  function getFileName(path: string): string {
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1] || path;
  }

  function getParentPath(path: string): string {
    const parts = path.split(/[/\\]/);
    parts.pop();
    return parts.join(path.includes("/") ? "/" : "\\");
  }

  return (
    <div className="welcome-view">
      <div className="welcome-content">
        <div className="welcome-logo">📂</div>
        <h1 className="welcome-title">mdownreview</h1>

        <div className="welcome-actions">
          <button className="welcome-action" onClick={onOpenFile}>
            <span className="welcome-action-icon">📄</span>
            <span className="welcome-action-label">Open File</span>
            <kbd className="welcome-kbd">{mod}+O</kbd>
          </button>
          <button className="welcome-action" onClick={onOpenFolder}>
            <span className="welcome-action-icon">📁</span>
            <span className="welcome-action-label">Open Folder</span>
            <kbd className="welcome-kbd">{mod}+Shift+O</kbd>
          </button>
        </div>

        {recentItems.length > 0 && (
          <div className="welcome-recent">
            <h2 className="welcome-recent-title">Recent</h2>
            <ul className="welcome-recent-list">
              {recentItems.map((item) => {
                const isMissing = pathStatus[item.path] === "missing";
                return (
                  <li key={item.path}>
                    <button
                      className={`welcome-recent-item${isMissing ? " welcome-recent-item--missing" : ""}`}
                      onClick={() => handleRecentClick(item)}
                      disabled={isMissing}
                      title={item.path}
                    >
                      <span className="welcome-recent-icon">
                        {item.type === "folder" ? "📁" : "📄"}
                      </span>
                      <span className="welcome-recent-path">
                        <strong>{getFileName(item.path)}</strong>
                        <span className="welcome-recent-parent">{getParentPath(item.path)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create welcome-view.css**

Create `src/styles/welcome-view.css`:

```css
.welcome-view {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 40px;
}

.welcome-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 400px;
  width: 100%;
}

.welcome-logo {
  font-size: 48px;
  margin-bottom: 8px;
}

.welcome-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 32px;
}

.welcome-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  margin-bottom: 32px;
}

.welcome-action {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
  transition: background 0.15s, border-color 0.15s;
  text-align: left;
  width: 100%;
}

.welcome-action:hover {
  background: var(--color-tab-hover);
  border-color: var(--color-accent);
}

.welcome-action-icon {
  font-size: 18px;
  flex-shrink: 0;
}

.welcome-action-label {
  flex: 1;
  font-weight: 500;
}

.welcome-kbd {
  font-family: "SF Mono", "Consolas", "Monaco", monospace;
  font-size: 11px;
  padding: 2px 6px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-bg);
  color: var(--color-muted);
  flex-shrink: 0;
}

.welcome-recent {
  width: 100%;
}

.welcome-recent-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--color-border);
}

.welcome-recent-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.welcome-recent-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  width: 100%;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  text-align: left;
  transition: background 0.1s;
}

.welcome-recent-item:hover:not(:disabled) {
  background: var(--color-tab-hover);
}

.welcome-recent-item--missing {
  opacity: 0.5;
  text-decoration: line-through;
  cursor: default;
}

.welcome-recent-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.welcome-recent-path {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.welcome-recent-path strong {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.welcome-recent-parent {
  font-size: 11px;
  color: var(--color-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 5: Run component tests**

Run: `npx vitest run src/__tests__/components/WelcomeView.test.tsx`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/WelcomeView.tsx src/styles/welcome-view.css src/__tests__/components/WelcomeView.test.tsx
git commit -m "feat: add WelcomeView with actions and recent items

- Centered welcome with Open File/Folder actions and kbd shortcuts
- Recent items section (up to 5, from Zustand persisted state)
- Existence check via check_path_exists Tauri command
- Missing items shown dimmed with strikethrough"
```

---

### Task 7: Wire `addRecentItem` into `openFilesFromArgs`

**Files:**
- Modify: `src/store/index.ts` (update `openFilesFromArgs`)
- Modify: `src/__tests__/store/openFilesFromArgs.test.ts`

- [ ] **Step 1: Write failing test**

Add to `src/__tests__/store/openFilesFromArgs.test.ts`:

```typescript
describe("openFilesFromArgs – recent items tracking", () => {
  it("adds opened files to recentItems", () => {
    callOpenFilesFromArgs(["/docs/readme.md"], []);
    const items = useStore.getState().recentItems;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ path: "/docs/readme.md", type: "file" });
  });

  it("adds opened folder to recentItems", () => {
    callOpenFilesFromArgs([], ["/workspace/project"]);
    const items = useStore.getState().recentItems;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ path: "/workspace/project", type: "folder" });
  });

  it("adds both files and folders to recentItems", () => {
    callOpenFilesFromArgs(["/workspace/notes.md"], ["/workspace"]);
    const items = useStore.getState().recentItems;
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.path)).toContain("/workspace");
    expect(items.map((i) => i.path)).toContain("/workspace/notes.md");
  });

  it("uses last folder when multiple folders are supplied", () => {
    callOpenFilesFromArgs([], ["/first", "/second"]);
    expect(useStore.getState().root).toBe("/second");
    const items = useStore.getState().recentItems;
    expect(items[0]).toMatchObject({ path: "/second", type: "folder" });
  });
});
```

Also update the existing `openFilesFromArgs – folders` test in the same file:
- Change `"uses only the first folder when multiple are supplied"` to expect `/second`:
```typescript
it("uses the last folder when multiple are supplied", () => {
  callOpenFilesFromArgs([], ["/first", "/second"]);
  expect(useStore.getState().root).toBe("/second");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/store/openFilesFromArgs.test.ts`
Expected: FAIL — recentItems not populated

- [ ] **Step 3: Update `openFilesFromArgs`**

Edit `src/store/index.ts`, update the `openFilesFromArgs` function:

```typescript
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
  const unique = [...new Set(files)];
  for (const file of unique) {
    if (!alreadyOpen.has(file)) {
      store.openFile(file);
      alreadyOpen.add(file);
    }
    store.addRecentItem(file, "file");
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/store/openFilesFromArgs.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/index.ts src/__tests__/store/openFilesFromArgs.test.ts
git commit -m "feat: track recent items from CLI args in openFilesFromArgs"
```

---

### Task 8: CSS — Folder pane slide transition

**Files:**
- Modify: `src/styles/folder-tree.css`
- Modify: `src/App.tsx` (add transition wrapper)

- [ ] **Step 1: Add CSS transition to folder-tree**

Add to `src/styles/folder-tree.css`:

```css
/* Slide transition for folder pane */
.folder-pane-wrapper {
  display: flex;
  overflow: hidden;
  transition: max-width 0.2s ease-out, opacity 0.2s ease-out;
  max-width: var(--folder-pane-width, 240px);
  opacity: 1;
}

.folder-pane-wrapper.folder-pane-hidden {
  max-width: 0;
  opacity: 0;
}
```

- [ ] **Step 8: Update App.tsx to use transition wrapper**

Instead of conditionally rendering with `{root !== null && (...)}`, always render a wrapper div with a CSS class that animates. This is already done in Task 4 step 6 — verify the wrapper approach is consistent:

```tsx
<div
  className={`folder-pane-wrapper${root === null ? " folder-pane-hidden" : ""}`}
  style={{ "--folder-pane-width": `${folderPaneWidth}px` } as React.CSSProperties}
>
  {root !== null && (
    <>
      <ErrorBoundary>
        <FolderTree onFileOpen={openFile} onCloseFolder={closeFolder} />
      </ErrorBoundary>
      <div className="drag-handle" onMouseDown={onDragStart} />
    </>
  )}
</div>
```

This is already in place from Task 4. This task only adds the CSS. The content disappears instantly on close while the wrapper animates its width — this is an acceptable UX tradeoff for simplicity. The folder tree header has a close button, so the user has clear intent to close; a brief max-width collapse of the empty wrapper provides visual feedback.

- [ ] **Step 3: Build frontend**

Run: `npm run build`
Expected: BUILD SUCCESS

- [ ] **Step 4: Commit**

```bash
git add src/styles/folder-tree.css src/App.tsx
git commit -m "feat: add slide transition for folder pane open/close"
```

---

### Task 9: Update E2E tests

**Files:**
- Modify: `e2e/panels.spec.ts`
- Modify: `e2e/folder-navigation.spec.ts`
- Modify: `e2e/cli-open.spec.ts`

- [ ] **Step 1: Update panels.spec.ts**

The folder pane toggle tests (24.1 and 24.3) are no longer valid. Remove or replace them:

- **Remove** test `"24.1 - Ctrl+B toggles folder pane"` entirely.
- **Remove** test `"24.3 - Folders toolbar button toggles folder pane"` entirely.
- **Update** test `"24.5 - Open File and Open Folder buttons are visible in toolbar"` — keep as-is (still valid).
- **Update** test `"24.6 - toolbar separators visually group buttons"` — now there's only 1 button group (Open File + Open Folder), not 2. Update count:

```typescript
test("24.6 - toolbar separators visually group buttons", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".app-layout")).toBeVisible();

  const btnGroups = page.locator(".toolbar-btn-group");
  await expect(btnGroups).toHaveCount(1);
});
```

- [ ] **Step 2: Update folder-navigation.spec.ts**

Test 21.4 references Collapse All / Expand All buttons. Update:

```typescript
test("21.4 - folder tree shows close button and auto-reveal toggle", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".app-layout")).toBeVisible();
  // Folder tree not shown when no root is set
  await expect(page.locator(".folder-tree")).not.toBeVisible();
});
```

- [ ] **Step 3: Add E2E tests for welcome view and close folder**

Add tests in `e2e/panels.spec.ts`:

```typescript
test("24.7 - welcome view shows when no file is open", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".welcome-view")).toBeVisible();
  await expect(page.getByText("Open File")).toBeVisible();
  await expect(page.getByText("Open Folder")).toBeVisible();
});

test("24.8 - folder pane is hidden when no folder is open", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".folder-tree")).not.toBeVisible();
});
```

- [ ] **Step 4: Update cli-open.spec.ts mock**

Add `check_path_exists` to the mock handlers:

```typescript
if (cmd === "check_path_exists") return "file";
```

- [ ] **Step 5: Run E2E tests**

Run: `npm run test:e2e`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add e2e/panels.spec.ts e2e/folder-navigation.spec.ts e2e/cli-open.spec.ts
git commit -m "test: update E2E tests for new folder/file opening UX

- Remove folder pane toggle tests (24.1, 24.3)
- Update toolbar group count assertion
- Update folder tree test for new header
- Add welcome view visibility test
- Add check_path_exists mock"
```

---

### Task 10: Full integration verification

**Files:** None (verification only)

- [ ] **Step 1: Run Vitest unit tests**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 2: Run Rust tests**

Run: `cd src-tauri && cargo test`
Expected: ALL PASS

- [ ] **Step 3: Run frontend build**

Run: `npm run build`
Expected: BUILD SUCCESS

- [ ] **Step 4: Run E2E tests**

Run: `npm run test:e2e`
Expected: ALL PASS

- [ ] **Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: integration fixes from full test run"
```
