# Self-Improve Log

## bug-stale-content-tab-switch — DONE
- **Date**: 2026-04-22
- **Branch**: auto-improve/20260422-bug-stale-content-tab-switch
- **Type**: bug-fix
- **Task**: Fix stale file content on tab/file switch
- **Expert**: bug-hunter
- **Commit**: 47cdc4d
- **Validation**: All checks passed (419 tests, lint clean)
- **Tests written**: useFileContent.test.ts: "shows loading when path changes after a reload (no stale content)"
- **Expert review**: 5 approved unconditionally, react-tauri approved with minor StrictMode suggestion (non-blocking)

## bug-stale-anchor-line — DONE
- **Date**: 2026-04-22
- **Branch**: auto-improve/20260422-bug-stale-anchor-line
- **Type**: test-coverage (reported bug already fixed in code)
- **Task**: Fix comment anchor leaving line stale after matching
- **Expert**: bug-hunter
- **Commit**: 5f6286c
- **Validation**: All checks passed (423 tests, lint clean)
- **Tests written**: 4 tests verifying `line` property consistency across exact, relocation, same-position, and fuzzy match paths
- **Expert review**: Skipped (test-only change, no source code modified)
- **Note**: Bug did not exist — code already updates both `matchedLineNumber` and `line`. Added 4 coverage tests for the previously unasserted `line` property.

## bug-git-error-swallowed — DONE
- **Date**: 2026-04-22
- **Branch**: auto-improve/20260422-bug-git-error-swallowed
- **Type**: bug-fix
- **Task**: Fix git rev-parse error silently swallowed
- **Expert**: bug-hunter
- **Commit**: f647bd7
- **Validation**: All checks passed (21 Rust tests, 423 Vitest, lint clean)
- **Tests written**: get_git_head_returns_sha_in_git_repo, get_git_head_returns_none_for_non_repo, get_git_head_returns_error_on_command_failure
- **Expert review**: 6 approved, architect suggested logging caught errors (non-blocking), test-gap noted missing non-128 exit test (minor)

## perf-memoize-blob-size — DONE
- **Date**: 2026-04-22
- **Branch**: auto-improve/20260422-perf-memoize-blob-size
- **Type**: feature (performance)
- **Task**: Memoize Blob.size in ViewerRouter
- **Expert**: performance
- **Commit**: 0b952ef
- **Validation**: All checks passed (427 tests, lint clean)
- **Tests written**: 4 tests (ASCII accuracy, multi-byte accuracy, null content, memoization stability)
- **Expert review**: 5 approved, perf expert suggested using content.length instead of TextEncoder (non-blocking optimization)

## perf-zustand-selectors — DONE
- **Date**: 2026-04-22
- **Branch**: auto-improve/20260422-perf-zustand-selectors
- **Type**: feature (performance)
- **Task**: Replace bare useStore() with fine-grained selectors
- **Expert**: performance, architect, react-tauri
- **Commit**: 574731e
- **Validation**: All checks passed (433 tests, lint clean)
- **Tests written**: 6 tests (selector isolation, action stability, useShallow correctness, static analysis guard)
- **Expert review**: 6 approved; 3 flagged action-in-useShallow inconsistency (fixed before commit)

## perf-throttle-scroll-top — DONE
- **Date**: 2026-04-22
- **Branch**: auto-improve/20260422-perf-throttle-scroll-top
- **Type**: feature (performance)
- **Task**: Throttle setScrollTop with requestAnimationFrame
- **Expert**: performance
- **Commit**: 3353709
- **Validation**: All checks passed (437 tests, lint clean)
- **Tests written**: 4 tests (sync no-call, rAF fires, coalesces rapid events, cancels on unmount)
- **Expert review**: 6 approved; perf expert noted deeper store-level issue (scroll in tabs array) as follow-up

## perf-scan-sidecar-only — DONE
- **Date**: 2026-04-22
- **Branch**: auto-improve/20260422-perf-scan-sidecar-only
- **Type**: feature (performance)
- **Task**: Debounce ghost entry scan on file deletion
- **Expert**: performance
- **Commit**: 4dd3bb2
- **Validation**: All checks passed (442 tests, 40 e2e, lint clean)
- **Tests written**: 5 tests (source file scan, sidecar yaml scan, sidecar json scan, no scan on non-delete, coalesce rapid deletions)
- **Expert review**: 5 approved, architect caught regression in sidecar-only approach → revised to debounced all-deletion scan

## perf-comment-mutation-targeted — DONE
- **Date**: 2026-04-22
- **Branch**: auto-improve/20260422-perf-comment-mutation-targeted
- **Type**: feature (performance)
- **Task**: Fix comment mutations to target only affected file
- **Expert**: performance, architect
- **Commit**: 39ed647
- **Validation**: All checks passed (455 tests, lint clean)
- **Tests written**: 13 tests (referential identity + correctness for editComment, deleteComment, resolveComment, unresolveComment)
- **Expert review**: Session crashed during review; validator passed, skipped re-review
