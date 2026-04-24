---
goal: "Complete architecture refactoring: move model/viewmodel to Rust, clean up web layer code, eliminate duplicate/dead code, complete test coverage across native and web layers. Best possible client architecture and implementation."
started_at: 2026-04-23T22:48:00-07:00
branch: auto-improve/arch-refactor-mvvm-rust-20260423
pr: https://github.com/dryotta/mdownreview/pull/51
max_iterations: 50
---
# Iteration Log

## Iteration 1 — PASSED
- Commits: 8c92dff, 4359858, d663050
- CI: passed (Test Linux, Build macOS-arm64, Build windows-x64)
- Local tests: all 5 suites passed (lint, tsc, cargo 107, vitest 586, e2e 40)
- Expert review: 6/6 — initial round had 4 blocks (search byte/char bug, FOUC, double IPC, missing .catch), all resolved in fix commit
- Goal assessor confidence: 62%
- Fix attempts: 2
- Summary: Moved search to Rust (char-based indexing), added 50+ tests (updateSlice, uiSlice, watcherSlice, tabPersistence, save-loop), migrated console→logger in useFileWatcher, added .catch() to listen cleanups, removed 3 design-patterns.md gaps, cleaned up dead code. Reverted parseFrontmatter and commentCountByLine to sync TS after expert review (FOUC/double-IPC regressions).

## Iteration 2 — PASSED
- Commits: 57a9ecd, 956238c
- CI: passed (Test Linux, Build macOS-arm64, Build windows-x64)
- Local tests: all 5 suites passed (lint, tsc, cargo 107, vitest 607, e2e 40)
- Expert review: 6/6 approved unanimously, no blocks
- Goal assessor confidence: 35%
- Fix attempts: 1 (lint: unused rerender, stale eslint-disable, set-state-in-effect)
- Summary: Extracted IPC from 6 components into hooks/VM (useFolderChildren, useImageData, useRecentItemStatus, useAboutInfo, useUpdateActions). Moved computeAnchorHash auto-computation into useCommentActions. Moved test-only Rust anchor functions behind #[cfg(test)]. Fixed persistence test drift (updateChannel). Closed 5 test-strategy.md gaps. Net: +647/-190 lines, 25 files.