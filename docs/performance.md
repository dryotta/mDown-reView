# Performance — rules for mdownreview

**Status:** Canonical. Cite violations as "violates rule N in `docs/performance.md`".
**Charter:** [`docs/principles.md`](principles.md)
**Last updated:** 2026-04-23

## Principles

1. **Rust-first for repeated work over text.** Any scan, hash, or match that runs per file or per line lives in Rust and crosses IPC once.
   **Pillars:** Performant, Lean, Architecturally Sound.
   **Rationale:** Rust runs off the WebView main thread, avoids React re-renders, and has Criterion benches to keep us honest (`src-tauri/benches/hot_path_bench.rs`, `matching_bench.rs`). The hot path (`get_file_comments`) fuses `load_sidecar` → `match_comments` → `group_into_threads` into one IPC call.

2. **Hard cap every unbounded input.** No loop or scan over user-supplied data is permitted without a numeric ceiling or an early-exit guard.
   **Pillars:** Performant, Reliable, Lean.
   **Rationale:** Files capped at 10 MB (`commands.rs:114,139`), `scan_review_files` at 10K entries (`commands.rs:168`), `walkdir` at depth 50 (`scanner.rs:12`). Every new scan states its cap in code, not in commentary.

3. **One IPC round-trip per user action.** The frontend never chains two `invoke` calls where a single Rust command could return the aggregate.
   **Pillars:** Performant, Architecturally Sound.
   **Rationale:** `get_file_comments` and `get_unresolved_counts` exist precisely to avoid N+1 IPC.

4. **Debounce noisy producers, never consumers.** Watcher events, scans, and save loops are collapsed at the source with a documented window.
   **Pillars:** Performant, Reliable.
   **Rationale:** 300 ms watcher debouncer (`watcher.rs:58`), 1500 ms save-loop guard (`useFileWatcher.ts:7`), 500 ms ghost re-scan (`useFileWatcher.ts:8`). Consumers render synchronously from post-debounce state.

5. **Shared singletons for heavyweight init.** Expensive initializers (Shiki highlighter, Tauri listeners) exist once per process.
   **Pillars:** Performant, Lean.
   **Rationale:** `getSharedHighlighter` (`src/lib/shiki.ts:10`) is the only highlighter; both `MarkdownViewer` and `SourceView` call it. Two instances would cost ~2-4 MB per instance.

6. **Module-scope component tables.** `react-markdown` `components` prop is not rebuilt inside render.
   **Pillars:** Performant, Architecturally Sound.
   **Rationale:** `MD_COMPONENTS` at module scope (`MarkdownViewer.tsx:140`) prevents React error #185 under concurrent rendering. Only the `img` resolver merges per render via `useMemo`.

## Budgets

| Metric | Budget | Measured today? | Evidence / required bench |
|---|---|---|---|
| Cold startup to first paint | < 800 ms (release) | No | Add Playwright native bench on `window-ready` |
| First file open (≤ 100 KB, cached Shiki) | < 150 ms p95 | No | — |
| First file open (≤ 1 MB md) | < 400 ms p95 | No | — |
| `read_text_file` 10 MB reject | < 50 ms (size pre-check) | Partial | `commands.rs:109` reads before size-check |
| `get_file_comments` — 200 comments × 5000 lines | < 20 ms | Yes | `hot_path_bench.rs:64` `get_file_comments_large` |
| `match_comments` — 50 comments × 1000 lines | < 5 ms | Yes | `matching_bench.rs:76` |
| `scan_review_files` — 10K sidecars | < 500 ms | Yes | `scanner_bench.rs` |
| Watcher event → `file-changed` emit | ≤ 300 ms + 200 ms | Yes (code) | `watcher.rs:58, 70` |
| Save-loop suppression window | 1500 ms | Yes (code) | `useFileWatcher.ts:7` |
| Ghost re-scan debounce | 500 ms | Yes (code) | `useFileWatcher.ts:8` |
| Folder tree `read_dir` — 1000 entries | < 100 ms | No | Add Criterion bench |
| Open-tab steady-state memory | < 15 MB per tab | No | Add native e2e memory assertion |
| 100-file folder memory footprint | < 250 MB RSS | No | Add native e2e memory assertion |
| JS bundle (gzip) | < 2 MB | No | Add CI `vite build` size check |
| Release binary (Windows) | < 12 MB | No | No `[profile.release]` in `Cargo.toml` |

## Rules

1. Every Rust command that reads a file MUST reject inputs above 10 MB before returning their contents. **Evidence:** `commands.rs:114` `const MAX_SIZE: usize = 10 * 1024 * 1024`.
2. Binary detection MUST scan at most the first 512 bytes, never the whole file. **Evidence:** `commands.rs:120` `let scan_len = bytes.len().min(512)`.
3. `scan_review_files` MUST cap returned results at 10K entries and cap `walkdir` depth at 50. **Evidence:** `commands.rs:168`; `scanner.rs:12` `.max_depth(50)`.
4. The file-watcher debounce window is 300 ms and MUST NOT be reduced below 200 ms or raised above 500 ms without a Criterion bench. **Evidence:** `watcher.rs:58`.
5. The save-loop suppression window is 1500 ms; the frontend MUST ignore `file-changed` events within that window after a local save. **Evidence:** `useFileWatcher.ts:7,56`.
6. Ghost re-scans after a deletion MUST be debounced by at least 500 ms to coalesce bulk deletes. **Evidence:** `useFileWatcher.ts:8,25`.
7. The Shiki highlighter MUST be a single process-wide singleton created lazily. **Evidence:** `src/lib/shiki.ts:3`.
8. Shiki MUST pre-load only `github-light` and `github-dark` themes with zero langs; languages load on demand. **Evidence:** `src/lib/shiki.ts:12-15`.
9. `react-markdown` `components` tables that do not depend on component props MUST be declared at module scope. **Evidence:** `MarkdownViewer.tsx:140`.
10. Per-render `components` merges are limited to entries that close over component-specific values (currently only `img`). **Evidence:** `MarkdownViewer.tsx:299-312`.
11. `SourceView` MUST run Shiki once per file/theme change, not once per line. **Evidence:** `useSourceHighlighting.ts:54`.
12. `useSourceHighlighting` MUST use `useDeferredValue` so highlighting cannot block typing/scrolling. **Evidence:** `useSourceHighlighting.ts:28`.
13. `useFileContent` MUST render "loading" only on initial mount or path change, not on same-file watcher reloads. **Evidence:** `useFileContent.ts:35`.
14. `useFileContent` MUST cancel stale `readTextFile` promises via a `cancelled` flag. **Evidence:** `useFileContent.ts:44-57`.
15. `useComments` MUST cancel stale `getFileComments` responses when `filePath` changes. **Evidence:** `use-comments.ts:46-63`.
16. Comment anchoring (`match_comments`) MUST stay in Rust; no TypeScript re-implementation is permitted. **Evidence:** `src-tauri/src/core/matching.rs:12` exposed via `get_file_comments`.
17. Levenshtein MUST use O(min(m,n)) memory — never allocate a full m×n matrix. **Evidence:** `matching.rs:184-217`.
18. Fuzzy matching MUST short-circuit identical/substring cases before computing Levenshtein. **Evidence:** `matching.rs:168-173`.
19. Sidecar mutation commands MUST load → mutate → save → emit in a single helper, never from the frontend. **Evidence:** `commands.rs:33` `with_sidecar_mut`.
20. Batch counts (unresolved comments for N files) MUST be a single IPC call, not N calls. **Evidence:** `commands.rs:376` `get_unresolved_counts`.
21. The watcher thread MUST own its receiver exclusively via `.take()`; no double-start. **Evidence:** `watcher.rs:41-53`.
22. The watcher MUST coalesce sync signals by draining with `try_recv` before calling `sync_dirs`. **Evidence:** `watcher.rs:117-124`.
23. `update_watched_files` MUST use `try_send(())` on its 1-slot channel so the frontend call never blocks on the watcher loop. **Evidence:** `watcher.rs:202`.
24. Directory listings MUST be sorted once in Rust and returned pre-sorted. **Evidence:** `commands.rs:97-102`.
25. Sidecar files MUST be filtered in `read_dir` before returning to the frontend. **Evidence:** `commands.rs:86-88`.
26. All Tauri invokes MUST go through `src/lib/tauri-commands.ts`; components and hooks MUST NOT call `invoke` directly. **Evidence:** `tauri-commands.ts` wrapper pattern; AGENTS.md §Architecture.
27. Persisted Zustand state is limited to UI state; comment bodies MUST NEVER be persisted. **Evidence:** `store/index.ts:224-235` `partialize`.
28. `setScrollTop` MUST short-circuit when the value is unchanged to avoid re-render storms on scroll. **Evidence:** `store/index.ts:162-167`.
29. `setGhostEntries` MUST diff old vs new and skip `set` on equality to prevent sidebar re-renders. **Evidence:** `store/index.ts:186-193`.
30. `MarkdownViewer` and `SourceView` MUST display a "large file" warning above `SIZE_WARN_THRESHOLD` so users expect slower rendering instead of assuming a hang. **Evidence:** `MarkdownViewer.tsx:321,371-375`; `SourceView.tsx:113,128-132`.

## Gaps (unenforced, backlog)

- **No cold-startup benchmark.** Rules 1-3 cap the work startup may do, but no test verifies end-to-end launch time. Add a Playwright native e2e timing the window-ready event.
- **`read_text_file` reads the file before checking size** (`commands.rs:109-115`). A `metadata().len()` pre-check would reject large files in O(1). Bench on a 50 MB file before changing.
- **No `[profile.release]` in `Cargo.toml`** — `lto`, `codegen-units = 1`, `strip = true` not configured; binary size and runtime are default-profile.
- **No JS bundle-size budget enforced in CI.** Budgets exist only as targets. Add a `vite build` + size assertion step.
- **No benchmark for `read_dir` on a 1000-entry folder.** Rule 24 guarantees a sort, not a ceiling.
- **Shiki language load is unmeasured** for uncommon languages.
- **`MarkdownViewer` re-parses markdown on every `content` change**, including watcher reloads (`MarkdownViewer.tsx:276,282`). For > 1 MB files this blocks the main thread; no bench quantifies the cost.
- **No memory ceiling test.** Per-tab and 100-file workspace memory are aspirational budgets.
- **Watcher event volume is bounded by OS but not by the app.** `rm -rf` on a 10K-file folder emits bursts; debouncer smooths at 300 ms but no upper forward-per-tick cap exists.
- **`get_unresolved_counts` is linear in N × sidecar-read I/O.** 10K sidecars would stall the folder tree; no bench exists. Consider caching per-file counts invalidated on `comments-changed`.
