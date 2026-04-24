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

## Iteration 3 — PASSED
- Commits: 4040bd4
- CI: passed (Test Linux, Build macOS-arm64, Build windows-x64)
- Local tests: all 5 suites passed (lint, tsc, cargo 110, vitest 619, e2e 40)
- Expert review: 4/4 approved unanimously (architect, performance, react-tauri, rubber-duck), no blocks
- Goal assessor confidence: 78%
- Fix attempts: 0
- Summary: Consolidated checkUpdate logic from App.tsx and AboutDialog.tsx into useUpdateActions VM hook (checkForUpdate). Extracted listen("update-progress") into useUpdateProgress hook. UpdateBanner reduced to pure view. Removed orphaned-reply doc gap (covered), updated Zustand coverage status, fixed stale architecture.md gap. Added SkeletonLoader tests. Net: +215/-92 lines, 9 files.
## Iteration 4 - PASSED
- Commits: 040be9b, e6e0a04
- ITER_BASE_SHA: b76ac7e
- CI: pending (in progress at commit e6e0a04)
- Local tests: all 5 suites passed (lint, tsc, cargo, vitest 671, e2e 40)
- Expert review: 4/4 approved (architect, react-tauri, security with 1 conditional fix, test-gap). Security finding 1 (openExternalUrl scheme validation) addressed.
- Goal assessor: 6 groups identified, 3 implemented (Group B plugin IPC, Group A App.tsx hooks, Group D+F FolderTree+JsonTreeView). Skipped: Group C (truncateSelectedText kept as defense-in-depth), Group E (MarkdownViewer at 392 lines, within budget).
- Fix attempts: 1 (post-expert-review: openExternalUrl URL scheme guard, plugin wrapper unit tests, MarkdownViewer test mock alignment)
- Summary: Routed 4 plugin imports (clipboard, opener, dialog, process) through tauri-commands.ts chokepoint with URL scheme validation for openExternalUrl. Extracted App.tsx menu/dialog logic into useDialogActions + useMenuListeners hooks (App.tsx down to 239 lines). Extracted FolderTree tree-building into useFolderTree hook + buildFolderTree pure function. Extracted stripJsonComments to src/lib/json-utils.ts. Added 52 new tests (38 from extractions + 14 plugin wrapper tests). Net: +863/-236 lines, 21 files.
