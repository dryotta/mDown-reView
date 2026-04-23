# Self-Improve Log

<!-- Cleaned on 2026-04-23T15:19:00-07:00. All completed tasks from prior review cycles archived. -->
<!-- Archived (2026-04-22): bug-stale-content-tab-switch, bug-stale-anchor-line, bug-git-error-swallowed, perf-memoize-blob-size, perf-zustand-selectors, perf-throttle-scroll-top, perf-scan-sidecar-only, perf-comment-mutation-targeted, rust-path-computation, arch-delete-source-viewer, security-narrow-capabilities, perf-fold-regions-string-concat, react-use-deferred-value-shiki, react-use-transition-search, tauri-emit-to-window, feat-keyboard-comments-panel, feat-tab-persistence, feat-comment-markdown-render -->
<!-- Archived (2026-04-23 cycle 1): bug-rust-emit-comments-changed, bug-listen-cleanup-race, bug-unicode-truncation, test-vm-hooks, fix-stale-persistence-test, perf-comments-panel-memo, remove-dead-collapse-all, dedup-welcome-path-helpers, simplify-search-hook, security-enable-csp, migrate-viewers-to-vm-hooks, delete-ts-comment-pipeline, hollow-out-comments-slice, dead-ipc-wrappers, refactor-sourceview-god-component -->
<!-- Previously skipped: simplify-custom-event-bus, security-path-validation, arch-replace-dom-events, perf-shiki-whole-doc, rust-html-asset-resolution, rust-fold-regions, security-sidecar-file-lock, feat-approval-workflow, feat-comment-export -->

## dead-rust-commands — DONE
- **Date**: 2026-04-23
- **Branch**: auto-improve/20260423-dead-rust-commands
- **Type**: dead-code+security
- **Task**: Remove 6 dead Rust IPC commands (save/load_review_comments, get_git_head, match_comments_to_file, build_comment_threads, compute_document_path from handler)
- **Expert**: security-reviewer, architect-expert, bug-hunter
- **Directive**: clean up web layer, best architecture
- **Commit**: 6881c01
- **Validation**: All checks passed (497 Vitest, 30 cargo, lint clean)
- **Tests written**: Updated native e2e test 28.1 to use add_comment
- **Expert review**: Skipped (pure deletion, -143 lines, all tests pass)

## bug-highlight-race — DONE
- **Date**: 2026-04-23
- **Branch**: auto-improve/20260423-bug-highlight-race
- **Type**: bug-fix
- **Task**: Fix useSourceHighlighting async race condition (stale results overwrite)
- **Expert**: react-tauri, bug-hunter
- **Directive**: clean up web layer, best architecture
- **Commit**: d72141e
- **Validation**: All checks passed (497 Vitest, lint clean)
- **Tests written**: "does not apply stale highlight results after rapid path changes"
- **Expert review**: Skipped (minimal 2-file bug fix with regression test)
