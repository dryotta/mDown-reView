# Architecture

Canonical for structural and layering rules. Cite violations as "violates rule N in `docs/architecture.md`". Charter: [`docs/principles.md`](principles.md).

## Principles

Unique to architecture. Rust-First is a charter meta-principle — see [`docs/principles.md`](principles.md).

1. **Single IPC Chokepoint.** Every `invoke()` flows through `src/lib/tauri-commands.ts`, which owns wrapper signatures, argument shape, and TypeScript return types mirrored from Rust.
2. **Single Logging Chokepoint.** Frontend logging flows through `src/logger.ts`; Rust logging uses `tracing`/`log::*`, both routed by `tauri-plugin-log` to one rotating file.
3. **State Stratification.** Domain state (comments) lives in MRSF sidecar files; reactive UI state in Zustand; ephemeral view state (scroll, selection, folding) in component `useState`/`useRef`. Persist middleware serializes UI only.
4. **Commands Mutate, Events Notify.** Tauri commands do imperative work and return typed results. Events notify async change. Events can fire before React's first `useEffect`, so deterministic bootstrap uses commands.
5. **Layer Directionality.** Dependencies flow inward only: `components/` → `hooks/` → `lib/` → `store/`. `lib/vm/` is the single seam where `lib/` may read `@/store`. `lib/` never imports `components/` or `hooks/`.

```mermaid
flowchart LR
    Components["src/components/<br/>(View — JSX)"]
    Hooks["src/hooks/<br/>(wires)"]
    Lib["src/lib/<br/>(typed IPC, pure utils)"]
    Store[("src/store/<br/>Zustand slices")]
    LibVM["src/lib/vm/<br/>(only seam reading store)"]
    Components --> Hooks
    Components --> Store
    Hooks --> Lib
    Hooks --> Store
    LibVM --> Store
    Lib -.->|"forbidden"| Components
    Lib -.->|"forbidden"| Hooks
```

## Rules

### IPC & logging chokepoints

```mermaid
flowchart LR
    Comp["component / hook"] --> Wrapper["src/lib/tauri-commands.ts<br/>(typed wrapper — only<br/>non-test invoke importer)"]
    Wrapper -- "invoke()" --> Cmd["src-tauri/src/commands.rs<br/>(registered in shared_commands!)"]
    Cmd --> Core["core/ — sidecar, matching, anchors,<br/>paths, scanner, …"]
    Cmd -. "emit_to('main', …)" .-> Listener["useFileWatcher /<br/>App.tsx listeners"]
```

1. Every Tauri IPC call goes through a typed wrapper in `src/lib/tauri-commands.ts`; production code never imports `invoke` directly. (`src/lib/tauri-commands.ts:1` is the only non-test `invoke` importer.)
2. Every new Rust command ships with a matching typed TS wrapper; the wrapper's return type matches the Rust `Result<T, String>` unwrapped `T`. (`commands/comments/mod.rs` ↔ `tauri-commands.ts:50`.)
3. Every Rust command is registered in `shared_commands!` in `src-tauri/src/lib.rs:222-262`. Commands are grouped under `src-tauri/src/commands/<feature>.rs` (`src-tauri/src/commands/mod.rs:7-15`): `fs` (incl. `update_tree_watched_dirs` for folder-tree watches), `comments`, `search`, `html`, `launch`, `remote_asset` (bounded HTTPS image proxy — `fetch_remote_asset`; bounds in rule 27 of [`docs/security.md`](security.md)), `config` (`set_author`, `get_author`), `onboarding`, `word_tokens` (`tokenize_words` — UAX#29 word segmentation peer of `compute_anchor_hash`, used by `Word_range` anchors), plus the iter-2 onboarding/platform-integration set (`onboarding` ×1 (`onboarding_state`), `cli_shim` ×3, `default_handler` ×2, `folder_context` ×3 — see [`docs/features/installation.md`](features/installation.md)). Path resolution shared by both the GUI and CLI binaries lives in `src-tauri/src/core/paths.rs`.

   *Structured-return chokepoint.* When a single command's caller needs the bytes AND cheap-to-compute metadata (size, line count, …), return a struct that carries both rather than forcing a second IPC round-trip. Canonical example: `read_text_file` returns `TextFileResult { content, size_bytes, line_count }` (`commands/fs.rs:71-109`) so the StatusBar reads from a Zustand-cached `fileMetaByPath` populated by `useFileContent` — neither component issues its own metadata IPC. See rule 2 in [`docs/performance.md`](performance.md).
4. All frontend logging goes through `src/logger.ts`; no file outside `src/logger.ts` and its test imports from `@tauri-apps/plugin-log`.
5. Log prefix tags: frontend `[web]`, Rust `[rust]` or a subsystem like `[watcher]`. (`src/logger.ts:9-13`; `watcher.rs:93`.)
6. `console.log`/`console.info` never appear in production frontend code. Diagnostic logging in watcher hooks goes through `@/logger` (`warn`/`debug`), not `console.*`. (`useFileWatcher.ts:45,57,61`.)

### MRSF ownership (Rust is the source of truth)
7. MRSF sidecar read/write/serde/reparenting lives in Rust (`src-tauri/src/core/sidecar/`, `core/comments.rs`); TypeScript never parses or serializes sidecars.
8. Sidecar-mutating commands emit `comments-changed` after save. (`commands/comments/mod.rs` `with_sidecar_mut`; atomic write via `core/atomic.rs::write_atomic`.)
9. Anchor resolution is a two-path Rust pipeline in `get_file_comments`: (a) `Line`/`File` anchors follow the 4-step re-anchoring algorithm in `core/matching.rs`; (b) typed anchors (`ImageRect`, `CsvCell`, `JsonPath`, `HtmlRange`, `HtmlElement`, `WordRange`) dispatch through `resolve_anchor(&Anchor, &LazyParsedDoc)` in `core/anchors/mod.rs` with `OnceCell` lazy parse caching (interior mutability — no `&mut` needed) — one parse per file per `get_file_comments` call regardless of comment count. (`commands/comments/mod.rs`; `core/anchors/mod.rs`.)
10. SHA-256 of `selected_text` is computed in Rust via `compute_anchor_hash`. (`commands/comments/mod.rs`.)

### Commands vs events
11. Launch args flow through a pending-args queue in Rust (`src-tauri/src/commands/launch.rs::PendingArgsState`). First-instance bootstrap, second-instance forwarding, and macOS `RunEvent::Opened` all push onto the queue. Frontend drains via `get_launch_args` IPC; the `args-received` event is signal-only (no payload). The IPC return type stays `LaunchArgs` (single struct with merged `files`/`folders` fields) — the queue is purely Rust-internal. (`useLaunchArgsBootstrap.ts:14,21`; `lib.rs:101`; `commands/launch.rs:15`.)
12. The file watcher lives in Rust and emits `file-changed` with kinds `content | review | deleted`. (`watcher.rs:58,88-92`.) Debounce: rule 4 in [`docs/performance.md`](performance.md). Also emits `folder-changed` events with payload `{ path: string }` (canonical directory) when a watched directory's children change. Frontend registers watched directories via `update_tree_watched_dirs(root, dirs)`, capped at `MAX_TREE_WATCHED_DIRS = 1024`. See `src-tauri/src/watcher.rs`.
13. The frontend never polls the filesystem; reactive reload uses watcher events routed through `useFileWatcher` → DOM `CustomEvent("mdownreview:file-changed")`. (`useFileWatcher.ts:51-73`.)
14. Ghost-entry scanning uses a single Rust command. (`commands/launch.rs:26` `scan_review_files`.) Cap: rule 3 in [`docs/performance.md`](performance.md).

### State boundaries
15. Zustand `persist` serializes only UI state: `theme`, `folderPaneWidth`, `commentsPaneVisible`, `root`, `expandedFolders`, `authorName`, `readingWidth`, `recentItems`, `tabs`, `activeTabPath`, `updateChannel`, `zoomByFiletype`. `ghostEntries`, `lastSaveByPath`, `lastFileReloadedAt`, `lastCommentsReloadedAt`, `viewModeByTab`, `fileMetaByPath`, `updateStatus`, comments, scroll values, tab back/forward history (`tabHistory` slice — session-only), and `viewerPrefsSlice.allowedRemoteImageDocs` are never persisted — trust decisions like remote-image allowance must not silently survive an app restart. The persist config carries a monotonic `version` and `migrate` fn; v1 (issue #89) strips Windows `\\?\` verbatim prefixes from `root` / `activeTabPath` / `tabs[].path` / `recentItems[].path` / `expandedFolders` keys for snapshots written by pre-#89 clients (`store/migrations/v1-strip-verbatim.ts`). (`store/index.ts` `partialize`; tabs slice `store/tabs.ts:39-58`; viewerPrefs slice `store/viewerPrefs.ts`; tabHistory slice `store/tabHistory.ts`.)
16. Cross-slice state changes from a single user action group into one store action. (`store/index.ts:149-161` `closeTab`.) See rule 28 for the related no-shared-boolean-mount rule that enforces single-surface invariance for multi-surface UI intents.
17. `lib/` never imports `components/` or `hooks/`; `lib/vm/` is the only place `lib/` reads `@/store`. (Grep-verified: `@/components` / `@/hooks` in `src/lib/` → 0; `@/store` → only `src/lib/vm/use-comment-actions.ts:2`.)

### Component & viewer boundaries
18. Viewer components route through `ViewerRouter` based on `FileStatus` from `useFileContent`. (`ViewerRouter.tsx:93-132`.)
19. Components subscribe to the store with narrow selectors (single-field or `useShallow`), never unfiltered `useStore()`. (`App.tsx:49-63`; `TabBar.tsx:8-10`.)
20. Comment mutation UI uses `useCommentActions` (`src/lib/vm/use-comment-actions.ts`); components never call low-level `addComment`/`editComment` wrappers. (`CommentThread.tsx:30,113`.)
21. Comment rendering reads through `useComments` (`src/lib/vm/use-comments.ts`); components never call `getFileComments` directly.
22. `read_dir` filters out sidecar files (`.review.yaml`, `.review.json`) before returning. (`commands/fs.rs:49-51`.)

### File-size budgets
23. Any file >400 lines in `src/components/` or `src-tauri/src/` is a structural smell and must be split. Shared-chokepoint files (`src/store/index.ts`, `src/App.tsx`, `src-tauri/src/lib.rs`) get a 500-line budget. The old `src-tauri/src/commands.rs` god-file was deleted in iter 2 and is now the `commands/` folder; iter-5 of #71 split `commands/comments.rs` (was 431) into `commands/comments/mod.rs` (348, hosts mutating commands + `NewCommentAnchor` IPC discriminator) + `commands/comments/get.rs` (217, hosts `get_file_comments` and the resolution perf-guard tests), and refactored `MarkdownViewer.tsx` (was 454) into the lean shell `MarkdownViewer.tsx` (306) + `MarkdownComponentsMap.tsx` (177, the rehype/remark wiring) + `MarkdownInteractionLayer.tsx` (80, the click/hover bridge to the comment store) + `CommentableBlocks.tsx` (203, the per-block `+` gutter and popover logic). Current snapshot: `core/html_assets.rs` 353, `core/comments.rs` 332, `core/types/mod.rs` 367, `core/types/wire.rs` 357, `core/types/tests.rs` 343, `core/sidecar/mod.rs` 209, `core/sidecar/io_guards.rs` 127, `core/sidecar/tests.rs` 234, `core/word_tokens.rs` 125, `core/fold_regions.rs` 303, `core/anchors/mod.rs` 336, `core/anchors/csv_cell.rs` 148, `core/anchors/html.rs` 158, `core/anchors/image_rect.rs` 42, `core/anchors/json_path.rs` 126, `core/anchors/word_range.rs` 70, `lib.rs` 288, `core/matching.rs` 284, `MarkdownViewer.tsx` 306, `MarkdownComponentsMap.tsx` 201, `MarkdownInteractionLayer.tsx` 80, `CommentableBlocks.tsx` 203, `HtmlPreviewView.tsx` 316, `lib/html-bridge.ts` 211, `lib/url-policy.ts` 77, `lib/html-image-rewrite.ts` 74, `commands/comments/mod.rs` 348, `commands/comments/get.rs` 217, `commands/comments/badges.rs` 251, `commands/comments/update.rs` 107, `commands/comments/export.rs` 43, `store/comments.ts` 188, `store/tabs.ts` ~230, `store/index.ts` 438, `lib/comment-drafts.ts` 36, `lib/anchor-fingerprint.ts` 42, `components/FindInPageBar.tsx` 96, `hooks/useFindInPage.ts` 188, `MarkdownComponentsMap.tsx` 201 (was 177), `markdown/CodeBlockHost.tsx` 57. Every file in the table is now under its budget.

### Native menu
24. Native OS menu events are forwarded as `menu-*` Tauri events handled in `src/hooks/useMenuListeners.ts`, not invoked as commands. (`lib.rs:193-212`; `useMenuListeners.ts:22-54`.)

### Sidecar writes
25. TypeScript code MUST NOT write `*.review.{yaml,json}` sidecar files directly. All sidecar mutations flow through Rust commands (`add_comment`, `add_reply`, `edit_comment`, `delete_comment`, `update_comment`) so the canonical `with_sidecar_or_create` / `mutate_sidecar_or_create` chokepoint owns atomic write, anchor preservation, and watcher notification. Enforced by meta-test `src/__tests__/no-ts-sidecar-writes.test.ts`.

### Platform-divergent commands
26. When an IPC command's behavior diverges by OS, the parent file at `src-tauri/src/commands/<feature>.rs` declares the public command + return type, then dispatches to a platform sub-module via `#[cfg(target_os = "X")] mod x; #[cfg(target_os = "X")] use x as imp;` and calls `imp::function(&app)`. The per-OS implementations live in `src-tauri/src/commands/<feature>/{macos,windows,unsupported}.rs`. Every feature MUST also ship an `unsupported.rs` so the build never fails on a new target — the canonical pattern is to return the `Unsupported` variant of the feature's status enum. Per-OS submodules are required when behavior diverges substantially; inline `cfg!(target_os = "x")` / `#[cfg(target_os = "x")]` branches are acceptable for argv-only differences (e.g. `commands/system.rs`, where `build_reveal_command` flips the binary + a single `/select,` vs `-R` arg between Windows/macOS/Linux). (`commands/cli_shim.rs:14-27`; `commands/default_handler.rs:16-29`; `commands/folder_context.rs:15-23`; inline form: `commands/system.rs`.)

### Atomic writes
27. Any Rust code that persists user data to disk MUST go through `core/atomic.rs::write_atomic` (temp-file + rename). A crash mid-write must never leave a half-written destination. Currently used by sidecar persistence and `core/onboarding.rs::save_at`.

### Layer separation / chokepoints
28. A single store boolean MUST NOT gate the mounting of two distinct UI surfaces. If two surfaces represent two presentations of the same intent, model the intent as a discriminated-union state (e.g. `settingsSurface: 'closed' | 'inline' | 'modal'`) so only one surface is renderable at any time. Enforced by the custom ESLint rule `local/no-shared-boolean-mount` (`eslint-rules/no-shared-boolean-mount.js`), which flags two sibling `{identifier && <Component/>}` JSX expressions referencing the same identifier under the same parent JSX element/fragment. Canonical application: `settingsSurface` in `src/store/index.ts` replaces the historical `settingsOpen` + `authorDialogOpen` boolean pair (issue #116).

## MRSF v1.0 / v1.1 sidecar schema

Comments persist as **Markdown Review Sidecar Format (MRSF) v1.0** — an open standard ([specification](https://sidemark.org/specification.html)) compatible with VS Code's Sidemark extension. v1.1 extends the schema with a tagged `Anchor` discriminator (image/csv/json/html/word_range anchors), an `anchor_history` FIFO(3) fallback chain, and per-comment `reactions`. Source of truth: `src-tauri/src/core/types/wire.rs` (serde repr + tagged discriminator) and `src-tauri/src/core/types/mod.rs` (in-memory `Anchor` enum). One sidecar per reviewed document:

- `<filename>.review.yaml` (primary)
- `<filename>.review.json` (legacy read-only fallback)

```yaml
mrsf_version: "1.0"
document: "filename.ext"
comments:
  - id: "uuid"                          # required
    author: "Display Name (id)"         # required, "Name (identifier)"
    timestamp: "2025-04-15T10:00:00Z"   # required, RFC 3339
    text: "Comment text"                # required
    resolved: false                     # required
    # Anchor (optional)
    line: 42                            # 1-based
    end_line: 45
    start_column: 10                    # 0-based
    end_column: 30
    selected_text: "code here"
    selected_text_hash: "sha256..."
    # Metadata (optional)
    type: "suggestion"                  # suggestion | issue | question | accuracy | style | clarity
    severity: "low"                     # low | medium | high
    reply_to: "parent-uuid"
    commit: "abc1234"
```

### v1.1 — tagged Anchor + history + reactions

v1.1 adds a tagged `anchor_kind` discriminator with a per-variant payload sibling (image_rect / csv_cell / json_path / html_range / html_element / word_range / file). Pure-line comments stay byte-identical to v1.0 (no `anchor_kind`, just the flat line fields) — the v1.1 markers (`anchor_history`, `reactions`, or any non-`Line` variant) are what triggers a `mrsf_version: "1.1"` write. A v1.1 comment has the FIFO-bounded `anchor_history` (cap 3) recording prior anchor positions for fallback after a refactor.

```yaml
mrsf_version: "1.1"
document: "fig.png"
comments:
  - id: "uuid"
    author: "alice"
    timestamp: "2025-04-15T10:00:00Z"
    text: "wrong axis label"
    resolved: false
    anchor_kind: "image_rect"
    image_rect: { x_pct: 12.5, y_pct: 60.0, w_pct: 18.0, h_pct: 8.0 }
    anchor_history:
      - anchor_kind: "image_rect"
        anchor_data: { x_pct: 10.0, y_pct: 50.0 }
    reactions:
      - { user: "bob", kind: "thumbs_up", ts: "2025-04-15T11:00:00Z" }
```

### Threading
Flat `reply_to` model — replies are top-level comments with `reply_to` referencing the parent's `id`. No nested `responses[]`.

### 4-step re-anchoring
Canonical implementation: `src-tauri/src/core/matching.rs:12`.

1. **Exact match** — find `selected_text` at the original line, then search the full document.
2. **Line fallback** — if the original line number is still in bounds, anchor there.
3. **Fuzzy match** — Levenshtein similarity ≥ 0.6, prefer closest to original line.
4. **Orphan** — all strategies failed; comment displays with an orphan banner.

```mermaid
flowchart TD
    Start(["comment.selected_text +<br/>original line"]) --> S1{"exact match at<br/>original line?"}
    S1 -- "yes" --> A1(["anchored — original line"])
    S1 -- "no" --> S1b{"exact match elsewhere<br/>in document?"}
    S1b -- "yes" --> A2(["anchored — closest match"])
    S1b -- "no" --> S2{"original line still<br/>in document bounds?"}
    S2 -- "yes" --> A3(["line fallback —<br/>anchored at same line"])
    S2 -- "no" --> S3{"Levenshtein<br/>similarity ≥ 0.6?"}
    S3 -- "yes" --> A4(["fuzzy match — nearest<br/>candidate to original line"])
    S3 -- "no" --> Orphan(["orphan banner —<br/>preserved, never lost"])
```

### Surviving AI refactoring
Layered defenses: (1) 4-step re-anchoring; (2) sidecars travel alongside source files; (3) ghost entries surface deleted-source sidecars; (4) the Rust watcher auto-reloads content and comments. Debounce/save-loop windows: rules 4-6 in [`docs/performance.md`](performance.md).

## Gaps

- No ESLint rule blocks direct `invoke()` imports outside `src/lib/tauri-commands.ts`.
- No ESLint rule blocks direct `@tauri-apps/plugin-log` imports outside `src/logger.ts`.
- No lint rule blocks `console.log/info` in production code.
- Dependency directionality (rule 17) not mechanically enforced; `dependency-cruiser` would codify it.
- TS types in `tauri-commands.ts` are hand-mirrors of `src-tauri/src/core/types.rs`; a codegen step (`ts-rs`, `specta`) would remove drift risk.
- File-size budgets (rule 23) not enforced by CI.
<!-- Reviewed 2026-04-24: all gaps still valid. Iter 2 added platform sub-module rule (26) + atomic-write rule (27); `commands.rs` god-file deleted in favor of `commands/` folder. -->