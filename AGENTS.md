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

**Five engineering meta-principles** — how we work, non-negotiable:

- **Rust-First with MVVM** — Rust (`src-tauri/src/core/`, `src-tauri/src/commands/`) is the Model: data + business logic over typed Tauri commands. `src/lib/vm/` + `src/hooks/` + `src/store/` is the ViewModel. React components are the View. A component that calls `invoke()` or holds business state is a layering violation; a hook that serializes YAML or computes anchors is a Rust-First violation.
- **Never Increase Engineering Debt** — every change holds debt flat or reduces it. Actively close Gaps from the deep-dive docs, delete dead code in the same PR, no TODOs, no workarounds, no "fix later". Drift from canonical patterns is debt.
- **Zero Bug Policy** — every confirmed bug is fixed using the canonical architecture (`docs/architecture.md`) and design patterns (`docs/design-patterns.md`) — not workarounds. Every fix ships with a regression test that reproduces the original failure mode.
- **Proper Fix Over Patch** — every change uses the platform's intended architecture. Never hack around a limitation with a targeted workaround. Fix the design, not the symptom. Use the platform's grain (per-window menus, `emit_to`, `useShallow`), not weaker alternatives (global broadcast + filtering, focus-polling). Scope is not an excuse — a proper fix that touches more files is cheaper long-term than a patch that leaves the wrong abstraction in place.
- **Docs Reflect Shipped Code** — feature docs (`docs/features/`) describe what is implemented, not aspirations. The PR that ships or removes a feature updates the doc in the same commit. A feature doc describing UI that doesn't exist in code is a bug.

## Principles & Rules (deep-dives)

Every rule is numbered and citable as "violates rule N in `docs/X.md`". Each doc is the **single canonical home** for its rules — other docs cross-reference rather than repeat.

| Document | Governs |
|---|---|
| [`docs/principles.md`](docs/principles.md) | Charter — 5 pillars, 5 meta-principles, Non-Goals |
| [`docs/architecture.md`](docs/architecture.md) | Layer separation, IPC/logger chokepoints, state stratification, file-size budgets, MRSF v1.0 + v1.1 schema, re-anchoring algorithm |
| [`docs/performance.md`](docs/performance.md) | Numeric budgets, debounce windows, scan caps, render rules, Shiki singleton, Rust hot paths |
| [`docs/security.md`](docs/security.md) | File-read bounds, path canonicalization, sidecar atomicity, CSP (incl. no-inline-style index.html), capability ACL, markdown XSS posture |
| [`docs/design-patterns.md`](docs/design-patterns.md) | React 19 + Tauri v2 idioms, hook composition, error capture, cross-hook communication |
| [`docs/test-strategy.md`](docs/test-strategy.md) | Three-layer pyramid, coverage floors, IPC mock hygiene, console-spy contract |
| [`docs/observability.md`](docs/observability.md) | `[ipc]` + `[startup]` + `[matching]` log schemas, `#[mdr_command]` macro contract, `StartupRecorder` phases, `--trace` launch flag + `MDR_IPC_TRACE` gating |
| [`docs/best-practices-common/`](docs/best-practices-common/) | **Project-agnostic, stack-specific** patterns (composition, rerender, JS perf, bundle hygiene, Tauri v2). Distilled from external sources with attribution. Project-specific docs above always override. |
| [`docs/best-practices-project/`](docs/best-practices-project/) | **mdownreview-specific** knowledge files: hot-paths, bug categories, test patterns. Single-area files for use by review agents under the per-knowledge-file dispatch protocol. |

**When reviewing:** cite specific rule numbers ("violates rule 14 in `docs/architecture.md`", "violates rule `architecture-avoid-boolean-props` in `docs/best-practices-common/react/composition-patterns.md`"). Do not hand-wave.

## Behavioral Specs

Given/When/Then specifications for behaviour at the binary boundary
(CLI surface, OS file-open, single-instance argv forwarding). Feature
overview docs in `docs/features/` describe **what** the area does;
specs in `docs/specs/` describe **how it must behave** scenario-by-scenario
and are the source of truth for regression tests.

| Spec | Governs |
|---|---|
| [`docs/specs/cli-mdownreview-cli.md`](docs/specs/cli-mdownreview-cli.md) | `mdownreview-cli` binary — every subcommand, every flag, JSON + text output shapes, path-resolution rules, exit codes, source-vs-sidecar auto-detection. |
| [`docs/specs/cli-file-open.md`](docs/specs/cli-file-open.md) | GUI launch arguments, `parse_launch_args` two-pass parser, pending-args queue, single-instance forwarding, Explorer/Finder multi-select, OS shell integration. |

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
| State | Zustand (`workspaceSlice`, `tabsSlice`, `commentsSlice`, `uiSlice`, `updateSlice`, `watcherSlice`, `mermaidPopoutSlice`) |
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
    bindings.ts             ← AUTO-GENERATED by tauri-specta from Rust #[specta::specta] #[tauri::command] annotations.
                              Sole non-test importer of `invoke` from @tauri-apps/api/core.
                              Regenerate (Linux/macOS): `cd src-tauri && cargo test --features codegen --test specta_codegen generate_bindings_ts`
                              Regenerate (Windows):     `cd src-tauri && MDOWNREVIEW_GEN_BINDINGS_ONLY=1 cargo run --features codegen`.
                              CI gates drift via the `bindings-drift` job.
    tauri-commands.ts       ← façade re-exporting `bindings.ts`; production code imports here.
                              Unwraps `Result<T, E>` to `Promise<T>` and adds non-IPC helpers
                              (e.g. `convertFileSrc`, plugin trampolines) that bindings.ts cannot describe.
    anchor-derive.ts        ← in-memory tagged Anchor discriminated union, MrsfComment / MrsfSidecar,
                              `deriveAnchor` / `assertNeverAnchorKind` adapters. Bridges the wire shape
                              (from bindings.ts) to the renderer's tagged form. (Replaces the deleted
                              src/types/comments.ts as of iter 2 of #263.)
    vm/                     ← ViewModel seam — hooks that call the Model and expose reactive state
  logger.ts                 ← re-exports plugin-log; prefix [web] on all messages
  hooks/                    ← useFileContent, useFileWatcher, useSearch, useTheme, useSourceHighlighting …
  __mocks__/
    logger.ts               ← vi.fn() stubs for unit/component tests
    @tauri-apps/api/
      core.ts               ← configurable invoke mock, typed against `bindings.ts` (re-exported via `tauri-commands.ts`)
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
      mermaid/
        MermaidRenderer.tsx     ← render primitive (theme + SVG inject + walk)
        MermaidCanvas.tsx       ← interaction shell (gestures + imperative transform)
        MermaidControls.tsx     ← floating chrome (inline + popout modes)
        MermaidEmbedded.tsx     ← embedded-block wrapper with hover popout button
        MermaidPopout.tsx       ← portal-style overlay
    comments/               ← CommentInput, CommentThread, CommentsPanel, CommentBadge, CommentMarker, SelectionToolbar
    AboutDialog.tsx
    ErrorBoundary.tsx
  store/                    ← Zustand slices
  # Note: `src/types/comments.ts` was deleted in iter 2 of #263; the in-memory Anchor tagged union and adapters now live in `src/lib/anchor-derive.ts`. Wire-level types come from `src/lib/bindings.ts` (auto-generated by tauri-specta from `core/types/wire.rs`).

src-tauri/src/
  commands/                 ← Tauri commands grouped by feature area:
    fs/ · comments/ · search.rs · html.rs · launch.rs
    config.rs               ← author / preferences IPC (set_author, get_author)
    onboarding.rs           ← onboarding state IPC (state read)
    cli_shim.rs             ← CLI shim install/status/remove (+ macos/windows/unsupported submodules)
    default_handler.rs      ← .md default-handler status + open System Settings (+ os submodules)
    word_tokens.rs          ← UAX#29 word segmentation IPC (tokenize_words) — peer of compute_anchor_hash
    mod.rs                  ← flat re-exports so lib.rs/tests keep using commands::xxx paths
  watcher.rs                ← file system watcher (notify-debouncer-mini, 300 ms)
  lib.rs                    ← plugin registration, setup hook, panic hook
  core/                     ← anchors, atomic (write_atomic helper), comments, export, matching,
                              mrsf_version, onboarding (schema-versioned state), paths, scanner,
                              severity, sidecar, threads, types, word_tokens
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
- [Viewer Consistency](docs/features/viewer-consistency.md) — capability tiers, universal requirements, commenting baseline per file type
- [Comments](docs/features/comments.md) — inline review, selection toolbar, MRSF sidecars, re-anchoring algorithm
- [Navigation](docs/features/navigation.md) — folder tree, tabs, workspace search
- [App chrome](docs/features/app-chrome.md) — top toolbar, sticky viewer toolbar, status bar
- [Watcher](docs/features/watcher.md) — file-system watcher, hot reload, ghost-entry detection
- [Updates](docs/features/updates.md) — stable + canary release channels, signed updater
- [Installation](docs/features/installation.md) — install scripts, DMG quarantine, ad-hoc signing posture
- [CLI & File Associations](docs/features/cli-and-associations.md) — CLI file-open, single-instance, OS associations
- [Excalidraw](docs/features/excalidraw.md) — `.excalidraw` / `.excalidrawlib` viewer, Source/Visual/Editor modes, workspace-write chokepoint
- [Settings](docs/features/settings.md) — full-page Settings region (CLI shim, default handler, folder context)
- [Logging](docs/features/logging.md) — frontend + Rust logging chokepoint, exception capture

Taxonomy + drift enforcement is owned by the `documentation-expert` agent (`.claude/agents/documentation-expert.md`).
