# AGENTS.md — mdownreview

Context for AI agents working on this codebase. This file is a **router**: all principles and rules live in [`docs/principles.md`](docs/principles.md) and the five deep-dives.

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

Canonical: [`docs/principles.md`](docs/principles.md). Summary:

**Five product pillars** — every feature and trade-off is judged against these:

| Pillar | One-line definition |
|---|---|
| **Professional** | Looks and feels like a tool a developer would pay for. |
| **Reliable** | Comments are indestructible; refactors, deletes, and crashes do not lose them. |
| **Performant** | Fast startup, fast open, fast search, fast render — measured, not intuited. |
| **Lean** | Minimal memory, disk, dependencies, and binary size. The app is a viewer, not a platform. |
| **Architecturally Sound** | Clean boundaries, narrow IPC surface, single chokepoints for IPC and logging. |

**Three engineering meta-principles** — how we work, non-negotiable:

- **Rust-First with MVVM** — Rust (`src-tauri/src/core/`, `src-tauri/src/commands/`) is the Model: data + business logic over typed Tauri commands. `src/lib/vm/` + `src/hooks/` + `src/store/` is the ViewModel. React components are the View. A component that calls `invoke()` or holds business state is a layering violation; a hook that serializes YAML or computes anchors is a Rust-First violation.
- **Never Increase Engineering Debt** — every change holds debt flat or reduces it. Actively close Gaps from the deep-dive docs, delete dead code in the same PR, no TODOs, no workarounds, no "fix later". Drift from canonical patterns is debt.
- **Zero Bug Policy** — every confirmed bug is fixed using the canonical architecture (`docs/architecture.md`) and design patterns (`docs/design-patterns.md`) — not workarounds. Every fix ships with a regression test that reproduces the original failure mode.

## Principles & Rules (deep-dives)

Every rule is numbered and citable as "violates rule N in `docs/X.md`". Each doc is the **single canonical home** for its rules — other docs cross-reference rather than repeat.

| Document | Governs |
|---|---|
| [`docs/principles.md`](docs/principles.md) | Charter — 5 pillars, 3 meta-principles, Non-Goals |
| [`docs/architecture.md`](docs/architecture.md) | Layer separation, IPC/logger chokepoints, state stratification, file-size budgets, MRSF v1.0 schema, 4-step re-anchoring |
| [`docs/performance.md`](docs/performance.md) | Numeric budgets, debounce windows, scan caps, render rules, Shiki singleton, Rust hot paths |
| [`docs/security.md`](docs/security.md) | File-read bounds, path canonicalization, sidecar atomicity, CSP, capability ACL, markdown XSS posture |
| [`docs/design-patterns.md`](docs/design-patterns.md) | React 19 + Tauri v2 idioms, hook composition, error capture, cross-hook communication |
| [`docs/test-strategy.md`](docs/test-strategy.md) | Three-layer pyramid, coverage floors, IPC mock hygiene, console-spy contract |

**When reviewing:** cite specific rule numbers ("violates rule 14 in `docs/architecture.md`"). Do not hand-wave.

## What This Is

A slim, fast desktop app for browsing, viewing, and reviewing markdown, code, and other text files on Windows and macOS. Users open folders of `.md`/`.mdx` files, read and navigate them, and attach inline review comments. **Viewer/reviewer, not an editor.** Primary users are developers who receive batches of files from AI tools.

## Non-Goals

Summary only — full rationale in [`docs/principles.md`](docs/principles.md).

- Editing file content · Git integration · Cloud sync · Plugin/extension system · Telemetry · In-app log viewer · Linux `.desktop` association · File types beyond `.md`/`.mdx` · Built-in AI chat · Realtime multi-reviewer presence

## Constraints

- Runs on Windows 10+ and macOS 12+ without a GPU requirement
- Fully offline — no network calls except system browser links and signed updater check
- Comments persist locally alongside reviewed files (no database)
- File associations registered per-user (no UAC elevation on Windows)
- Tests should run headlessly in CI

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

## Codebase Layout

```
src/
  lib/
    tauri-commands.ts       ← typed invoke wrappers; ALL Tauri calls go here
    vm/                     ← ViewModel seam — hooks that call the Model and expose reactive state
  logger.ts                 ← re-exports plugin-log; prefix [web] on all messages
  hooks/                    ← useFileContent, useFileWatcher, useSearch, useTheme, useSourceHighlighting …
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
      SourceView.tsx        ← full-featured source viewer with comments, folding, search
      DeletedFileViewer.tsx ← shows orphaned comments for deleted files
      ViewerRouter.tsx      ← routes to appropriate viewer (incl. ghost detection)
      BinaryPlaceholder.tsx
      MermaidView.tsx
    comments/               ← CommentInput, CommentThread, CommentsPanel, LineCommentMargin, SelectionToolbar
    AboutDialog.tsx
    ErrorBoundary.tsx
  store/                    ← Zustand slices

src-tauri/src/
  commands/                 ← Tauri commands grouped by feature area:
    fs.rs · comments.rs · search.rs · html.rs · launch.rs
    onboarding.rs           ← onboarding state IPC (load/save/skip)
    cli_shim.rs             ← CLI shim install/status/remove (+ macos/windows/unsupported submodules)
    default_handler.rs      ← .md default-handler status + open System Settings (+ os submodules)
    folder_context.rs       ← Windows folder context menu register/unregister/status (+ os submodules)
    mod.rs                  ← flat re-exports so lib.rs/tests keep using commands::xxx paths
  watcher.rs                ← file system watcher (notify-debouncer-mini, 300 ms)
  lib.rs                    ← plugin registration, setup hook, panic hook
  core/                     ← anchors, atomic (write_atomic helper), comments, matching,
                              onboarding (schema-versioned state), scanner, sidecar, threads, types
  installer/installer-hooks.nsh ← NSIS POST/PREINSTALL hooks (HKCU PATH + folder context)
  dmg/                      ← DMG layout assets (background image, README.txt)

e2e/
  browser/                  ← Playwright tests (Vite dev server + IPC mock)
    fixtures/               ← error-tracking.ts, index.ts, test data files
  native/                   ← Playwright tests (real binary, Windows-only CDP)
```

## Feature Documentation

**Evergreen** descriptions of each major user-facing area live in [`docs/features/`](docs/features/) — one file per capability, refreshed in place when the area changes. Start here to understand what the app does:

- [Viewer](docs/features/viewer.md) — markdown, source, Mermaid, JSON, CSV, HTML, image, binary rendering
- [Comments](docs/features/comments.md) — inline review, selection toolbar, MRSF sidecars, 4-step re-anchoring
- [Navigation](docs/features/navigation.md) — folder tree, tabs, workspace search
- [Watcher](docs/features/watcher.md) — file-system watcher, hot reload, ghost-entry detection
- [Updates](docs/features/updates.md) — stable + canary release channels, signed updater
- [Installation](docs/features/installation.md) — install scripts, DMG quarantine, ad-hoc signing posture
- [CLI & File Associations](docs/features/cli-and-associations.md) — CLI file-open, single-instance, OS associations
- [Logging](docs/features/logging.md) — frontend + Rust logging chokepoint, exception capture

Taxonomy + drift enforcement is owned by the `documentation-expert` agent (`.claude/agents/documentation-expert.md`).
