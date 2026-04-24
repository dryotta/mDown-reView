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

## Iteration 5 - PASSED
- Commits: b0b1384, 6b6309f
- ITER_BASE_SHA: a2ff4b6
- CI: pending (in progress at commit 6b6309f)
- Local tests: all 5 suites passed (lint, tsc, cargo 147, vitest 660, e2e 40)
- Expert review: 4/4 - architect APPROVED, react-tauri APPROVED, perf APPROVED with 3 follow-ups, test-gap BLOCKED on rule 3 (resolved by regression tests).
- Goal assessor confidence: 75% pre-iteration; architect estimates 85% post.
- Fix attempts: 1 (post-expert: useFolding signature simplification, 4 null-IPC regression tests)
- Summary: Group A trimmed view layer (MarkdownViewer 430->268, App.tsx 266->182). Group C ported fold-regions/kql-parser/json-utils to Rust core (35 new cargo tests, 3 TS files+tests deleted). Group D deduplicated vm/use-comments load logic, extracted useLaunchArgsBootstrap and useGlobalShortcuts hooks. Added convertAssetUrl chokepoint - last direct @tauri-apps/api/core import eliminated. Net: +1638/-911, 33 files. Skipped Group B (event chokepoint) and E (docs) for next iteration.
- Expert review: 4/4 approved (architect 85% confidence, react-tauri APPROVED, performance APPROVED with follow-ups, test-gap BLOCKED then resolved with regression tests).
- Goal assessor confidence: 78%. 5 groups identified, A/C/D implemented (Group A markdown comment block extraction, Group C 3 parsers ported to Rust, Group D vm/use-comments dedup + 2 hook extractions). Skipped: Group B (vm/use-update-actions deferred), Group E (HtmlPreviewView remained  picked up in iter 6).
- Fix attempts: 1 (post-validation: useFolding signature fix per perf review, +4 null-IPC regression tests for useFolding/useSearch per test-gap block).
- Summary: Extracted MdComment* (4 exports, 138 lines) into markdown/CommentableBlocks.tsx; MarkdownViewer 430->268 lines. Ported fold-regions, kql-parser, json-utils from TS to Rust core (+35 cargo tests, deleted 3 TS lib files + tests). Deduplicated vm/use-comments load logic with isCancelled predicate (rule 7). Extracted useLaunchArgsBootstrap + useGlobalShortcuts hooks; App.tsx 266->182 lines. Added convertAssetUrl wrapper in tauri-commands.ts (last direct core import in MarkdownViewer eliminated).

## Iteration 6 - PASSED
- Commits: 8079a30, 368d5b2
- ITER_BASE_SHA: a8ecc16
- CI: pending (in progress at commit 368d5b2)
- Local tests: all 5 suites passed (lint, tsc, cargo 164=121+30+13, vitest 681, e2e 40)
- Expert review: 4/4 APPROVED (architect, react-tauri with 1 minor non-blocking fix applied, performance APPROVED, test-gap APPROVED with non-blocking advisories).
- Goal assessor confidence: 78%. 6 groups identified, 4 implemented (A event chokepoint, C test gaps + extractions, D criterion benches, E HTML assets to Rust). Group B (stale doc citations) and Group F (test-isolation hardening) deferred to next iteration.
- Fix attempts: 1 (post-review: HtmlPreviewView setResolving(false) when filePath becomes undefined, per react-tauri-expert).
- Summary: Created src/lib/tauri-events.ts as typed event chokepoint (mirrors tauri-commands.ts); 6 hooks/VMs migrated to listenEvent; meta-test enforces single-source rule. Ported resolve-html-assets.ts (112 lines, TS) to src-tauri/src/core/html_assets.rs + Tauri command (+17 cargo tests, eliminated N+1 IPC roundtrips per asset). Extracted parseFrontmatter + formatStepsForDisplay into testable lib/ modules. Added 14 CommentableBlocks unit tests. Added Criterion benches for the 3 new parsers (parsers_bench.rs) with budgets in docs/performance.md.

## Iteration 7 - PASSED
- Commits: 7304131, b8bea40
- ITER_BASE_SHA: 541e0f3
- CI: pending (in progress at commit b8bea40)
- Local tests: all 5 suites passed (lint, tsc, cargo 174=125+34+13+2 fuzzy moved, vitest 725, e2e 40)
- Expert review: 4/4 (architect APPROVED, react-tauri APPROVED, performance APPROVED, test-gap BLOCKED then resolved with +18 tests).
- Goal assessor confidence: 85%. 5 groups identified, 4 implemented (A Rust debt: emit_to('main')+matching split+with_sidecar_or_create, B doc citations refresh + meta-test, C test hygiene + iter6 follow-ups, D SourceLine + useApplyTheme extractions). Group E (MarkdownViewer audit) deferred.
- Fix attempts: 1 (post-review: 18 new tests for SourceLine branches, doc-citation helpers + drift self-test, mutate_sidecar_or_create error path).
- Summary: Window-scoped update emits (rule 4). Split core/matching.rs 415->284 by extracting fuzzy.rs. Refactored add_comment to share with_sidecar_or_create + mutate_sidecar_or_create helpers (pure inner fn unit-testable without AppHandle). Refreshed 12 stale citations in docs/architecture.md + new doc-citations meta-test. Centralized vi.mock('@tauri-apps/api/core') (removed duplicate, replaced 2 inline factories with bare auto-mocks) + new ipc-mock-hygiene meta-test. Added tauri-events rejection-path test, html_assets edge tests, event-chokepoint negative self-test. Extracted SourceLine.tsx (SourceView 245->212) and useApplyTheme.ts (App.tsx 206->191).


## Iteration 8 - PASSED
- Commits: 75369e5, 57b0ea2
- ITER_BASE_SHA: 9d52c60
- CI: pending (in progress at commit 57b0ea2)
- Local tests: all 5 suites passed (lint, tsc, cargo 174, vitest 757, e2e 40)
- Expert review: 4/4 APPROVED unanimously (architect, react-tauri, performance, test-gap; test-gap noted 3 non-blocking gaps which were addressed in 57b0ea2).
- Goal assessor confidence: 87%. 7 groups identified, 4 implemented in parallel (A path->language consolidation; B+C SourceLine React.memo + useSourceLineModel pure VM hook; D+E useThreadsByLine extension + useImgResolver hook; F doc-citations CITATION_RE positive self-tests).
- Fix attempts: 1 (post-review: 4 tests for re-anchored reply count, Windows img absolute paths, Shiki+search invariant).
- Summary: Group A consolidated path->language detection in src/lib/file-types.ts (getShikiLanguage + getFoldLanguage), removing duplicates from useSourceHighlighting and useFolding. Group B+C extracted pure VM hook src/hooks/useSourceLineModel.ts (129 lines) with module-scope EMPTY_THREADS sentinel; SourceView.tsx 212->194 (IIFE removed, useCallback'd handlers handleCommentButtonClick/handleCloseInput/handleRequestInput); SourceLine wrapped in React.memo with regression test enforcing O(changed) re-renders. Group D+E extended useThreadsByLine to return {threadsByLine, commentCountByLine} (single useMemo); created useImgResolver.tsx (stable img Component memoized on filePath); MarkdownViewer 274->245 lines, MD_COMPONENTS now memoized on [img]. Group F added 8 CITATION_RE positive self-tests. Net: large perf win on 5000-line search-typing (only matched lines re-render).

