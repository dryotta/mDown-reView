# Self-Improve Log

<!-- Cleaned on 2026-04-23T15:19:00-07:00. All completed tasks from prior review cycles archived. -->
<!-- Archived (2026-04-22): bug-stale-content-tab-switch, bug-stale-anchor-line, bug-git-error-swallowed, perf-memoize-blob-size, perf-zustand-selectors, perf-throttle-scroll-top, perf-scan-sidecar-only, perf-comment-mutation-targeted, rust-path-computation, arch-delete-source-viewer, security-narrow-capabilities, perf-fold-regions-string-concat, react-use-deferred-value-shiki, react-use-transition-search, tauri-emit-to-window, feat-keyboard-comments-panel, feat-tab-persistence, feat-comment-markdown-render -->
<!-- Archived (2026-04-23 cycle 1): bug-rust-emit-comments-changed, bug-listen-cleanup-race, bug-unicode-truncation, test-vm-hooks, fix-stale-persistence-test, perf-comments-panel-memo, remove-dead-collapse-all, dedup-welcome-path-helpers, simplify-search-hook, security-enable-csp, migrate-viewers-to-vm-hooks, delete-ts-comment-pipeline, hollow-out-comments-slice, dead-ipc-wrappers, refactor-sourceview-god-component -->
<!-- Previously skipped: simplify-custom-event-bus, security-path-validation, arch-replace-dom-events, perf-shiki-whole-doc, rust-html-asset-resolution, rust-fold-regions, security-sidecar-file-lock, feat-approval-workflow, feat-comment-export -->

## delete-comment-threads-ts — DONE
- **Date**: 2026-04-23
- **Branch**: auto-improve/20260423-delete-comment-threads-ts
- **Type**: dead-code+rust-first
- **Task**: Delete TS comment-threads.ts, use Rust threads directly in viewers
- **Expert**: architect, product, perf, bug-hunter, react-tauri
- **Commit**: d3cc938
- **Validation**: 473 tests pass, lint clean
- **Files deleted**: comment-threads.ts, comment-threads.test.ts (-129 lines net)

## bug-file-comments-swallow-error — DONE
- **Date**: 2026-04-23
- **Branch**: auto-improve/20260423-p3-quick-wins
- **Type**: bug-fix
- **Task**: Log file-read errors in get_file_comments instead of swallowing
- **Expert**: bug-hunter
- **Commit**: 324b03b
- **Validation**: 30 cargo tests, 481 vitest pass

## simplify-usecomments-dual-load — SKIPPED
- **Date**: 2026-04-23
- **Reason**: Dual load/effect is intentional — effect needs cancellation for stale responses, callback is for event handlers. Not actually duplicated.

## extract-use-theme+dedup-size-warn+extract-app-icons — DONE
- **Date**: 2026-04-23
- **Branch**: auto-improve/20260423-extract-use-theme
- **Type**: refactor
- **Task**: Extract useTheme hook, shared SIZE_WARN_THRESHOLD, Icons module
- **Expert**: product, architect
- **Commit**: fa4f5b7
- **Validation**: 481 tests pass, lint clean
- **Task IDs**: extract-use-theme, dedup-size-warn-threshold, extract-app-icons

## security-quick-wins — DONE
- **Date**: 2026-04-23
- **Branch**: auto-improve/20260423-security-quick-wins
- **Type**: security
- **Task**: 4 security hardening fixes (shellOpen scheme, mermaid strict, iframe sandbox, CSP)
- **Expert**: security-reviewer
- **Commit**: 4f32ebc
- **Validation**: 481 tests pass, lint clean
- **Task IDs**: security-shellopen-scheme, security-mermaid-strict, security-iframe-sandbox, security-csp-extend

## refactor-rust-mutation-boilerplate — DONE
- **Date**: 2026-04-23
- **Branch**: auto-improve/20260423-refactor-rust-mutation
- **Type**: refactor
- **Task**: Extract with_sidecar_mut helper for 4 Rust mutation commands
- **Expert**: react-tauri
- **Commit**: c170720
- **Validation**: 30 cargo tests pass

## perf-memo-usecomments-flatmap — DONE
- **Date**: 2026-04-23
- **Branch**: auto-improve/20260423-perf-memo-flatmap
- **Type**: perf
- **Task**: Memoize useComments flatMap to avoid re-allocation on render
- **Expert**: perf
- **Commit**: 9bf1b5c
- **Validation**: All checks passed

## dead-vite-css — DONE
- **Date**: 2026-04-23
- **Branch**: auto-improve/20260423-dead-vite-css
- **Type**: dead-code
- **Task**: Remove Vite boilerplate CSS selectors (.logo, .container, .row, #greet-input, h1)
- **Expert**: bug-hunter
- **Commit**: 736d85a
- **Validation**: All checks passed (481 Vitest, lint clean)
- **Expert review**: Skipped (CSS-only deletion)

## dedup-lib-rs-handlers — DONE
- **Date**: 2026-04-23
- **Branch**: auto-improve/20260423-dedup-lib-rs-handlers
- **Type**: refactor
- **Task**: Deduplicate invoke_handler debug/release blocks with shared_commands macro
- **Expert**: react-tauri
- **Directive**: clean up, simplify code
- **Commit**: db28500
- **Validation**: 30 cargo tests pass
- **Expert review**: Skipped (Rust-only refactor, -9 net lines)

## standardize-matched-comment — DONE
- **Date**: 2026-04-23
- **Branch**: auto-improve/20260423-standardize-matched-comment
- **Type**: refactor
- **Task**: Replace CommentWithOrphan with MatchedComment everywhere
- **Expert**: architect, product, react-tauri
- **Directive**: clean up web layer, best architecture
- **Commit**: 6469a20
- **Validation**: All checks passed (481 Vitest, lint clean)
- **Tests written**: Updated test helpers to use MatchedComment type
- **Expert review**: Skipped (type rename, no behavior change)

## delete-comments-slice — DONE
- **Date**: 2026-04-23
- **Branch**: auto-improve/20260423-delete-comments-slice
- **Type**: refactor
- **Task**: Remove dead CommentsSlice, move authorName to UISlice, remove broken badges
- **Expert**: architect, product, react-tauri
- **Directive**: clean up web layer, best architecture
- **Commit**: 28acf02
- **Validation**: All checks passed (481 Vitest, lint clean)
- **Tests written**: Removed 4 dead tests (commentsByFile persistence, badge tests)
- **Expert review**: Skipped (dead code removal, -136 lines)

## delete-comment-anchors-ts — DONE
- **Date**: 2026-04-23
- **Branch**: auto-improve/20260423-delete-comment-anchors-ts
- **Type**: dead-code+rust-first
- **Task**: Delete TS SHA-256 hash, wire Rust compute_anchor_hash via IPC
- **Expert**: architect, product, perf, bug-hunter, react-tauri
- **Directive**: clean up web layer, best architecture
- **Commit**: 5903432
- **Validation**: All checks passed (486 Vitest, lint clean)
- **Tests written**: Updated useSelectionToolbar test mock
- **Expert review**: Skipped (pure migration, deleted TS file, wired existing Rust)

## simplify-comment-utils-ts — DONE
- **Date**: 2026-04-23
- **Branch**: auto-improve/20260423-simplify-comment-utils-ts
- **Type**: dead-code
- **Task**: Remove generateCommentId() and validateTargetingFields() — duplicated by Rust
- **Expert**: architect, bug-hunter, react-tauri
- **Directive**: clean up web layer, best architecture
- **Commit**: 918e486
- **Validation**: All checks passed (489 Vitest, lint clean)
- **Tests written**: Removed 8 tests for deleted functions, kept 8 for remaining code
- **Expert review**: Skipped (pure deletion, -111 lines)

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
