## Context

Markdown Review is a greenfield desktop application for reviewing AI-generated text artifacts. The primary users are developers and reviewers who receive batches of files from AI agents and need to read, navigate, and annotate them without a full editing environment.

The reference project (Ferrite) uses Rust + egui, which requires GPU rendering and is not suitable for all deployment contexts. This application uses Tauri v2 as the shell for native OS integration with a web-based UI layer (React + TypeScript) that renders without a GPU dependency.

The app has two distinct runtime layers that need logging: (1) the Rust backend handling file I/O and comment persistence, and (2) the React frontend handling rendering and user interaction. Tauri v2's `tauri-plugin-log` bridges both layers to a single log file.

**Constraints:**
- Must run on Windows 10+ and macOS 12+ without GPU requirement
- Comments must survive application restarts and be portable alongside the reviewed files
- No cloud/network requirement — fully local operation
- All tests must be runnable headlessly in CI
- File associations registered per-user (no UAC elevation required)

## Goals / Non-Goals

**Goals:**
- Fast read-only viewing of markdown and source files with GitHub-quality rendering
- Low-friction comment workflow: click-to-annotate any line or section
- File tree navigation within a selected root directory
- Multi-tab document switching with persistent tab state within a session
- Offline-only, local-first operation
- CLI argument support: open files/folders passed on the command line
- OS file-type associations for `.md`/`.mdx` on Windows and macOS
- Single-instance: forward args to existing window rather than opening a second
- Structured logging to rotating file from both Rust and JS layers
- Automatic capture of all unhandled exceptions in both layers
- Unit tests for store logic; component tests in jsdom; E2E tests via Playwright
- Tests fail on any unexpected `console.error` or unhandled JS exception

**Non-Goals:**
- Editing file content (viewer/reviewer, not editor)
- Git integration, diff views, or version history
- Cloud sync or real-time collaboration
- Plugin/extension system
- 100% line coverage — focus on high-value scenarios
- Remote log shipping / telemetry
- Log viewer UI inside the app
- Linux `.desktop` file association
- Registering file types other than `.md`/`.mdx`
- Visual regression / snapshot tests

## Decisions

### 1. Tauri v2 over Electron
Use Tauri v2 (Rust + WebView). Uses the system WebView (WebView2 on Windows, WKWebView on macOS), resulting in ~5–20 MB installer vs. Electron's 100+ MB. No GPU requirement unlike egui.

*Alternative considered:* Electron — rejected due to bundle size and memory overhead unnecessary for a read-only viewer.

### 2. React + TypeScript for UI
React 18 + TypeScript for all UI components. Rich ecosystem for text rendering, syntax highlighting, and comment UIs. Component model maps cleanly to tabs, panes, and overlays.

*Alternative considered:* Svelte — smaller bundle, but smaller ecosystem for the specialized components needed.

### 3. react-markdown + remark-gfm + @shikijs/rehype + rehype-slug
`react-markdown` with `remark-gfm` (GFM extensions), `@shikijs/rehype` for syntax-highlighted code blocks (same Shiki engine used by `SourceViewer` — unified theme, 100+ languages, gracefully ignores unknown language tags), and `rehype-slug` (stable heading anchor IDs for TOC navigation).

*Alternative considered:* `rehype-highlight` — uses highlight.js which differs from Shiki used in `SourceViewer`. Two highlighters with different themes would produce visually inconsistent code blocks depending on whether the code is in a markdown fence or a standalone source file. Unified on Shiki to eliminate this inconsistency.

### 4. Shiki for source file syntax highlighting
`SourceViewer` uses Shiki for non-markdown files. TextMate grammars (same as VS Code), 100+ languages, VS Code-compatible themes.

*Alternative considered:* highlight.js — simpler API but lower accuracy for complex languages.

### 5. Module-level MD_COMPONENTS constant (no render-time recreation)
`MarkdownViewer` defines `MD_COMPONENTS` at module scope (never recreated). Per-block IDs use `node.position.start.line` from react-markdown's `node` prop as a stable block index. This avoids React error #185 (hook count mismatch) in React 18 concurrent mode.

*Problem solved:* A mutable shared counter during render is not safe in concurrent mode where render functions may be called multiple times before commit.

### 6. Comments stored as sidecar JSON files
Review comments stored in `<filename>.review.json` in the same directory. Portable, human-readable, no database dependency.

*Alternative considered:* SQLite database — better for querying across files but creates a hidden file that is hard to share.

### 7. Custom Tauri commands bypass plugin-fs scope restrictions (with size/binary guards)
`read_text_file` and `read_dir` implemented as custom Rust commands using `std::fs` directly, bypassing the `tauri-plugin-fs` scope allowlist. To compensate for the missing scope enforcement, `read_text_file` SHALL: (1) reject files larger than 10 MB to prevent OOM on accidental binary reads, (2) detect binary content by scanning the first 512 bytes for null bytes and return an `Err` that the frontend handles as a `BinaryPlaceholder`. `read_dir` returns only entries within the caller-supplied path (no path traversal via `..`).

*Problem solved:* `tauri-plugin-fs` fails with "forbidden path" for paths like `Q:/` that aren't in the configured scope allowlist.

*Security note:* The bypass is intentional for this local-only viewer. The size and binary guards prevent the most common accidental misuses.

### 8. Zustand for frontend state
Three slices: `workspaceSlice` (root folder, tree state), `tabsSlice` (open tabs, active tab, scroll positions), `commentsSlice` (comments by file path). `persist` middleware serializes only UI state (not comments — those live in sidecar files).

*Alternative considered:* Redux Toolkit — excessive ceremony for this app's state complexity.

### 9. Three-pane layout
Fixed three-pane layout: collapsible folder tree (left) | document viewer with tab bar (center) | review comments panel (right, toggleable).

### 10. CLI args: store in Rust state, expose via `get_launch_args` command
Parse `std::env::args()` inside the Tauri `setup` closure. Classify each arg as file or folder. Store the result in an `Arc<Mutex<Option<LaunchArgs>>>` in app state. Expose a `get_launch_args` Tauri command that returns and clears the stored args. The React frontend calls this command in a `useEffect([], ...)` on mount — by then React has committed and can safely process the args.

For second-instance forwarding (via `tauri-plugin-single-instance`), the plugin callback DOES emit an `args-received` event to the main window, because there the window is already fully running and the listener is guaranteed to be registered.

*Problem with event-push for first launch:* The Tauri `setup` hook fires synchronously on startup; the `args-received` event can be emitted before React's first `useEffect` runs, causing the event to be missed. Storing args in state and polling with a command eliminates this race entirely.

### 11. Single-instance via `tauri-plugin-single-instance`
The plugin intercepts second-launch attempts and forwards args to the first instance via the same `args-received` event.

*Alternative considered:* Custom named-pipe IPC — unnecessary given the official plugin exists.

### 12. Windows file associations via `tauri.conf.json` `fileAssociations`
`bundle.windows.nsis.fileAssociations` and `bundle.windows.wix.fileAssociations` entries for `.md`/`.mdx` write `HKCU\Software\Classes` registry keys — no UAC elevation needed.

*Alternative considered:* Manual WiX fragment — redundant since Tauri's bundler generates it.

### 13. macOS file associations via `CFBundleDocumentTypes` in `Info.plist`
`bundle.macOS.infoPlist.CFBundleDocumentTypes` declares `.md`/`.mdx` with `CFBundleTypeRole = "Viewer"`. A `setup` hook handler receives Apple Event `openFile` events and emits `args-received`.

### 14. `tauri-plugin-log` as the unified logging bridge
`tauri-plugin-log` routes `console.log/warn/error` from the WebView to Rust's `tracing` macros automatically. One plugin, one log file covering both layers.

*Alternative considered:* Custom IPC log channel — more work, no benefit over the official plugin.

### 15. Log target: rotating file + stdout (dev only)
Release: file only at `{appDataDir}/logs/markdown-review.log`, rotated at 5 MB, max 3 files. Debug: file + stdout.

### 16. Rust panic hook
Register a custom `std::panic::set_hook` in `lib.rs` `setup`. Logs `tracing::error!("[rust] PANIC …")` before calling the default hook. This ensures panics are in the log file before the process terminates.

### 17. JS global error capture at module level in main.tsx
`window.onerror` and `window.onunhandledrejection` installed at the top of `main.tsx`, before `ReactDOM.createRoot()` is called. This ensures errors thrown during React initialization, module loading, or the first render are captured. Both handlers call `logger.error(message + stack)`. `ErrorBoundary.componentDidCatch` also calls `logger.error` with the component stack.

*Problem with useEffect approach:* Installing handlers inside `App.tsx useEffect([], ...)` means the handlers are not active until after React's first commit. Any uncaught error during the first render (before commit) would not be logged. Module-level installation in `main.tsx` closes this gap.

### 18. `logger.ts` thin wrapper
All app code imports from `src/logger.ts` (re-exports from `@tauri-apps/plugin-log` with `[web]` prefix). A Vitest manual mock at `src/__mocks__/logger.ts` provides `vi.fn()` stubs so component tests don't invoke the real Tauri plugin.

### 19. Vitest for unit and component tests (not Jest)
Vitest shares the Vite config, understands the `@/` path alias, and runs ESM natively — no extra transform config needed for react-markdown, shiki, or other ESM-only packages.

*Alternative considered:* Jest with ts-jest — requires `moduleNameMapper` for every ESM package.

### 20. Mock `invoke` at module boundary, not per-test
A single `src/__mocks__/@tauri-apps/api/core.ts` with a configurable `vi.fn()` mock. Tests call `mockInvoke.mockResolvedValueOnce(...)`.

### 21. `console.error` spy fails tests (Vitest)
`src/test-setup.ts` installs a `vi.spyOn(console, "error")` in `beforeEach`; `afterEach` asserts it was not called unexpectedly. Tests that intentionally trigger errors suppress the spy with `mockImplementation(() => {})`.

*Alternative considered:* Replacing `console.error` with `vi.fn()` entirely — suppresses output, making debugging harder.

### 22. Playwright error-tracking fixture
A shared `e2e/fixtures/error-tracking.ts` fixture attaches `page.on("pageerror")` and `page.on("console")` listeners before each test and fails the test if any errors were collected. All E2E specs import `{ test, expect }` from the fixture instead of from `@playwright/test`.

*Alternative considered:* Global `page.addInitScript` — doesn't give per-test isolation.

### 23. Playwright E2E against the Vite dev server
Playwright targets `npm run dev` (Vite at localhost) with the Tauri backend mocked via a `__TAURI_TEST__` global. Avoids the multi-minute Tauri build cycle in CI. A separate `test:e2e:native` target runs against the real binary for release validation.

## Risks / Trade-offs

- **WebView rendering differences** → Use CSS resets and avoid browser-specific APIs.
- **Large file performance** → Files >1MB markdown may render slowly. Warn at >500 KB; virtualized rendering deferred.
- **Sidecar file conflicts** → `.review.json` files appear as untracked in git. Document `*.review.json` in `.gitignore` guidance.
- **shiki async highlighter in SourceViewer** → Component tests need `act()` + `waitFor()`. Mitigation: mock shiki in component tests.
- **Tauri invoke mock drift** → If Rust command signatures change, mocks silently diverge. Mitigation: type mock return values against the same TypeScript types used in hooks.
- **Playwright on Windows CI** → Needs `npx playwright install --with-deps chromium` in CI setup.
- **E2E dev-server mock fidelity** → Dev-server E2E tests bypass real filesystem; path encoding bugs only surface against native binary. Native E2E is a manual pre-release gate.
- **Windows UAC / file association scope** → Default per-user (`HKCU`); system-wide requires `/AllUsers` flag.
- **Tauri WiX file-association support** → Less battle-tested than NSIS. Test both; fall back to NSIS-only if WiX has issues.
- **macOS Gatekeeper / notarization** → File association requires code signing. Known limitation until macOS distribution is formalized.
- **`tauri-plugin-single-instance` mutex on crash** → Named mutex may persist until reboot after abnormal exit. Acceptable edge case.
- **`console.error` spy and React internal warnings** → React calls `console.error` for prop-type and `act()` warnings. Allowlist known React patterns in the spy check.
- **Log file on user machine** → Contains file paths the user opened. Not a privacy concern for a local-only app.
- **Async errors in E2E** → Errors after test teardown may be missed by the Playwright listener. Accepted trade-off.

## Open Questions

- Should the comments panel support exporting a summary report (markdown/HTML)? Deferred to post-MVP.
- Should file watching (auto-reload on change) be included in v1? Stretch goal.
