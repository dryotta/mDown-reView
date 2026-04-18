## 1. Project Scaffolding

- [ ] 1.1 Initialize Tauri v2 project with `create-tauri-app` using React + TypeScript template
- [ ] 1.2 Add frontend dependencies: `react-markdown`, `remark-gfm`, `@shikijs/rehype`, `rehype-slug`, `shiki`, `zustand`, `@tauri-apps/api`, `@tauri-apps/plugin-clipboard-manager`
- [ ] 1.3 Configure TypeScript strict mode and ESLint + Prettier
- [ ] 1.4 Set up Vite config with path aliases (`@/` → `src/`)
- [ ] 1.5 Configure Tauri `tauri.conf.json`: app name, window size (1200×800 default), minimum size (800×600)
- [ ] 1.6 Add Tauri capabilities for filesystem read access, dialog plugin, and clipboard plugin

## 2. Logging Infrastructure

- [ ] 2.1 Add `tauri-plugin-log`, `tracing`, and `tracing-subscriber` to `src-tauri/Cargo.toml`
- [ ] 2.2 Register `tauri_plugin_log::Builder` in `lib.rs`: file target at `{appDataDir}/logs/markdown-review.log`, rotation 5 MB / max 3 files; `LevelFilter::Debug` in debug builds, `LevelFilter::Info` in release; configure WebView log targets to route only `Warn` and `Error` in release builds
- [ ] 2.3 Install `@tauri-apps/plugin-log` npm package and initialize it in `main.tsx` before `ReactDOM.createRoot()`
- [ ] 2.4 Create `src/logger.ts` re-exporting `{ error, warn, info, debug, trace }` from `@tauri-apps/plugin-log` with `[web]` prefix on every message
- [ ] 2.5 Create `src/__mocks__/logger.ts` with `vi.fn()` stubs for all five log levels
- [ ] 2.6 Register a custom panic hook in `lib.rs` `setup` using `std::panic::set_hook`: log `tracing::error!("[rust] PANIC …")` then call the previous hook
- [ ] 2.7 Update all Tauri commands in `commands.rs` to call `tracing::error!("[rust] command error: {}", e)` before returning `Err(e)`
- [ ] 2.8 Install `window.onerror` and `window.onunhandledrejection` handlers at the top of `main.tsx`, before `ReactDOM.createRoot()`, so errors during initial render are captured; both handlers call `logger.error` with message + stack
- [ ] 2.9 Add Tauri command `get_log_path() -> Result<String, String>` in `commands.rs`; register in `lib.rs`

## 3. Test Infrastructure Setup

- [ ] 3.1 Install Vitest, `@vitest/coverage-v8`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom` as dev dependencies
- [ ] 3.2 Install `@playwright/test` as a dev dependency; run `npx playwright install --with-deps chromium` (note: `--with-deps` is required in CI Linux environments)
- [ ] 3.3 Create `vitest.config.ts` with jsdom environment, `@/` path alias, setup file reference; set `onUnhandledError: "fail"` to fail tests on unhandled rejections
- [ ] 3.4 Create `src/test-setup.ts`: import `@testing-library/jest-dom`; in `beforeEach`, spy on `console.error` and `console.warn`; in `afterEach`, assert neither was called unexpectedly, then call `vi.restoreAllMocks()`
- [ ] 3.5 Create `src/__mocks__/@tauri-apps/api/core.ts` with a configurable `vi.fn()` mock for `invoke` typed against the interfaces from `src/lib/tauri-commands.ts` so mock return values are validated at compile time
- [ ] 3.6 Create `playwright.config.ts` targeting localhost Vite dev server with Chromium, timeout 30 s, retries 1 in CI, HTML reporter
- [ ] 3.7 Create `e2e/fixtures/error-tracking.ts`: extended `test` fixture that attaches `page.on("pageerror")` and `page.on("console")` collectors before each test and fails the test if any uncaught errors are collected; supports `consoleErrorAllowlist: string[]` option
- [ ] 3.8 Create `e2e/fixtures/index.ts` re-exporting the extended `test` and `expect`
- [ ] 3.9 Add `"test"`, `"test:coverage"`, `"test:e2e"`, and `"test:e2e:native"` scripts to `package.json`

## 4. Application Shell and Layout

- [ ] 4.1 Create root `App` component with three-pane layout: folder tree (left) | document viewer with tab bar (center) | comments panel (right)
- [ ] 4.2 Implement CSS custom properties (`--color-bg`, `--color-text`, `--color-surface`, etc.) for light and dark themes; apply theme class to `<html>` based on OS preference (`prefers-color-scheme`) and user override
- [ ] 4.3 Add theme toggle button in the toolbar (cycles: System → Light → Dark); persist selection to `localStorage`
- [ ] 4.4 Implement CSS layout with resizable panes using CSS grid with a drag handle
- [ ] 4.5 Add drag handle between folder pane and viewer; enforce min width 160px and max 50% of window
- [ ] 4.6 Implement Zustand store with slices: `workspaceSlice` (root folder, tree state), `tabsSlice` (open tabs, active tab, scroll positions), `commentsSlice` (comments by file path)
- [ ] 4.7 Add global keyboard shortcut handler for `Ctrl/Cmd+B` (toggle folder pane) and `Ctrl/Cmd+Shift+C` (toggle comments panel)
- [ ] 4.8 Persist UI state (folder pane width, pane visibility, last workspace root, theme preference) to `localStorage`
- [ ] 4.9 Update `ErrorBoundary.tsx` `componentDidCatch` to call `logger.error` with error message and component stack

## 5. Folder Navigation

- [ ] 5.1 Implement Tauri command `read_dir(path: String) -> Result<Vec<DirEntry>, String>`; reject path traversal via `..`; register in `lib.rs`
- [ ] 5.2 Build `FolderTree` React component: renders files and folders as a tree with expand/collapse nodes; supports keyboard navigation (Arrow Up/Down traverse visible entries; Arrow Right expands folder or moves to first child; Arrow Left collapses folder or moves to parent; Enter opens file)
- [ ] 5.3 Implement expand/collapse per node with state persisted in Zustand workspace slice
- [ ] 5.4 Add "Open Folder…" button that invokes Tauri dialog `open({ directory: true })` and sets workspace root
- [ ] 5.5 Restore last opened folder on app launch; handle missing folder with empty-state UI
- [ ] 5.6 Highlight the active file's tree entry when the active tab changes
- [ ] 5.7 Add file name filter input above the tree; case-insensitive substring filtering that keeps parent folders of matching files visible
- [ ] 5.8 Add "Collapse All" and "Expand All" toolbar buttons; "Expand All" expands at most 3 levels deep to avoid unbounded filesystem calls
- [ ] 5.9 Add toggle button to collapse/hide the folder pane entirely

## 6. Folder Navigation Tests

- [ ] 6.1 Create `src/components/FolderTree/__tests__/FolderTree.test.tsx` — renders file and folder entries from mocked `read_dir` response; folders shown as nodes, files as leaves
- [ ] 6.2 In `FolderTree.test.tsx` — clicking a collapsed folder expands it and calls `read_dir`; clicking an expanded folder collapses it
- [ ] 6.3 In `FolderTree.test.tsx` — active file entry has highlight class; switching active tab updates highlighted entry
- [ ] 6.4 In `FolderTree.test.tsx` — typing in filter hides non-matching files; parent folders of matches remain visible; clearing filter restores full tree
- [ ] 6.5 In `FolderTree.test.tsx` — "Collapse All" collapses all nodes; "Expand All" expands up to depth 3 and leaves deeper folders collapsed
- [ ] 6.6 In `FolderTree.test.tsx` — Arrow Down moves focus to next visible entry; Arrow Right expands collapsed folder; Arrow Left collapses expanded folder; Enter on file calls `openFile`
- [ ] 6.7 In `FolderTree.test.tsx` — pane-toggle button calls hide-pane action; clicking a file calls `openFile` with the path

## 7. Document Viewer (Tab System)

- [ ] 7.1 Build `TabBar` component: renders tabs with file name labels, close buttons, active-tab styling, full path tooltip on hover
- [ ] 7.2 Implement open-file logic: if file already in tabs, activate it; otherwise add new tab and load content
- [ ] 7.3 Implement close-tab logic: remove tab, activate adjacent if needed, show empty state when last tab is closed
- [ ] 7.4 Implement Tauri command `read_text_file(path: String) -> Result<String, String>`: reject files >10 MB with `Err("file_too_large")`; scan first 512 bytes for null bytes and return `Err("binary_file")` if found; register in `lib.rs`
- [ ] 7.5 Implement `useFileContent` hook using `tauri-commands.ts#readTextFile`; return `{ status: "loading" | "ready" | "binary" | "error", content?, error? }`
- [ ] 7.6 Implement file type router: `.md`/`.mdx` → `MarkdownViewer`, recognized code extensions → `SourceViewer`, binary/error → `BinaryPlaceholder`; show `SkeletonLoader` while status is `loading`
- [ ] 7.7 Build `SkeletonLoader` component: animated grey bars in varying widths mimicking text content
- [ ] 7.8 Persist and restore per-tab scroll position when switching tabs
- [ ] 7.9 Implement `Ctrl+Tab` / `Ctrl+Shift+Tab` (`Cmd+}` / `Cmd+{` on macOS) shortcuts to cycle tabs
- [ ] 7.10 Show comment count badge on tabs that have unresolved comments (from comments slice)

## 8. Document Viewer Tests

- [ ] 8.1 Create `src/components/TabBar/__tests__/TabBar.test.tsx` — tabs show file base name; active tab has distinct CSS class; `title` attribute contains full path
- [ ] 8.2 In `TabBar.test.tsx` — clicking inactive tab calls `setActiveTab`; clicking close (×) calls `closeTab`; tab with unresolved comments shows numeric badge; badge absent when zero unresolved
- [ ] 8.3 Create `src/components/viewers/__tests__/ViewerRouter.test.tsx` — `.md` routes to `MarkdownViewer`; `.ts` routes to `SourceViewer`; binary routes to `BinaryPlaceholder`; loading status shows `SkeletonLoader`
- [ ] 8.4 Create `src/__tests__/store/tabs.test.ts` — `openFile` (new tab and dedup), `closeTab` (removes and activates adjacent), `setScrollTop`

## 9. Markdown Viewer

- [ ] 9.1 Build `MarkdownViewer` using `react-markdown` + `remark-gfm` + `@shikijs/rehype` + `rehype-slug`; unknown language tags render as plain monospace without errors
- [ ] 9.2 Define `MD_COMPONENTS` at module scope (never recreated); use `node.position.start.line` as stable block index to prevent React error #185 in concurrent mode
- [ ] 9.3 Configure custom `img` renderer: resolve relative paths via `convertFileSrc`; remote URLs pass through
- [ ] 9.4 Configure custom `a` renderer: open links via Tauri shell `open()` so links launch the system browser
- [ ] 9.5 Detect YAML frontmatter; strip from body; render `FrontmatterBlock` above document
- [ ] 9.6 Build `FrontmatterBlock`: expanded by default (showing key-value pairs); collapses/re-expands on header click; uses `--color-surface` CSS variable for theming
- [ ] 9.7 Build `TableOfContents`: extract H1–H3; render hierarchical list only when 3+ headings exist; clicking entry scrolls to heading anchor via `rehype-slug` ID
- [ ] 9.8 Show warning banner when file exceeds 500 KB: "This file is large (N KB) — rendering may be slow"
- [ ] 9.9 Apply GitHub-style CSS using theme CSS variables for typography, tables, blockquotes, code blocks; code block theme must match the Shiki theme used in `SourceViewer`

## 10. Markdown Viewer Tests

- [ ] 10.1 Create `src/components/viewers/__tests__/MarkdownViewer.test.tsx` — headings get rehype-slug anchor IDs; fenced code block with known language gets highlighting output; unknown language tag (e.g., `mermaid`) renders as plain block without throwing or calling `console.error`
- [ ] 10.2 In `MarkdownViewer.test.tsx` — GFM table renders as `<table>`; task list items render as `<input type="checkbox" disabled>`; strikethrough renders as `<del>`
- [ ] 10.3 In `MarkdownViewer.test.tsx` — relative image src transformed via `convertFileSrc` (mock); remote http image passes through; hyperlink click calls `open()` (mock)
- [ ] 10.4 In `MarkdownViewer.test.tsx` — FrontmatterBlock expanded by default; clicking header collapses; TOC renders when doc has 3+ headings; TOC absent when < 3 headings
- [ ] 10.5 In `MarkdownViewer.test.tsx` — file >500 KB shows warning banner with correct size; file ≤500 KB shows no banner
- [ ] 10.6 Create `src/components/__tests__/FrontmatterBlock.test.tsx` — expanded by default; clicking collapses; clicking again expands; key-value pairs visible when expanded
- [ ] 10.7 Create `src/components/__tests__/TableOfContents.test.tsx` — each entry is `<a>` with href matching heading slug; H1/H2/H3 entries present; not rendered for < 3 headings; clicking triggers scroll to anchor

## 11. Source Code Viewer

- [ ] 11.1 Build `SourceViewer` component that displays file content with line numbers using Shiki
- [ ] 11.2 Apply GitHub Light theme for light mode, GitHub Dark for dark mode; detect from active app theme CSS class on `<html>`
- [ ] 11.3 Handle files >500 KB: show warning banner and offer to display as plain text without highlighting
- [ ] 11.4 Build `BinaryPlaceholder` component displaying "This file cannot be displayed" with the file name and size

## 12. Source Code Viewer Tests

- [ ] 12.1 Create `src/components/viewers/__tests__/SourceViewer.test.tsx` — renders content from mocked `readTextFile`; language class on code element matches file extension; files >500 KB show warning banner
- [ ] 12.2 Create `src/components/viewers/__tests__/BinaryPlaceholder.test.tsx` — renders "cannot be displayed" message with file name
- [ ] 12.3 Create `src/components/__tests__/ErrorBoundary.test.tsx` — child throwing during render shows fallback; `logger.error` called with message and component stack; `console.error` spy suppressed with `mockImplementation(() => {})`

## 13. Review Comments

- [ ] 13.1 Define comment data model: `{ id: string, blockHash: string, headingContext: string | null, fallbackLine: number, text: string, createdAt: string, resolved: boolean }`
- [ ] 13.2 Build comment affordance: `+` button in left margin for each block on hover; compute `blockHash` from block raw markdown text (8-char hex from FNV-1a hash of the normalized block text)
- [ ] 13.3 Implement `CommentInput` inline component: textarea focused on mount; Save (`Ctrl+Enter`) and Cancel (`Escape`)
- [ ] 13.4 Implement Zustand comments actions: `addComment(filePath, anchor, text)`, `editComment(id, text)`, `deleteComment(id)`, `resolveComment(id)`, `unresolveComment(id)`
- [ ] 13.5 Implement Tauri command `save_review_comments(file_path, comments)` writing `{ "version": 1, "comments": [...] }` sidecar; implement `load_review_comments(file_path)` reading the sidecar; handle legacy (version-less) format by treating as version 0 and migrating schema on next save
- [ ] 13.6 Load comments on file open; detect orphaned comments (blockHash not found in current document) and flag `isOrphaned: true` on them; skip if no sidecar
- [ ] 13.7 Render margin indicators at blocks with unresolved comments; resolved comments show muted indicator
- [ ] 13.8 Build `CommentThread`: comment text, timestamp, Edit/Delete/Resolve-Unresolve buttons; resolved comments render with strikethrough header and dimmed style
- [ ] 13.9 Build `CommentsPanel`: lists unresolved comments in block order with preview and timestamp; orphaned comments shown with warning icon; "Show resolved" toggle; "No comments yet" empty state
- [ ] 13.10 Wire panel click to scroll to block and expand inline thread
- [ ] 13.11 Add toggle button and `Ctrl+Shift+C` / `Cmd+Shift+C` shortcut for comments panel
- [ ] 13.12 Create `src/components/AboutDialog.tsx`: modal with app name, version, log path via `getLogPath()`, and "Copy path" button using `@tauri-apps/plugin-clipboard-manager` `writeText`
- [ ] 13.13 Add "About" menu item in `App.tsx` that opens `AboutDialog`

## 14. Review Comments Tests

- [ ] 14.1 Create `src/components/comments/__tests__/CommentInput.test.tsx` — focused on mount; Save calls `addComment` with correct blockAnchor; Escape calls `onClose` without saving
- [ ] 14.2 Create `src/components/comments/__tests__/CommentThread.test.tsx` — renders text/timestamp; Edit makes editable and calls `editComment`; Delete calls `deleteComment`; Resolve calls `resolveComment`; resolved comment shows strikethrough header and "Unresolve" button
- [ ] 14.3 Create `src/components/comments/__tests__/CommentsPanel.test.tsx` — lists unresolved in block order; orphaned comments show warning icon; "Show resolved" toggle reveals resolved; "No comments yet" when empty; click calls scroll handler
- [ ] 14.4 Create `src/components/__tests__/AboutDialog.test.tsx` — renders log path from mocked `getLogPath`; "Copy path" calls Tauri clipboard `writeText` mock, not `navigator.clipboard`

## 15. CLI Argument Handling & Single-Instance

- [ ] 15.1 Add `tauri-plugin-single-instance` to `src-tauri/Cargo.toml`
- [ ] 15.2 Register `tauri_plugin_single_instance` in `lib.rs`; in the callback, emit `args-received` event with new-instance args to the existing window (window is live, listener is registered)
- [ ] 15.3 In Tauri `setup`, parse `std::env::args()`, skip argv[0], classify each arg via `std::fs::metadata`; store result in `Arc<Mutex<Option<LaunchArgs>>>` in app state
- [ ] 15.4 Add Tauri command `get_launch_args() -> LaunchArgs` that reads and clears the stored args; register in `lib.rs`
- [ ] 15.5 On macOS, register an Apple Event `open_file` handler in `setup` that updates the stored launch args (or emits `args-received` if the window is already running)
- [ ] 15.6 Add `openFilesFromArgs(files: string[], folders: string[])` Zustand action: calls `openFile` for each file and `setRoot` for the first folder; deduplicates already-open files
- [ ] 15.7 In `App.tsx`, add `useEffect([], ...)` calling `invoke("get_launch_args")` on mount and passing result to `openFilesFromArgs`; also subscribe to `args-received` event for second-instance forwarding

## 16. Typed Tauri Command Layer

- [ ] 16.1 Create `src/lib/tauri-commands.ts` with typed wrapper functions for all Tauri `invoke` calls: `readTextFile(path: string): Promise<string>`, `readDir(path: string): Promise<DirEntry[]>`, `getLaunchArgs(): Promise<LaunchArgs>`, `getLogPath(): Promise<string>`, `saveReviewComments(path: string, payload: ReviewComments): Promise<void>`, `loadReviewComments(path: string): Promise<ReviewComments | null>` — all typed against shared interface types exported from this module
- [ ] 16.2 Update all call sites in hooks and components to import from `tauri-commands.ts` instead of calling `invoke` directly, so TypeScript validates mock return values at compile time
- [ ] 16.3 Update `src/__mocks__/@tauri-apps/api/core.ts` to import and validate mock return types against the same interfaces from `tauri-commands.ts`

## 17. Rust Command Integration Tests

- [ ] 17.1 Create `src-tauri/tests/commands_integration.rs`; add `#[test]` for `read_text_file`: returns content for valid UTF-8 file; returns `Err("binary_file")` when first 512 bytes contain null; returns `Err("file_too_large")` for a 10 MB+ file
- [ ] 17.2 In integration tests: test `save_review_comments` writes valid JSON matching `{ "version": 1, "comments": [...] }` to a temp file; test `load_review_comments` reads it back and returns matching structs
- [ ] 17.3 In integration tests: test legacy sidecar (no `version` field) is read without error; after a save, the output file contains `"version": 1`
- [ ] 17.4 In integration tests: test `get_launch_args` returns stored args on first call and returns empty args on second call (args are consumed/cleared)

## 18. Store Unit Tests

- [ ] 18.1 Create `src/__tests__/store/workspace.test.ts` — `setRoot` updates root and clears folder tree
- [ ] 18.2 Create `src/__tests__/store/comments.test.ts` — `addComment`, `editComment`, `deleteComment`, `resolveComment`, `unresolveComment`; resolved comment removed from unresolved count; orphaned flag preserved
- [ ] 18.3 Create `src/__tests__/store/persistence.test.ts` — serialized state excludes `commentsByFile`; theme preference is serialized
- [ ] 18.4 Create `src/__tests__/store/openFilesFromArgs.test.ts` — file paths open tabs; folder sets workspace root; already-open file deduplicates

## 19. Logger & Exception Handler Tests

- [ ] 19.1 Create `src/__tests__/logger.test.ts` — `logger.error` prepends `[web]` and delegates to plugin function; verify all five levels similarly
- [ ] 19.2 Create `src/__tests__/globalErrorHandlers.test.ts` — dispatch synthetic `ErrorEvent` on `window` and verify `logger.error` called with message and stack; dispatch `PromiseRejectionEvent` and verify `logger.error` called

## 20. End-to-End Test Fixtures

- [ ] 20.1 Create `e2e/helpers/mock-tauri.ts` — uses `@tauri-apps/api/mocks` (`mockIPC`, `mockWindows`) to intercept `invoke` calls without touching `window.__TAURI_INTERNALS__`; exports `setupTauriMocks()` / `teardownTauriMocks()` for `beforeEach`/`afterEach`; pre-configures `get_launch_args` to return `{ files: [], folders: [] }` by default; exports `configureMock(command, handler)` for per-test overrides
- [ ] 20.2 Create `e2e/fixtures/` with: `sample.md` (4 headings, table, code block, frontmatter, ~4 KB), `sample.ts` (TypeScript source), `sample.txt` (plain text), `notes.md` (for multi-tab tests), `large.md` (>500 KB generated content for large-file tests), `legacy.review.json` (comment sidecar without `version` field for migration tests)

## 21. End-to-End Tests — Folder Navigation

- [ ] 21.1 Create `e2e/folder-navigation.spec.ts` — open folder → tree populates; click `.md` file → tab opens, markdown renders; click `.ts` → source viewer renders
- [ ] 21.2 In `folder-navigation.spec.ts` — click folder to expand, children appear; click again to collapse; keyboard Arrow Down/Up moves focus; Enter opens file
- [ ] 21.3 In `folder-navigation.spec.ts` — type in filter, non-matching files hidden, parent folders of matches remain; clear filter restores full tree
- [ ] 21.4 In `folder-navigation.spec.ts` — "Collapse All" collapses all; "Expand All" expands only 3 levels deep, 4th-level folders remain collapsed

## 22. End-to-End Tests — Tab Management

- [ ] 22.1 Create `e2e/tab-management.spec.ts` — open three files → three tabs; skeleton shown while mocked read is delayed; click inactive tab → viewer switches; hover tab → full path tooltip visible
- [ ] 22.2 In `tab-management.spec.ts` — click same file in tree again → no duplicate tab, existing activates
- [ ] 22.3 In `tab-management.spec.ts` — close active tab with siblings → adjacent activates; close last tab → empty state
- [ ] 22.4 In `tab-management.spec.ts` — Ctrl+Tab → next tab activates, wraps; Ctrl+Shift+Tab → previous tab
- [ ] 22.5 In `tab-management.spec.ts` — open `large.md` (>500 KB) → warning banner visible above content

## 23. End-to-End Tests — Comments Lifecycle

- [ ] 23.1 Create `e2e/comments.spec.ts` — click `+` on paragraph block → CommentInput appears; type and save → CommentThread visible; badge appears on tab
- [ ] 23.2 In `comments.spec.ts` — click `+` then Escape → input closes, no comment created
- [ ] 23.3 In `comments.spec.ts` — Edit comment → editable; save edit → updated text shown
- [ ] 23.4 In `comments.spec.ts` — Resolve → comment removed from panel, badge decreases; "Show resolved" → resolved comment visible with strikethrough; Unresolve → returns to active
- [ ] 23.5 In `comments.spec.ts` — Delete last unresolved comment → badge removed from tab
- [ ] 23.6 In `comments.spec.ts` — persist and reload: save comment via mocked `save_review_comments`; reconfigure mock `load_review_comments` to return saved data; close and reopen file tab → comment visible
- [ ] 23.7 In `comments.spec.ts` — legacy sidecar: configure `load_review_comments` to return content of `legacy.review.json` (no `version` field); open file → comments load and display without error; save a comment → `save_review_comments` called with `version: 1` in payload
- [ ] 23.8 In `comments.spec.ts` — orphaned comment: configure `load_review_comments` to return comment whose `blockHash` does not match any block in `sample.md`; open file → comment shown in panel with orphaned warning indicator; no crash

## 24. End-to-End Tests — Panels, Keyboard Shortcuts & Scroll

- [ ] 24.1 Create `e2e/panels.spec.ts` — Ctrl+B → folder pane hides, viewer expands; Ctrl+B again → pane reappears
- [ ] 24.2 In `panels.spec.ts` — Ctrl+Shift+C → comments panel hides; again → reappears; panel lists unresolved comments
- [ ] 24.3 Create `e2e/scroll-restore.spec.ts` — scroll halfway down long markdown; switch tab; switch back → scroll restored
- [ ] 24.4 Create `e2e/theme.spec.ts` — theme toggle cycles System → Light → Dark; dark theme applies dark CSS variables on `<html>`; reload page (or re-mount) → previously set theme is restored from `localStorage`

## 25. End-to-End Tests — CLI Open

- [ ] 25.1 Create `e2e/cli-open.spec.ts` — configure `get_launch_args` mock to return a file path → on mount, tab opens for that file; configure to return a folder path → workspace root updates
- [ ] 25.2 In `cli-open.spec.ts` — simulate `args-received` event with a new file path (second-instance scenario) → new tab opens without page refresh or duplicate window

## 26. Native E2E Smoke Tests

- [ ] 26.1 Create `playwright.native.config.ts` targeting the Tauri binary (`npm run tauri build` output), not Vite dev server; set longer timeouts (60 s) for binary launch
- [ ] 26.2 Create `e2e/native/smoke.spec.ts` — launch the real binary; verify app window opens and the empty state is shown; no console errors on startup
- [ ] 26.3 In `smoke.spec.ts` — write a temp `.md` file to disk; invoke OS file-open via the Tauri test API or command-line arg simulation; verify the file opens in a tab with real content rendered
- [ ] 26.4 In `smoke.spec.ts` — add a comment via UI interaction; close and relaunch the app with the same file; verify the `.review.json` sidecar was written and the comment is visible after reload
- [ ] 26.5 In `smoke.spec.ts` — verify `{appDataDir}/logs/markdown-review.log` exists and contains a startup log entry after first launch

## 27. CI Workflow

- [ ] 27.1 Create `.github/workflows/ci.yml`: trigger on `push` and `pull_request` to `main`; use `ubuntu-latest` for Rust/unit/E2E jobs and `windows-latest` for installer smoke test job
- [ ] 27.2 In CI: set up Rust toolchain (stable), Node.js (LTS), restore cargo and npm caches
- [ ] 27.3 In CI: run `cargo test` in `src-tauri/` (includes Rust integration tests from section 17)
- [ ] 27.4 In CI: run `npm test` (Vitest unit + component tests)
- [ ] 27.5 In CI: run `npx playwright install --with-deps chromium` then `npm run test:e2e` (Playwright against Vite dev server)
- [ ] 27.6 In CI: upload Playwright HTML report and `test-results/` as workflow artifacts on failure

## 28. Installer File Associations

- [ ] 28.1 Configure Tauri `bundle` for Windows: NSIS installer, product name "Markdown Review", `com.markdownreview.desktop`; add `fileAssociations` for `.md`/`.mdx` under both `bundle.windows.nsis` and `bundle.windows.wix` (writes `HKCU\Software\Classes`, no UAC)
- [ ] 28.2 Configure Tauri `bundle` for macOS: DMG, universal binary (x64 + arm64); add `CFBundleDocumentTypes` for `.md`/`.mdx` with `CFBundleTypeRole = "Viewer"` and `UTImportedTypeDeclarations` in `bundle.macOS.infoPlist`
- [ ] 28.3 Test (Windows): after NSIS install, double-clicking `.md` in Explorer opens app with file in a tab; right-click → "Open With" shows "Markdown Review"
- [ ] 28.4 Test (macOS): right-click `.md` → "Open With" shows "Markdown Review"; double-click opens file in tab

## 29. Packaging and Distribution

- [ ] 29.1 Add application icon assets (512×512 PNG, ICO for Windows, ICNS for macOS)
- [ ] 29.2 Add `tauri build` script to `package.json`; verify build succeeds on Windows
- [ ] 29.3 Run native E2E smoke tests (section 26) against the release binary
- [ ] 29.4 Verify `{appDataDir}/logs/markdown-review.log` is created on first launch; verify log rotation after exceeding 5 MB
- [ ] 29.5 Test full workflow on Windows: launch → open folder → open markdown file → render → add comment → restart → comment persists
