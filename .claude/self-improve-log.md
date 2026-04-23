# Self-Improve Log

<!-- Cleaned on 2026-04-23. 18 completed tasks from 2026-04-22 archived. -->
<!-- Previous completed tasks: bug-stale-content-tab-switch, bug-stale-anchor-line, bug-git-error-swallowed, perf-memoize-blob-size, perf-zustand-selectors, perf-throttle-scroll-top, perf-scan-sidecar-only, perf-comment-mutation-targeted, rust-path-computation, arch-delete-source-viewer, security-narrow-capabilities, perf-fold-regions-string-concat, react-use-deferred-value-shiki, react-use-transition-search, tauri-emit-to-window, feat-keyboard-comments-panel, feat-tab-persistence, feat-comment-markdown-render -->

## bug-rust-emit-comments-changed — DONE
- **Date**: 2026-04-23
- **Branch**: auto-improve/20260423-bug-rust-emit-comments-changed
- **Type**: bug-fix
- **Task**: Fix Rust mutation commands to emit comments-changed event
- **Expert**: product, react-tauri, architect, security
- **Directive**: MVVM migration cleanup
- **Commit**: d57b852
- **Validation**: All checks passed (110 Rust tests, 496 Vitest, lint clean)
- **Tests written**: comments_changed_event_serializes_with_file_path, comments_changed_event_payload_matches_frontend_listener
- **Expert review**: Skipped (small, well-scoped Rust-only change)

## bug-listen-cleanup-race — DONE
- **Date**: 2026-04-23
- **Branch**: auto-improve/20260423-bug-listen-cleanup-race
- **Type**: bug-fix
- **Task**: Fix listen() cleanup race in use-comments.ts
- **Expert**: react-tauri
- **Directive**: MVVM migration cleanup
- **Commit**: 195b378
- **Validation**: All checks passed (500 Vitest, lint clean)
- **Tests written**: 4 tests (rapid unmount comments-changed, rapid unmount file-changed, normal cleanup, null filePath guard)
- **Expert review**: Skipped (small hook fix with comprehensive tests)

## bug-unicode-truncation — DONE
- **Date**: 2026-04-23
- **Branch**: auto-improve/20260423-bug-unicode-truncation
- **Type**: bug-fix
- **Task**: Fix Unicode truncation mismatch between TS and Rust
- **Expert**: security
- **Directive**: MVVM migration cleanup
- **Commit**: aa831a5
- **Validation**: All checks passed (503 Vitest, lint clean)
- **Tests written**: 3 tests (emoji truncation, combining characters, mixed ASCII/emoji)
- **Expert review**: Skipped (minimal 2-file change with comprehensive tests)

## test-vm-hooks — DONE
- **Date**: 2026-04-23
- **Branch**: auto-improve/20260423-test-vm-hooks
- **Type**: test
- **Task**: Write comprehensive tests for useComments and useCommentActions VM hooks
- **Expert**: test-gap, product
- **Directive**: test coverage and validate
- **Commit**: 5b4904d
- **Validation**: All checks passed (533 Vitest, lint clean)
- **Tests written**: 34 total (19 useComments, 15 useCommentActions) — loading, events, stale response, CRUD, author fallback, error handling
- **Expert review**: Skipped (test-only change, no behavior modifications)

## fix-stale-persistence-test — DONE
- **Date**: 2026-04-23
- **Branch**: auto-improve/20260423-fix-stale-persistence-test
- **Type**: test
- **Task**: Fix stale persistence test contradicting tab persistence
- **Expert**: test-gap
- **Directive**: test coverage and validate
- **Commit**: 90f1d12
- **Validation**: All checks passed (533 Vitest, lint clean)
- **Tests written**: Updated 3 existing assertions (tabs, activeTabPath, expected keys)
- **Expert review**: Skipped (trivial test assertion update)

## perf-comments-panel-memo — DONE
- **Date**: 2026-04-23
- **Branch**: auto-improve/20260423-perf-comments-panel-memo
- **Type**: perf
- **Task**: Add useMemo to CommentsPanel grouping/sorting/filtering
- **Expert**: perf
- **Directive**: simplify code
- **Commit**: 5cbb4db
- **Validation**: All checks passed (57 comment tests, lint clean)
- **Tests written**: None (perf optimization, existing tests pass)
- **Expert review**: Skipped (single-file memoization addition)

## remove-dead-collapse-all — DONE
- **Date**: 2026-04-23
- **Branch**: auto-improve/20260423-remove-dead-code-p3
- **Type**: dead-code
- **Task**: Remove unused collapseAll store action
- **Expert**: perf
- **Commit**: fbc324e

## dedup-welcome-path-helpers — DONE
- **Date**: 2026-04-23
- **Branch**: auto-improve/20260423-remove-dead-code-p3
- **Type**: dead-code
- **Task**: Replace inline path helpers in WelcomeView with path-utils imports
- **Expert**: perf
- **Commit**: fbc324e

## simplify-search-hook — DONE
- **Date**: 2026-04-23
- **Branch**: auto-improve/20260423-remove-dead-code-p3
- **Type**: refactor
- **Task**: Replace useTransition+deferredQuery state with useDeferredValue
- **Expert**: react-tauri
- **Commit**: fbc324e

## security-enable-csp — DONE
- **Date**: 2026-04-23
- **Branch**: auto-improve/20260423-security-enable-csp
- **Type**: security
- **Task**: Enable Content Security Policy in tauri.conf.json
- **Expert**: security
- **Commit**: f057953

## migrate-viewers-to-vm-hooks — DONE
- **Date**: 2026-04-23
- **Branch**: auto-improve/20260423-migrate-viewers-to-vm-hooks
- **Type**: refactor
- **Task**: Wire useComments + useCommentActions into all 6 viewer/comment components
- **Expert**: all
- **Commit**: bd9cd0a
- **Notes**: Migrated SourceView, MarkdownViewer, DeletedFileViewer, CommentsPanel, CommentThread, LineCommentMargin from old Zustand pipeline to VM hooks. Added serde(rename_all=camelCase) to Rust MatchedComment. Updated all E2E mocks to return CommentThread[] format. 539 unit tests + 40 E2E tests passing.
