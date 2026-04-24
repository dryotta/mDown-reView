# Architecture — rules for mdownreview

**Status:** Canonical. Cite violations as "violates rule N in `docs/architecture.md`".
**Charter:** [`docs/principles.md`](principles.md)
**Last updated:** 2026-04-23

## Principles

1. **Rust-First.** Business logic (file I/O, MRSF parse/serialize, anchor matching, hash computation, threading, ghost-scan) lives in Rust and is exposed over typed Tauri IPC; React/TypeScript owns only rendering, user interaction, and UI state.
   **Pillars:** Architecturally Sound, Performant, Reliable.
   **Rationale:** Rust is faster, typed end-to-end, and robust to refactor. See `src-tauri/src/core/` (anchors, comments, matching, scanner, sidecar, threads, types) — the React layer never reimplements these.

2. **Single IPC Chokepoint.** Every `invoke()` call flows through `src/lib/tauri-commands.ts`, which owns wrapper signatures, argument shape, and TypeScript return types mirrored from Rust.
   **Pillars:** Architecturally Sound, Reliable.
   **Rationale:** One file is the entire app's IPC API surface — rename, retype, grep, or mock in one place.

3. **Single Logging Chokepoint.** All frontend logging flows through `src/logger.ts`; all backend logging uses `tracing` macros or `log::*`, both routed by `tauri-plugin-log` to one rotating file.
   **Pillars:** Reliable, Architecturally Sound.
   **Rationale:** One file, one rotation policy, one search target when debugging user-reported issues.

4. **State Stratification.** Domain state (comments) lives in sidecar files as MRSF v1.0; reactive UI state lives in Zustand; ephemeral view state (scroll, selection, folding) lives in component `useState`/`useRef`.
   **Pillars:** Reliable, Lean, Architecturally Sound.
   **Rationale:** Comments are never lost in a crash because the store never owns them. Persist middleware writes only UI state.

5. **Commands Mutate, Events Notify.** Tauri commands perform imperative actions (read, write, compute) and return typed results; Tauri events notify the frontend of asynchronous change (file-changed, comments-changed, args-received).
   **Pillars:** Reliable, Architecturally Sound.
   **Rationale:** Events can fire before the first `useEffect`, so deterministic bootstrap uses a command (`get_launch_args`), not an event.

6. **Layer Directionality.** Dependencies flow inward only: `components/` may use `hooks/`, `lib/`, `store/`; `hooks/` may use `lib/`, `store/`; `lib/` may use `store/` only at the VM seam (`src/lib/vm/`); `lib/` must not import `components/` or `hooks/`.
   **Pillars:** Architecturally Sound.
   **Rationale:** Keeps `lib/` mockable and testable in isolation.

## Rules

1. Every Tauri IPC call MUST go through a typed wrapper in `src/lib/tauri-commands.ts`; production code MUST NOT import `invoke` directly. **Evidence:** `src/lib/tauri-commands.ts:1` is the only non-test `invoke` importer.
2. Every new Rust command MUST ship with a matching typed wrapper in `tauri-commands.ts`, and the wrapper's return type MUST match the Rust `Result<T, String>` unwrapped `T`. **Evidence:** `src-tauri/src/commands.rs:107` `read_text_file(path) -> Result<String, String>` paired with `src/lib/tauri-commands.ts:44`.
3. Every Rust command MUST be registered in the shared handler macro in `src-tauri/src/lib.rs`. **Evidence:** `src-tauri/src/lib.rs:220-242` `shared_commands!` macro.
4. All frontend logging MUST go through `src/logger.ts`; no file outside `src/logger.ts` and its test may import from `@tauri-apps/plugin-log`. **Evidence:** grep returns only `src/logger.ts:7` and `src/__tests__/logger.test.ts:15`.
5. All frontend log lines MUST be tagged `[web]`; Rust log lines tag `[rust]` or a subsystem like `[watcher]`. **Evidence:** `src/logger.ts:9-13`; `src-tauri/src/watcher.rs:93`; `src-tauri/src/commands.rs:59`.
6. `console.log`/`console.info` MUST NOT appear in production frontend code; `console.warn`/`console.debug` are tolerated only as watcher-internal scaffolding and SHOULD migrate to the logger. **Evidence:** `src/hooks/useFileWatcher.ts:35,56,61`.
7. MRSF sidecar read/write, serde, and reparenting MUST live in Rust (`src-tauri/src/core/sidecar.rs`, `core/comments.rs`); TypeScript MUST NOT parse or serialize sidecars. **Evidence:** no YAML/JSON parsing of `.review.yaml` exists in `src/`.
8. Sidecar-mutating commands MUST emit `comments-changed` after save. **Evidence:** `src-tauri/src/commands.rs:44-49` `with_sidecar_mut` helper.
9. The 4-step re-anchoring algorithm MUST be a single Rust pipeline exposed via `get_file_comments`. **Evidence:** `src-tauri/src/commands.rs:244` `match_comments` + `:247` `group_into_threads`.
10. SHA-256 of `selected_text` MUST be computed in Rust via `compute_anchor_hash`. **Evidence:** `src-tauri/src/commands.rs:369`.
11. First-instance launch args MUST be retrieved via command (`get_launch_args`), not event. **Evidence:** `src/App.tsx:98`; `src-tauri/src/commands.rs:150`.
12. Second-instance launch args MUST be delivered via `args-received` event. **Evidence:** `src/App.tsx:102`; `src-tauri/src/lib.rs:100`.
13. The file watcher MUST live in Rust (`notify-debouncer-mini`, 300 ms) and emit `file-changed` events with kinds `content | review | deleted`. **Evidence:** `src-tauri/src/watcher.rs:58, 88-92`.
14. The frontend MUST NOT poll the filesystem; reactive reload uses watcher events routed through `useFileWatcher` → DOM `CustomEvent("mdownreview:file-changed")`. **Evidence:** `src/hooks/useFileWatcher.ts:51-73`.
15. Save-loop prevention MUST guard watcher reloads: frontend ignores `file-changed` events within 1500 ms of its own save. **Evidence:** `src/hooks/useFileWatcher.ts:7,56`.
16. Ghost-entry scanning MUST use a single Rust command capped at 10K results, not a recursive TS walk. **Evidence:** `src-tauri/src/commands.rs:167-169` delegating to `core::scanner::find_review_files(&root, 10_000)`.
17. Zustand `persist` MUST serialize only UI state (tabs, scroll, theme, pane width, root, expanded folders, recent items, auto-reveal, authorName); comments, ghost entries, and `lastSaveByPath` MUST NOT be persisted. **Evidence:** `src/store/index.ts:224-234` `partialize`.
18. Cross-slice state changes triggered by a single user action MUST be grouped in a single action in `src/store/index.ts`. **Evidence:** `src/store/index.ts:146-158` `closeTab`.
19. `lib/` modules MUST NOT import `components/` or `hooks/`; `lib/vm/` is the only place `lib/` may read `@/store`. **Evidence:** grep `from "@/components"` in `src/lib/` → 0; `from "@/hooks"` in `src/lib/` → 0; `from "@/store"` in `src/lib/` → only `src/lib/vm/use-comment-actions.ts:2`.
20. Every renderable subtree that can fail MUST be wrapped in `<ErrorBoundary>`, and the boundary MUST forward to the logger. **Evidence:** `src/App.tsx:278,306,315,325,335`; `src/components/ErrorBoundary.tsx:22`.
21. Global JS error handlers MUST be installed in `src/main.tsx` before `ReactDOM.createRoot`. **Evidence:** `src/main.tsx:8,13` → `:21`.
22. Rust panics MUST be captured via a panic hook installed in the Tauri `setup` closure. **Evidence:** `src-tauri/src/lib.rs:109-123`.
23. `read_text_file` MUST reject files >10 MB and detect binary by scanning the first 512 bytes for null bytes. **Evidence:** `src-tauri/src/commands.rs:114-123`.
24. `read_dir` MUST filter out sidecar files (`.review.yaml`, `.review.json`) before returning. **Evidence:** `src-tauri/src/commands.rs:86-88`.
25. Viewer components MUST route through `ViewerRouter` based on `FileStatus` returned by `useFileContent`, not by sniffing content themselves. **Evidence:** `src/components/viewers/ViewerRouter.tsx:93-131`.
26. Components MUST subscribe to the store with narrow selectors (`useStore((s) => s.field)` or `useShallow({...})`), never with unfiltered `useStore()`. **Evidence:** `src/App.tsx:54-62`; `src/components/TabBar/TabBar.tsx:8-10`.
27. Comment mutation UI MUST use `useCommentActions` from `src/lib/vm/use-comment-actions.ts`; components MUST NOT call `addComment`/`editComment`/etc. wrappers directly. **Evidence:** `src/components/comments/CommentThread.tsx:30,113`; `src/components/viewers/SourceView.tsx:37`.
28. Comment rendering MUST read through `useComments` (`src/lib/vm/use-comments.ts`); components MUST NOT call `getFileComments` directly. **Evidence:** grep `getFileComments` → only the wrapper and the VM hook.
29. Any file >400 lines in `src/components/` or `src-tauri/src/` is a structural smell and MUST be split; budget for shared-chokepoint files (`src/store/index.ts`, `src/App.tsx`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`) is 500 lines. **Evidence:** current largest in budget: `MarkdownViewer.tsx` 424, `commands.rs` 393.
30. Native OS menu events MUST be forwarded to the frontend as `menu-*` Tauri events handled in `src/App.tsx`, not invoked as commands. **Evidence:** `src-tauri/src/lib.rs:191-210`; `src/App.tsx:220-245`.

## Gaps (unenforced, backlog)

- **No ESLint rule forbids direct `invoke()` imports outside `src/lib/tauri-commands.ts`.** Today grep-clean but not mechanical. Needed for *Architecturally Sound*.
- **No ESLint rule forbids direct `@tauri-apps/plugin-log` imports outside `src/logger.ts`.** Same risk. Needed for *Reliable*.
- **No lint rule forbids `console.log/info/debug` in `src/` production code.** `useFileWatcher.ts` uses direct `console.warn`/`console.debug`. Needed for *Reliable*.
- **Dependency directionality is not mechanically enforced** (`dependency-cruiser` or equivalent would codify principle 6). Needed for *Architecturally Sound*.
- **TS types in `src/lib/tauri-commands.ts` are hand-mirrors of `src-tauri/src/core/types.rs`.** A `ts-rs` or `specta` codegen step would remove drift risk. Needed for *Reliable*.
- **File-size budgets (rule 29) are not enforced by CI.** A pre-commit `wc -l` whitelist check would make the budget real. Needed for *Lean*.
- **No written rule yet forbids the UI from writing sidecars directly.** True today (`save_review_comments` removed), worth codifying. Needed for *Reliable*.
- **`useFileWatcher.ts` bypasses `logger`** with raw `console.*` calls; migrate or document as dev-only. Needed for *Reliable*.
- **CLI launch-args event name** is `args-received` without a protocol prefix — a written rule eliminates doubt for future Tauri versions. Needed for *Reliable*.
