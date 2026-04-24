# AGENTS.md — mdownreview

Context for AI agents working on this codebase.

## Git workflow — ALWAYS follow this

**Never commit directly to `main`.** Every change goes through a feature branch and PR.

```bash
git checkout main && git pull
git checkout -b feature/short-description   # or fix/ or chore/
# ... make changes ...
git add <specific files>
git commit -m "type: description"
git push -u origin HEAD
gh pr create --title "..." --body "..."
```

Branch naming: `feature/` new functionality · `fix/` bug fixes · `chore/` tooling/config/docs · `auto-improve/` self-improvement loop

If you accidentally commit to `main`, do NOT force-push. Ask the user how to proceed.

## Product Charter

The canonical charter is [`docs/principles.md`](docs/principles.md). Read it first. Summary:

**Five product pillars** — every feature and trade-off is judged against these:

| Pillar | One-line definition |
|---|---|
| **Professional** | Looks and feels like a tool a developer would pay for. |
| **Reliable** | Comments are indestructible; refactors, deletes, and crashes do not lose them. |
| **Performant** | Fast startup, fast open, fast search, fast render — measured, not intuited. |
| **Lean** | Minimal memory, disk, dependencies, and binary size. The app is a viewer, not a platform. |
| **Architecturally Sound** | Clean boundaries, narrow IPC surface, single chokepoints for IPC and logging. |

**Three engineering meta-principles** — how we work, non-negotiable:

- **Rust-First with MVVM** — Rust (`src-tauri/src/core/`, `commands.rs`) is the Model: data + business logic over typed Tauri commands. `src/lib/vm/` + `src/hooks/` + `src/store/` is the ViewModel. React components are the View. A component that calls `invoke()` or holds business state is a layering violation; a hook that serializes YAML or computes anchors is a Rust-First violation.
- **Never Increase Engineering Debt** — every change holds debt flat or reduces it. Actively close Gaps from the deep-dive docs, delete dead code in the same PR, no TODOs, no workarounds, no "fix later". Drift from canonical patterns is debt.
- **Zero Bug Policy** — every confirmed bug is fixed using the canonical architecture (`docs/architecture.md`) and design patterns (`docs/design-patterns.md`) — not workarounds. Every fix ships with a regression test that reproduces the original failure mode.

## Principles & Rules (deep-dives)

Every rule below is numbered and citable as "violates rule N in `docs/X.md`".

| Document | Governs |
|---|---|
| [`docs/principles.md`](docs/principles.md) | Charter — 5 pillars, 3 meta-principles, Non-Goals |
| [`docs/architecture.md`](docs/architecture.md) | Layer separation, IPC chokepoint, Zustand boundaries, file-size budgets |
| [`docs/performance.md`](docs/performance.md) | Startup/open/render budgets, watcher debounce, memory ceilings, benchmark requirements |
| [`docs/security.md`](docs/security.md) | IPC surface, path canonicalization, markdown XSS posture, CSP, sidecar atomicity |
| [`docs/design-patterns.md`](docs/design-patterns.md) | React 19 + Tauri v2 idioms, hook composition, command-vs-event choice |
| [`docs/test-strategy.md`](docs/test-strategy.md) | Three-layer pyramid, coverage floors, IPC mock hygiene, console-error-spy contract |

**When reviewing:** cite specific rule numbers ("violates rule 14 in `docs/architecture.md`"). Do not hand-wave.

## What This Is

A slim and fast desktop app written in Rust and React for browsing, viewing and reviewing markdown, code and other text files on Windows and macOS. Users open folders of `.md`/`.mdx` files, read and navigate them, and attach inline review comments. The app is a **viewer/reviewer, not an editor**.

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

## Constraints

- Runs on Windows 10+ and macOS 12+ without a GPU requirement
- Fully offline — no network calls except system browser links
- Comments persist locally alongside reviewed files (no database)
- File associations registered per-user (no UAC elevation on Windows)
- Tests should run headlessly in CI; non-headless tests are acceptable when needed for manual failure capture

## Architecture

Two runtime layers bridged by Tauri v2:

**Rust layer** (`src-tauri/src/`)
- File I/O via custom commands — `read_text_file`, `read_dir` — that bypass `tauri-plugin-fs` scope restrictions (intentional for local-only viewer). Guarded by 10 MB size limit and null-byte binary detection. `read_dir` filters out `.review.yaml` and `.review.json` sidecars.
- Comment persistence: `save_review_comments` / `load_review_comments` write MRSF v1.0 YAML sidecar files alongside each reviewed document. Loads YAML first, falls back to JSON for backward compatibility.
- File watcher: `watcher.rs` uses `notify-debouncer-mini` (300ms) to watch the open files and their review sidecars (`.review.yaml` / `.review.json`). Emits `file-changed` events with `content | review | deleted` kinds.
- Orphan scanner: `scan_review_files` walks a directory tree to find `.review.yaml` and `.review.json` sidecars, used for ghost entry detection (capped at 10K results).
- CLI arg handling: parsed in `setup` hook, stored in `Arc<Mutex<Option<LaunchArgs>>>`, consumed via `get_launch_args` command (poll on mount, not event push — eliminates the race where events fire before React's first `useEffect`).
- Logging: `tauri-plugin-log` routes both Rust `tracing` macros and WebView `console.*` calls to a single rotating log file.

**React/TypeScript layer** (`src/`)
- State: Zustand with six slices — `workspaceSlice` (root folder, tree state), `tabsSlice` (open tabs, scroll positions), `commentsSlice` (comments by file path), `uiSlice` (theme, pane widths), `updateSlice` (auto-update state), `watcherSlice` (ghost entries, auto-reveal, save timestamp).
- Viewers: `MarkdownViewer` (react-markdown + remark-gfm + @shikijs/rehype + rehype-slug), `SourceView` (Shiki direct API, with comments/folding/search), `BinaryPlaceholder`.
- All Tauri calls go through `src/lib/tauri-commands.ts` typed wrappers — never call `invoke` directly in components or hooks.
- All logging goes through `src/logger.ts` — never import `@tauri-apps/plugin-log` directly.

## Key Design Decisions

1. **Custom Tauri commands bypass `tauri-plugin-fs` scope** (intentional — local viewer). `read_text_file` rejects files >10 MB and detects binary via first-512-byte null scan.
2. **`MD_COMPONENTS` defined at module scope** (never inside render). Per-block IDs use `node.position.start.line` from react-markdown's `node` prop. Prevents React error #185 in concurrent mode.
3. **Comments as MRSF v1.0 sidecars** — `<filename>.review.yaml` (primary) or `.review.json` (legacy fallback) in the same directory. Uses the open [Sidemark/MRSF specification](https://sidemark.org/specification.html) for interoperability with VS Code's Sidemark extension. Portable alongside files; no database.
4. **Anchor by selected text + line number** — MRSF `selected_text` with SHA-256 hash and line/column anchors. 4-step re-anchoring algorithm (exact text → line fallback → fuzzy match → orphan) survives AI refactoring.
5. **Poll for first-instance CLI args** via `get_launch_args` command (not an event). Events can fire before React's first `useEffect`; the command is called on mount after React commits, eliminating the race. Second-instance args use `args-received` event (safe because the window is already running).
6. **Unified Shiki** for both `MarkdownViewer` fenced blocks and `SourceView`. Using two different highlighters would produce inconsistent code themes.
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
| Frontend | React 19, TypeScript |
| State | Zustand (`workspaceSlice`, `tabsSlice`, `commentsSlice`, `uiSlice`, `updateSlice`, `watcherSlice`) |
| Markdown rendering | `react-markdown` + `remark-gfm` + `@shikijs/rehype` + `rehype-slug` |
| Syntax highlighting | Shiki (`@shikijs/rehype` in MarkdownViewer, direct API in SourceView) |
| Linting | ESLint 9 (flat config) + `@typescript-eslint` + `eslint-plugin-react` + React compiler rules |
| Unit/component tests | Vitest + React Testing Library + jsdom |
| Browser integration tests | Playwright (Vite dev server + Tauri IPC mock) |
| Native E2E tests | Playwright (real Tauri binary via CDP, Windows only) |

## Test Strategy

Full rules: [`docs/test-strategy.md`](docs/test-strategy.md). Summary below.

Three layers. Know which to use and why:

| Layer | Location | Runner | What it tests | When it runs |
|---|---|---|---|---|
| Unit / component | `src/**/__tests__/` | `npm test` (Vitest) | Pure logic, React component rendering, store slices, utility functions | Every commit |
| Browser integration | `e2e/browser/` | `npm run test:e2e` (Playwright, Vite dev server) | UI flows with mocked Tauri IPC — verifies React components respond correctly to events and commands. **Does NOT test Rust, file I/O, or real IPC.** | Every commit |
| Native E2E | `e2e/native/` | `npm run test:e2e:native` (Playwright, real binary) | Full-stack scenarios: OS file events → Rust watcher → Tauri emit → React re-render; CLI arg handling; comment persistence to disk. Windows only (WebView2 + CDP). | Release workflow only |

### What belongs in each layer

**Write a unit test when:** testing a pure function, a store action, or a React component in isolation (no IPC, no file I/O).

**Write a browser integration test when:** testing a UI flow (open file → see content, toggle panel, keyboard shortcut). Use `window.__TAURI_IPC_MOCK__` and dispatch `mdownreview:file-changed` CustomEvents to simulate Tauri responses. These tests run in milliseconds and need no build step.

**Write a native E2E test when:** the scenario requires real file I/O, real OS events, the Rust watcher, CLI arg handling, or actual comment persistence. Every native test MUST include a comment explaining why it cannot be a browser test.

### IPC mock pattern (browser tests)

```typescript
await page.addInitScript(({ dir }) => {
  window.__TAURI_IPC_MOCK__ = async (cmd, args) => {
    if (cmd === "get_launch_args") return { files: [], folders: [dir] };
    if (cmd === "read_dir") return [{ name: "file.md", path: `${dir}/file.md`, is_dir: false }];
    if (cmd === "read_text_file") return "# Content";
    if (cmd === "load_review_comments") return null;
    if (cmd === "save_review_comments") return null;
    if (cmd === "check_path_exists") return "file";
    if (cmd === "get_log_path") return "/mock/log.log";
    return null;
  };
}, { dir: "/e2e/fixtures" });
```

Always mock ALL commands listed above or the app will hang on an unresolved promise.

### File-changed event simulation (browser tests)

```typescript
await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent("mdownreview:file-changed", {
    detail: { path: "/e2e/fixtures/file.md", kind: "content" }
  }));
});
```
Kinds: `"content"` (source file changed), `"review"` (sidecar changed), `"deleted"`.

## Codebase Layout

```
src/
  lib/
    tauri-commands.ts       ← typed invoke wrappers; ALL Tauri calls go here
    comment-matching.ts     ← MRSF 4-step re-anchoring algorithm
    comment-anchors.ts      ← SHA-256 hash, MRSF anchor creators
  logger.ts                 ← re-exports plugin-log; prefix [web] on all messages
  hooks/
    useFileContent.ts       ← file content loader with auto-reload on watcher events
    useFileWatcher.ts       ← connects Rust watcher to frontend, manages ghost entries
    useSearch.ts            ← in-document search
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
      SourceView.tsx          ← full-featured source viewer with comments, folding, search
      DeletedFileViewer.tsx   ← shows orphaned comments for deleted files
      ViewerRouter.tsx        ← routes to appropriate viewer (incl. ghost detection)
      BinaryPlaceholder.tsx
    comments/
      CommentInput.tsx
      CommentThread.tsx       ← threaded comments with author badges, reply, orphan banner
      CommentsPanel.tsx
      LineCommentMargin.tsx
      SelectionToolbar.tsx
    AboutDialog.tsx
    ErrorBoundary.tsx
  store/                    ← Zustand slices (workspace, tabs, comments, ui, update, watcher)

src-tauri/src/
  commands.rs               ← all Tauri commands (incl. scan_review_files)
  watcher.rs                ← file system watcher (notify crate, 300ms debounce)
  lib.rs                    ← plugin registration, setup hook, panic hook

e2e/
  browser/                  ← Playwright tests (Vite dev server + IPC mock)
    fixtures/               ← error-tracking.ts, index.ts, test data files
    *.spec.ts
  native/                   ← Playwright tests (real binary, Windows-only CDP)
    *.spec.ts
```

## Testing Conventions

- **Vitest** for unit and component tests. `test-setup.ts` spies on `console.error` and `console.warn` in every test — unexpected calls fail the test. Tests that intentionally trigger errors must suppress the spy with `mockImplementation(() => {})`.
- **Playwright** browser E2E imports `{ test, expect }` from `e2e/browser/fixtures/index.ts` — not from `@playwright/test` directly. The fixture attaches `pageerror` and `console` error collectors; any uncaught error fails the test. Native E2E (`e2e/native/`) imports from `@playwright/test` directly.
- **Rust** integration tests in `src-tauri/tests/commands_integration.rs`.
- Dev-server E2E (`npm run test:e2e`) targets the Vite dev server with Tauri IPC mocked. Native binary tests (`npm run test:e2e:native`) are a pre-release manual gate.
- **A task is NOT complete until `npm run lint`, `cargo test`, `npm test`, and `npm run test:e2e` all pass.**

## Log File

Release builds write to `{appDataDir}/logs/mdownreview.log`. Rotation at 5 MB, max 3 files. Log level `info` in release, `debug` in debug builds. WebView `console.log/debug` suppressed in release (only `warn`/`error` forwarded). Path exposed in the About dialog with a "Copy path" button.

## Comment Data Model (MRSF v1.0)

Uses the [Markdown Review Sidecar Format (MRSF) v1.0](https://sidemark.org/specification.html) — an open standard for review comments stored alongside documents. Compatible with VS Code's Sidemark extension.

**Sidecar file:** `<filename>.review.yaml` (primary) or `.review.json` (legacy read-only)

```yaml
mrsf_version: "1.0"
document: "filename.ext"        # Relative path to reviewed file
comments:
  - id: "uuid"                  # Required: unique identifier
    author: "Display Name (id)" # Required: "Name (identifier)" format
    timestamp: "2025-04-15T10:00:00Z"  # Required: RFC 3339
    text: "Comment text"        # Required: comment body
    resolved: false             # Required: resolution status
    # Anchor fields (optional):
    line: 42                    # 1-based line number
    end_line: 45                # End line for multi-line selections
    start_column: 10            # 0-based start column
    end_column: 30              # 0-based end column
    selected_text: "code here"  # Selected text for re-anchoring
    selected_text_hash: "sha256..."  # SHA-256 of selected_text
    # Metadata (optional):
    type: "suggestion"          # suggestion | issue | question | accuracy | style | clarity
    severity: "low"             # low | medium | high
    reply_to: "parent-uuid"     # Threading: references parent comment ID
    commit: "abc1234"           # Git commit SHA at comment creation
```

### Threading

Flat `reply_to` model — replies are top-level comments with `reply_to` referencing the parent comment's `id`. No nested `responses[]` array (v3 format removed).

### Re-anchoring Algorithm (4-step)

1. **Exact match**: Find `selected_text` at original line, then search full document
2. **Line fallback**: If line number is still in bounds, anchor there
3. **Fuzzy match**: Levenshtein similarity ≥ 0.6, prefer closest to original line
4. **Orphan**: All strategies failed — comment displayed with orphan banner

### Surviving AI Refactoring

1. **MRSF anchoring** with 4-step re-anchoring (exact text → line → fuzzy → orphan)
2. **Sidecar files** (`<filename>.review.yaml`) travel alongside source files
3. **Ghost entries**: when a file is deleted but its sidecar remains, the folder tree shows a strikethrough entry and the DeletedFileViewer displays orphaned comments
4. **File watcher**: Rust `notify` crate watches open files + sidecars with 300ms debounce, auto-reloading content and comments when the AI makes changes
5. **Save-loop prevention**: 1.5s debounce guard after app saves prevents watcher → reload → save cycles

## File Watcher

Rust-side watcher (`src-tauri/src/watcher.rs`) using `notify-debouncer-mini`:
- Watches the open files and their review sidecars (`.review.yaml` / `.review.json`)
- Emits `file-changed` Tauri events with `{path, kind}` where kind is `content | review | deleted`
- Frontend `useFileWatcher` hook syncs open tabs to watcher, dispatches DOM `CustomEvent`s
- `useFileContent` hook re-reads file on content changes
- Viewers reload comments on review sidecar changes
- `scan_review_files` command walks directory tree to find orphan sidecars (capped at 10K)

## Folder Tree Enhancements

- **Auto-reveal**: 📍 toggle (persisted) expands tree path and scrolls to active file on tab switch
- **Auto-root**: when no workspace is open, tree root auto-sets to parent dir of active file
- **Ghost entries**: deleted files with review sidecars appear with strikethrough
- **Comment badges**: files show unresolved comment count (numeric badge, not just a dot)
- **Hidden sidecars**: `.review.yaml` and `.review.json` files are filtered from `read_dir` results

## Behavioral Specs

Feature-level requirements (principles/rules live in [`docs/principles.md`](docs/principles.md) and the 5 deep-dives):

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
