# Performance

Canonical for numeric budgets and hot-path rules. Cite violations as "violates rule N in `docs/performance.md`" or "exceeds budget X". Charter: [`docs/principles.md`](principles.md).

## Principles

Unique to performance. Rust-First is a charter meta-principle.

> Cross-cutting (project-agnostic) rules live in [`docs/best-practices-common/`](best-practices-common/) — see [`general/javascript-performance.md`](best-practices-common/general/javascript-performance.md), [`react/rerender-optimization.md`](best-practices-common/react/rerender-optimization.md), [`react/rendering-performance.md`](best-practices-common/react/rendering-performance.md), [`vite/bundle-hygiene.md`](best-practices-common/vite/bundle-hygiene.md). The numeric budgets and project-specific rules below override the generic guidance whenever they conflict.

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
| JS bundle (gzip) | < 3 MB starter / < 2 MB target | Yes | rule 32, `scripts/check-bundle-size.mjs` |
| Release binary (Windows) | < 12 MB | No (config shipped, size not yet measured in CI) | rule 31, `src-tauri/Cargo.toml` |

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
11. `SourceView` is virtualised via `@tanstack/react-virtual` — only the viewport-visible rows plus `SOURCE_OVERSCAN` mount in the DOM. A 50K-line file mounts ~75 rows instead of 50K. (`SourceView.tsx`, `useVirtualizer({...})` + `lib/viewer-budgets.ts`.)
12. `useSourceHighlighting` is **idle-chunked**: first paint is HTML-escaped plain text, then Shiki output fades in via `requestIdleCallback` (polyfilled in `src/lib/idle.ts` for WKWebView). Each chunk highlights `SOURCE_HIGHLIGHT_CHUNK_LINES` lines and yields back when `timeRemaining()` falls below `SOURCE_HIGHLIGHT_IDLE_BUDGET_MS`. The single-call `codeToHtml(deferredContent, …)` path is gone — for a 5 MB JS log it blocked the main thread for many seconds. (`hooks/useSourceHighlighting.ts`, `lib/viewer-budgets.ts`.)
12a. `MarkdownViewer` runs `<ReactMarkdown>` against `useDeferredValue(content)` so the heavy AST parse can yield to high-priority renders (find-bar input, scrolling). The cheap regex pre-scans (frontmatter, math, remote-image refs) and gutter-click line-text stay on raw `content` so banners and clicks react immediately. (`MarkdownViewer.tsx`.)
12b. `EnhancedViewer` clamps `.md`/`.mdx` files at/above `MARKDOWN_VISUAL_CAP_BYTES` (1 MB) to source-mode-only; the visual toggle is rendered with `disabled` + `aria-disabled` + a tooltip explaining why. The clamp is render-time so it auto-lifts when a file shrinks below the cap on next open. (`EnhancedViewer.tsx`, `lib/viewer-budgets.ts`.)
13. `useFileContent` renders "loading" only on initial mount or path change, not on same-file watcher reloads. (`useFileContent.ts:35`.) Additionally, when a same-path reload returns byte-identical content (matched on `content`, `sizeBytes`, `lineCount`), `useFileContent` short-circuits before publishing new state — no `setState`, no `setLastFileReloadedAt` bump, no Shiki re-highlight pass. `setFileMeta` is still always called so `StatusBar.fileMtime` reflects mtime advances on touch-only events. (`useFileContent.ts`.)
13a. `HexView` virtualizes rows when payload ≥ 32 KiB at 18-px row height; smaller files render in full. (`HexView.tsx` `VIRTUALIZE_THRESHOLD`, `ROW_HEIGHT`.)
13b. **Single canonical home for viewer perf budget constants** — `src/lib/viewer-budgets.ts` is the only module that defines `SIZE_WARN_THRESHOLD`, `MARKDOWN_VISUAL_CAP_BYTES`, `SOURCE_HIGHLIGHT_CHUNK_LINES`, `SOURCE_HIGHLIGHT_IDLE_BUDGET_MS`, `SOURCE_OVERSCAN`, `SOURCE_BASE_LINE_PX`. Inlining a numeric ceiling in a component file is a same-PR debt to extract here.

### Rust hot paths
14. Comment anchoring (`match_comments`) stays in Rust; no TypeScript re-implementation. (`core/matching.rs:12`, exposed via `get_file_comments`.)
15. Levenshtein uses O(min(m,n)) memory — never a full m×n matrix. (`matching.rs:184-217`.)
16. Fuzzy matching short-circuits identical/substring cases before computing Levenshtein. (`matching.rs:168-173`.)
17. Sidecar mutations go through `with_sidecar_mut` (load → mutate → save → emit) — never from the frontend. (`commands/comments.rs:13`.)
18. Batch counts for N files are a single IPC call (`get_file_badges`), not N calls. (`commands/comments/badges.rs:24`.)
19. Line counting is amortized inside `read_text_file`: `content.lines().count()` runs once per read (`commands/fs.rs:107`) and the result is returned in `TextFileResult.line_count`. Frontend consumers (StatusBar) read it from the `fileMetaByPath` cache populated by `useFileContent` — they never recompute line counts in TS.

### StatusBar timer
20. `StatusBar` uses a single `setInterval(60_000ms)` to refresh "N min ago" labels and clears it on `activeTabPath` change or unmount (`StatusBar.tsx` effect). No timer per item, no leak across tab switches.

### Watcher efficiency
21. The watcher thread owns its receiver exclusively via `.take()`; no double-start. (`watcher.rs:41-53`.)
22. The watcher coalesces sync signals by draining with `try_recv` before calling `sync_dirs`. (`watcher.rs:117-124`.)
23. `update_watched_files` uses `try_send(())` on its 1-slot channel so the frontend never blocks the watcher loop. (`watcher.rs:202`.)

### Directory listing
24. Directory listings sort once in Rust and return pre-sorted. (`commands/fs.rs:60-64`.)

### Render short-circuits
25. `setScrollTop` short-circuits when the value is unchanged. (`store/index.ts:162-167`.)
26. `setGhostEntries` diffs old vs new and skips `set` on equality. (`store/index.ts:186-193`.)

### Lazy-loaded heavy bundles
27. `MarkdownViewer` lazy-imports `rehype-katex` (~150 KB minified, the `katex` chunk reaches ~76 KB gzipped after split) only when `HAS_MATH_RE.test(body)` matches: it requires balanced `$…$` or `$$…$$` and rejects currency (`$5`), spaced delimiters (`$ x $`, `$ x$`), and trailing space. Documents without math never download the KaTeX bundle. The regex contract is locked by `src/components/viewers/__tests__/has-math-re.test.ts`. (`MarkdownViewer.tsx` `HAS_MATH_RE`, `useState`+`import("rehype-katex")` block.)
28. The KaTeX chunk is emitted as a separate file by Vite's code-splitter — confirmed by `dist/assets/katex-*.js` in the build output. Mermaid is lazy-loaded the same way via `MermaidView`.

### User expectations
29. `MarkdownViewer` and `SourceView` display a "large file" warning above `SIZE_WARN_THRESHOLD` so users expect slower rendering instead of assuming a hang. (`MarkdownViewer.tsx:321,371-375`; `SourceView.tsx:113,128-132`.)
30. `tokenize_words` rejects inputs > 65 536 bytes with a typed `Err`; callers in word-range anchor creation short-circuit. Silent truncation was rejected — typed failure allows the caller to surface a user-visible warning. (`commands/word_tokens.rs`.)

### Build-time perf gates
31. `[profile.release]` in `src-tauri/Cargo.toml` enables `lto = true`, `codegen-units = 1`, `strip = true`, `panic = "abort"` — minimizes binary size and maximizes runtime perf for shipped builds. The `panic = "abort"` choice is critical: it removes unwinding-table size from the binary AND ensures the panic hook in `src-tauri/src/lib.rs` flushes log buffers before the process terminates (`panic = "abort"` pairs with the panic hook in `src-tauri/src/lib.rs` — verification test deferred to iter 3 of PR for #262, see AC §3 line 3).
32. JS bundle-size CI gate (`scripts/check-bundle-size.mjs`) enforces ≤ 3 MB total gzipped size as a starter ceiling (current baseline ~2.77 MB); long-term target ≤ 2 MB once Shiki language lazy-loading lands (deferred to PR4 cold-startup work). Catches regressions where a heavy package is imported eagerly at startup (mitigates root cause of the rule 27 lazy-load pattern by failing CI before the regression ships). Wired in `.github/workflows/ci.yml` after `npm run build`.

## Gaps

- No cold-startup benchmark. Rules 1-3 cap what startup may do, but no test verifies end-to-end launch time.
- ~~`read_text_file` reads the file before checking size (`commands/fs.rs:85-94`). A `metadata().len()` pre-check would reject large files in O(1); bench on 50 MB first.~~ (closed by PR for #252 — `read_file_capped` in `commands/fs.rs` does fstat + bounded `Vec::with_capacity` + `take(MAX+1)` post-read length check.)
- ~~No `[profile.release]` in `Cargo.toml` — `lto`, `codegen-units = 1`, `strip = true` not configured.~~ (closed by PR for #262 — see rule 31)
- ~~No JS bundle-size budget enforced in CI.~~ (closed by PR for #262 — see rule 32)
- No benchmark for `read_dir` on a 1000-entry folder.
- Shiki language load is unmeasured for uncommon languages.
- ~~`MarkdownViewer` re-parses markdown on every `content` change, including watcher reloads (`MarkdownViewer.tsx:276,282`). For >1 MB files this blocks the main thread.~~ (closed by PR for #252 — rule 12a `useDeferredValue`, rule 12b 1 MB visual soft cap that opens large markdown in source-only mode.)
- No memory ceiling test. Per-tab and 100-file workspace memory are aspirational budgets.
- Watcher event volume is bounded by OS but not by the app. `rm -rf` on a 10K-file folder emits bursts; debouncer smooths at 300 ms but no upper forward-per-tick cap exists.
- `get_file_badges` loads one sidecar per file per call. For workspaces >500 files consider a Rust-side per-file cache invalidated on `comments-changed`; deferred (iter 4 perf budget: O(N) is acceptable for current target workspace sizes).
- JS bundle gzipped baseline (~2.85 MB after `@tanstack/react-virtual` add) exceeds 2 MB long-term target. Mitigation: Shiki language lazy-loading deferred to PR4 cold-startup work. Tracked under bundle-size CI gate (rule 32) which currently uses 3 MB starter ceiling.
