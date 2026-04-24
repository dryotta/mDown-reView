# Performance

Canonical for numeric budgets and hot-path rules. Cite violations as "violates rule N in `docs/performance.md`" or "exceeds budget X". Charter: [`docs/principles.md`](principles.md).

## Principles

Unique to performance. Rust-First is a charter meta-principle.

1. **Hard cap every unbounded input.** No loop or scan over user-supplied data without a numeric ceiling or early-exit guard.
2. **One IPC round-trip per user action.** Never chain two `invoke` calls where a single Rust command could return the aggregate.
3. **Debounce producers, not consumers.** Collapse watcher events, scans, and save loops at the source with a documented window; consumers render synchronously from post-debounce state.
4. **Shared singletons for heavyweight init.** Expensive initializers (Shiki, Tauri listeners) exist once per process.
5. **Module-scope component tables.** `react-markdown`'s `components` prop is never rebuilt inside render — prevents React error #185 in concurrent mode and avoids full re-parse.

## Budgets

| Metric | Budget | Measured? | Evidence / bench needed |
|---|---|---|---|
| Cold startup to first paint | < 800 ms (release) | No | Add Playwright native bench on `window-ready` |
| First file open (≤ 100 KB, cached Shiki) | < 150 ms p95 | No | — |
| First file open (≤ 1 MB md) | < 400 ms p95 | No | — |
| `get_file_comments` — 200 comments × 5000 lines | < 20 ms | Yes | `hot_path_bench.rs:64` |
| `match_comments` — 50 comments × 1000 lines | < 5 ms | Yes | `matching_bench.rs:76` |
| `scan_review_files` — 10K sidecars | < 500 ms | Yes | `scanner_bench.rs` |
| `compute_fold_regions` — 100 KB content | < 5 ms (measured ~1.0 ms) | Yes | `parsers_bench.rs:bench_fold_regions` |
| `parse_kql_pipeline` — 50-step pipeline | < 1 ms (measured ~24 µs) | Yes | `parsers_bench.rs:bench_parse_kql` |
| `strip_json_comments` — 100 KB JSONC | < 3 ms (measured ~0.23 ms) | Yes | `parsers_bench.rs:bench_strip_json_comments` |
| Watcher event → `file-changed` emit | ≤ 300 ms + 200 ms | Yes (code) | `watcher.rs:58,70` |
| Save-loop suppression window | 1500 ms | Yes (code) | `useFileWatcher.ts:7` |
| Ghost re-scan debounce | 500 ms | Yes (code) | `useFileWatcher.ts:8` |
| Folder tree `read_dir` — 1000 entries | < 100 ms | No | Add Criterion bench |
| Open-tab steady-state memory | < 15 MB per tab | No | Add native e2e memory assertion |
| 100-file folder memory footprint | < 250 MB RSS | No | Add native e2e memory assertion |
| JS bundle (gzip) | < 2 MB | No | Add CI `vite build` size check |
| Release binary (Windows) | < 12 MB | No | No `[profile.release]` in `Cargo.toml` |

## Rules

### Hard caps
1. File reads reject inputs above 10 MB. Threat-model canonical: rule 1 in [`docs/security.md`](security.md).
2. Binary detection scans ≤ 512 bytes. Canonical: rule 2 in [`docs/security.md`](security.md).
3. `scan_review_files` caps results at 10,000 entries and `walkdir` depth at 50. (`commands/launch.rs:26`; `scanner.rs:12`.)

### Debounce windows
4. File-watcher debounce is 300 ms; adjusting below 200 ms or above 500 ms requires a Criterion bench. (`watcher.rs:58`.)
5. Save-loop suppression is 1500 ms; the frontend ignores `file-changed` within that window after a local save. (`useFileWatcher.ts:7,56`.)
6. Ghost re-scans debounce at ≥ 500 ms to coalesce bulk deletes. (`useFileWatcher.ts:8,25`.)

### Shared singletons
7. The Shiki highlighter is a single process-wide singleton created lazily. (`src/lib/shiki.ts:3`.)
8. Shiki pre-loads only `github-light` and `github-dark` themes with zero langs; languages load on demand. (`src/lib/shiki.ts:12-15`.)

### Render cost
9. `react-markdown` `components` tables that don't close over props are declared at module scope. (`MarkdownViewer.tsx:140` `MD_COMPONENTS` — also prevents React error #185 in concurrent mode.)
10. Per-render `components` merges are limited to entries that close over component-specific values (currently only `img`). (`MarkdownViewer.tsx:299-312`.)
11. `SourceView` runs Shiki once per file/theme change, not per line. (`useSourceHighlighting.ts:54`.)
12. `useSourceHighlighting` uses `useDeferredValue` so highlighting never blocks typing or scrolling. (`useSourceHighlighting.ts:28`.)
13. `useFileContent` renders "loading" only on initial mount or path change, not on same-file watcher reloads. (`useFileContent.ts:35`.)

### Rust hot paths
14. Comment anchoring (`match_comments`) stays in Rust; no TypeScript re-implementation. (`core/matching.rs:12`, exposed via `get_file_comments`.)
15. Levenshtein uses O(min(m,n)) memory — never a full m×n matrix. (`matching.rs:184-217`.)
16. Fuzzy matching short-circuits identical/substring cases before computing Levenshtein. (`matching.rs:168-173`.)
17. Sidecar mutations go through `with_sidecar_mut` (load → mutate → save → emit) — never from the frontend. (`commands/comments.rs:13`.)
18. Batch counts for N files are a single IPC call (`get_unresolved_counts`), not N calls. (`commands/comments.rs:215`.)

### Watcher efficiency
19. The watcher thread owns its receiver exclusively via `.take()`; no double-start. (`watcher.rs:41-53`.)
20. The watcher coalesces sync signals by draining with `try_recv` before calling `sync_dirs`. (`watcher.rs:117-124`.)
21. `update_watched_files` uses `try_send(())` on its 1-slot channel so the frontend never blocks the watcher loop. (`watcher.rs:202`.)

### Directory listing
22. Directory listings sort once in Rust and return pre-sorted. (`commands/fs.rs:60-64`.)

### Render short-circuits
23. `setScrollTop` short-circuits when the value is unchanged. (`store/index.ts:162-167`.)
24. `setGhostEntries` diffs old vs new and skips `set` on equality. (`store/index.ts:186-193`.)

### User expectations
25. `MarkdownViewer` and `SourceView` display a "large file" warning above `SIZE_WARN_THRESHOLD` so users expect slower rendering instead of assuming a hang. (`MarkdownViewer.tsx:321,371-375`; `SourceView.tsx:113,128-132`.)

## Gaps

- No cold-startup benchmark. Rules 1-3 cap what startup may do, but no test verifies end-to-end launch time.
- `read_text_file` reads the file before checking size (`commands/fs.rs:70-80`). A `metadata().len()` pre-check would reject large files in O(1); bench on 50 MB first.
- No `[profile.release]` in `Cargo.toml` — `lto`, `codegen-units = 1`, `strip = true` not configured.
- No JS bundle-size budget enforced in CI.
- No benchmark for `read_dir` on a 1000-entry folder.
- Shiki language load is unmeasured for uncommon languages.
- `MarkdownViewer` re-parses markdown on every `content` change, including watcher reloads (`MarkdownViewer.tsx:276,282`). For >1 MB files this blocks the main thread.
- No memory ceiling test. Per-tab and 100-file workspace memory are aspirational budgets.
- Watcher event volume is bounded by OS but not by the app. `rm -rf` on a 10K-file folder emits bursts; debouncer smooths at 300 ms but no upper forward-per-tick cap exists.
- `get_unresolved_counts` is linear in N × sidecar-read I/O. 10K sidecars would stall the folder tree; consider caching per-file counts invalidated on `comments-changed`.
