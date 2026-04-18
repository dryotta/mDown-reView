## Why

AI agents produce large volumes of markdown and source files that need human review, but no desktop tool is purpose-built for reviewing (not editing) AI-generated output with annotation support. Existing editors (VS Code, Obsidian) are heavy and optimized for authoring.

The app must also be a first-class OS citizen: users expect to double-click a `.md` file in File Explorer or Finder and have it open immediately — requiring CLI argument support and file-type association in the installer.

Finally, the app ships with a full observability contract from day one: structured logging in both Rust and the web layer, automatic exception capture, and tests that fail on any unhandled error.

## What Changes

This is a greenfield desktop application with its full test infrastructure, OS shell integration, and logging built in from the start.

- New Rust + Tauri shell with React + TypeScript frontend
- GitHub-flavored Markdown renderer for `.md` files
- Syntax-highlighted source viewer for code files and plain text
- Tab-based multi-document interface for switching between open files
- Folder/file tree pane for navigating a directory
- Review comment system: annotate lines/sections with inline comments and a side panel
- CLI argument support: file/folder paths passed on the command line open as tabs or workspace root on launch; single-instance forwarding when the app is already running
- Windows NSIS and MSI installers register `.md`/`.mdx` file associations; macOS bundle declares document type handlers in `Info.plist`
- Structured logging via `tauri-plugin-log` writing to a rotating file; all Tauri command errors and panics logged automatically; JS exceptions, unhandled rejections, and React render errors forwarded to the same log
- Vitest unit and component tests with `console.error` spy enforcement; Playwright E2E tests with `pageerror` listener that fails on any unhandled JS error
- Application packaging for Windows (MSI/NSIS) and macOS (DMG)

## Capabilities

### New Capabilities

- `document-viewer`: Tab-based viewer that opens and displays markdown, source code, and plain text files with file-type detection
- `markdown-rendering`: GitHub-flavored Markdown rendering with syntax-highlighted code blocks, tables, task lists, and image support
- `folder-navigation`: Collapsible folder/file tree pane that lets users browse a directory and open files into the viewer
- `review-comments`: Mechanism for attaching review comments to specific lines or sections of a document, with the ability to view and manage all comments
- `cli-file-open`: The app accepts file and folder paths as command-line arguments and opens them on launch; single-instance forwarding; Windows and macOS file-type associations registered by the installer
- `app-logging`: Structured log output to rotating file (Rust + web layer); log level configurable; log file path exposed in About dialog
- `exception-capture`: All unhandled exceptions in Rust (panic hook) and JS (global error handlers, ErrorBoundary) automatically captured and written to the log with stack trace
- `unit-store-tests`: Vitest tests for the Zustand store slices — state transitions, persistence serialization, edge cases
- `component-viewer-tests`: React Testing Library tests for all components — rendering correctness, interaction, error boundary behavior
- `e2e-app-tests`: Playwright tests for full user flows — open folder, navigate files, add/persist/delete comments, tab switching, scroll restore
- `test-exception-tracking`: Vitest and Playwright suites configured to fail on any unexpected console error or unhandled exception

### Modified Capabilities

<!-- None — this is a new application -->

## Impact

- **New Rust dependencies**: Tauri v2, `tauri-plugin-log`, `tauri-plugin-single-instance`, `tracing`, `tracing-subscriber`
- **New JS dependencies**: `react-markdown`, `remark-gfm`, `rehype-highlight`, `rehype-slug`, `shiki`, `zustand`, `@tauri-apps/plugin-log`
- **New dev dependencies**: `vitest`, `@vitest/coverage-v8`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `@playwright/test`
- **Installer config**: `fileAssociations` for `.md`/`.mdx` in `bundle.windows.nsis` and `bundle.windows.wix`; `CFBundleDocumentTypes` in `bundle.macOS.infoPlist`
- **Log file**: `{appDataDir}/logs/markdown-review.log` (rotated at 5 MB, max 3 files)
- **Platform targets**: Windows 10+ (x64), macOS 12+ (arm64 + x64)
- **No existing code affected** — this is a new repository
