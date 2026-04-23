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
