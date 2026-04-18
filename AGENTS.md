# AGENTS.md — Markdown Review

Context for AI agents working on this codebase.

## What This Is

A native desktop application for reviewing AI-generated markdown artifacts. Users open folders of `.md`/`.mdx` files, read and navigate them, and attach inline review comments. The app is a **viewer/reviewer, not an editor**.

Primary users are developers who receive batches of files from AI tools and need to read, navigate, and annotate them without a full editing environment.

## Non-Goals

Do not implement these — they are explicitly out of scope:

- Editing file content
- Git integration, diff views, or version history
- Cloud sync or real-time collaboration
- Plugin/extension system
- Remote log shipping or telemetry
- Log viewer UI inside the app
- Linux `.desktop` file association
- File type associations other than `.md`/`.mdx`
- Visual regression/snapshot tests
- 100% line coverage (focus on high-value scenarios)

## Constraints

- Runs on Windows 10+ and macOS 12+ without a GPU requirement
- Fully offline — no network calls except system browser links
- Comments persist locally alongside reviewed files (no database)
- File associations registered per-user (no UAC elevation on Windows)
- All tests must run headlessly in CI

## Architecture

Two runtime layers bridged by Tauri v2:

**Rust layer** (`src-tauri/src/`)
- File I/O via custom commands — `read_text_file`, `read_dir` — that bypass `tauri-plugin-fs` scope restrictions (intentional for local-only viewer). Guarded by 10 MB size limit and null-byte binary detection.
- Comment persistence: `save_review_comments` / `load_review_comments` write versioned sidecar JSON files alongside each reviewed document.
- CLI arg handling: parsed in `setup` hook, stored in `Arc<Mutex<Option<LaunchArgs>>>`, consumed via `get_launch_args` command (poll on mount, not event push — eliminates the race where events fire before React's first `useEffect`).
- Logging: `tauri-plugin-log` routes both Rust `tracing` macros and WebView `console.*` calls to a single rotating log file.

**React/TypeScript layer** (`src/`)
- State: Zustand with three slices — `workspaceSlice` (root folder, tree state), `tabsSlice` (open tabs, scroll positions), `commentsSlice` (comments by file path).
- Viewers: `MarkdownViewer` (react-markdown + remark-gfm + @shikijs/rehype + rehype-slug), `SourceViewer` (Shiki direct API), `BinaryPlaceholder`.
- All Tauri calls go through `src/lib/tauri-commands.ts` typed wrappers — never call `invoke` directly in components or hooks.
- All logging goes through `src/logger.ts` — never import `@tauri-apps/plugin-log` directly.

## Key Design Decisions

1. **Custom Tauri commands bypass `tauri-plugin-fs` scope** (intentional — local viewer). `read_text_file` rejects files >10 MB and detects binary via first-512-byte null scan.
2. **`MD_COMPONENTS` defined at module scope** (never inside render). Per-block IDs use `node.position.start.line` from react-markdown's `node` prop. Prevents React error #185 in concurrent mode.
3. **Comments as sidecar JSON** — `<filename>.review.json` in the same directory. Portable alongside files; no database.
4. **Anchor by content hash** — `blockHash` is an 8-char FNV-1a hex of normalized block text. Comments re-attach after AI regeneration even when block position changes.
5. **Poll for first-instance CLI args** via `get_launch_args` command (not an event). Events can fire before React's first `useEffect`; the command is called on mount after React commits, eliminating the race. Second-instance args use `args-received` event (safe because the window is already running).
6. **Unified Shiki** for both `MarkdownViewer` fenced blocks and `SourceViewer`. Using two different highlighters would produce inconsistent code themes.
7. **Zustand persist middleware** serializes only UI state (tab scroll positions, workspace root, theme preference) — not comment content, which lives in sidecar files.
8. **`window.onerror` / `window.onunhandledrejection` installed at module level in `main.tsx`**, before `ReactDOM.createRoot()`, so errors during initial render and module loading are captured.
9. **Single `src/__mocks__/@tauri-apps/api/core.ts`** for `invoke`. Mock return values are typed against interfaces from `tauri-commands.ts` — TypeScript validates them at compile time.
10. **Vitest over Jest** — shares Vite config, handles ESM-only packages (react-markdown, shiki) without extra transform configuration.

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri v2 |
| Rust logging | `tauri-plugin-log`, `tracing`, `tracing-subscriber` |
| Single-instance | `tauri-plugin-single-instance` |
| Frontend | React 18, TypeScript |
| State | Zustand (`workspaceSlice`, `tabsSlice`, `commentsSlice`) |
| Markdown rendering | `react-markdown` + `remark-gfm` + `@shikijs/rehype` + `rehype-slug` |
| Syntax highlighting | Shiki (`@shikijs/rehype` in MarkdownViewer, direct API in SourceViewer) |
| Unit/component tests | Vitest + React Testing Library + jsdom |
| E2E tests | Playwright (Vite dev server + Tauri IPC mock) |

## Codebase Layout

```
src/
  lib/
    tauri-commands.ts       ← typed invoke wrappers; ALL Tauri calls go here
  logger.ts                 ← re-exports plugin-log; prefix [web] on all messages
  __mocks__/
    logger.ts               ← vi.fn() stubs for unit/component tests
    @tauri-apps/api/
      core.ts               ← configurable invoke mock, typed against tauri-commands.ts
  test-setup.ts             ← console.error spy + @testing-library/jest-dom
  components/
    FolderTree/
    TabBar/
    viewers/
      MarkdownViewer.tsx
      SourceViewer.tsx
      BinaryPlaceholder.tsx
    comments/
      CommentInput.tsx
      CommentThread.tsx
      CommentsPanel.tsx
    AboutDialog.tsx
    ErrorBoundary.tsx
  store/                    ← Zustand slices

src-tauri/src/
  commands.rs               ← all Tauri commands
  lib.rs                    ← plugin registration, setup hook, panic hook

e2e/
  fixtures/
    error-tracking.ts       ← extended test fixture with pageerror + console collectors
    index.ts                ← re-exports test/expect; always import from here, not @playwright/test
  helpers/
    mock-tauri.ts           ← setupTauriMocks() / teardownTauriMocks() using @tauri-apps/api/mocks
  fixtures/
    sample.md               ← 4 headings, table, code block, frontmatter (~4 KB)
    sample.ts               ← TypeScript source
    large.md                ← >500 KB for large-file tests
    legacy.review.json      ← comment sidecar without version field (migration tests)
```

## Testing Conventions

- **Vitest** for unit and component tests. `test-setup.ts` spies on `console.error` and `console.warn` in every test — unexpected calls fail the test. Tests that intentionally trigger errors must suppress the spy with `mockImplementation(() => {})`.
- **Playwright** E2E imports `{ test, expect }` from `e2e/fixtures/index.ts` — not from `@playwright/test` directly. The fixture attaches `pageerror` and `console` error collectors; any uncaught error fails the test.
- **Rust** integration tests in `src-tauri/tests/commands_integration.rs`.
- Dev-server E2E (`npm run test:e2e`) targets the Vite dev server with Tauri IPC mocked. Native binary tests (`npm run test:e2e:native`) are a pre-release manual gate.
- **A task is NOT complete until `cargo test`, `npm test`, and `npm run test:e2e` all pass.**

## Log File

Release builds write to `{appDataDir}/logs/markdown-review.log`. Rotation at 5 MB, max 3 files. Log level `info` in release, `debug` in debug builds. WebView `console.log/debug` suppressed in release (only `warn`/`error` forwarded). Path exposed in the About dialog with a "Copy path" button.

## Comment Data Model

```typescript
{
  id: string;           // UUID
  blockHash: string;    // 8-char FNV-1a hex of normalized block text
  headingContext: string | null; // slug of nearest preceding heading
  fallbackLine: number; // creation-time line number (display only)
  text: string;
  createdAt: string;    // ISO timestamp
  resolved: boolean;
}
```

Sidecar format: `{ "version": 1, "comments": [...] }`. Legacy (no `version` field) is migrated on next save.

## Behavioral Specs

Detailed requirements and acceptance scenarios for each feature:

- [App Logging](docs/specs/app-logging.md)
- [CLI File Open & File Associations](docs/specs/cli-file-open.md)
- [Document Viewer & Tab System](docs/specs/document-viewer.md)
- [E2E Test Requirements](docs/specs/e2e-app-tests.md)
- [Exception Capture](docs/specs/exception-capture.md)
- [Folder Navigation](docs/specs/folder-navigation.md)
- [Markdown Rendering](docs/specs/markdown-rendering.md)
- [Review Comments](docs/specs/review-comments.md)
- [Test Exception Tracking](docs/specs/test-exception-tracking.md)
- [Store Unit Tests](docs/specs/unit-store-tests.md)
