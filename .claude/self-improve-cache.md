---
generated_at: 2026-04-22T17:30:00-07:00
head_sha: ec7aaa222f89c37846ec2ed9e04ffcff4d687d46
branch: main
---

# Expert Review Backlog

## Summary Table

| ID | Task | Priority | Type | Quick Win | Expert | Files | Risk | Has Test Outline | Status |
|----|------|----------|------|-----------|--------|-------|------|------------------|--------|
| bug-stale-content-tab-switch | Fix stale file content on tab/file switch | P1 | bug | yes | bug-hunter | src/hooks/useFileContent.ts | low | yes | done |
| bug-stale-anchor-line | Fix comment anchor leaving line stale after matching | P1 | bug | yes | bug-hunter | src/lib/comment-matching.ts | low | yes | done |
| bug-git-error-swallowed | Fix git rev-parse error silently swallowed | P1 | bug | yes | bug-hunter | src-tauri/src/commands.rs | low | yes | done |
| perf-memoize-blob-size | Memoize Blob.size in ViewerRouter | P2 | feature | yes | performance | src/components/viewers/ViewerRouter.tsx | low | no | done |
| perf-zustand-selectors | Replace bare useStore() with fine-grained selectors | P2 | feature | yes | performance, architect, react-tauri | src/App.tsx, src/components/FolderTree/FolderTree.tsx, src/components/comments/CommentsPanel.tsx, src/components/comments/CommentThread.tsx, src/components/TabBar/TabBar.tsx, src/components/comments/LineCommentMargin.tsx | low | no | done |
| perf-throttle-scroll-top | Throttle setScrollTop with requestAnimationFrame | P2 | feature | yes | performance | src/components/viewers/ViewerRouter.tsx | low | no | done |
| perf-scan-sidecar-only | Scope scanReviewFiles to sidecar deletion events only | P2 | feature | yes | performance | src/hooks/useFileWatcher.ts | low | yes | done |
| perf-comment-mutation-targeted | Fix comment mutations to target only affected file | P2 | feature | yes | performance, architect | src/store/index.ts | low | no | done |
| arch-extract-comment-hook | Extract useCommentSystem hook from SourceView and MarkdownViewer | P2 | feature | no | architect | src/components/viewers/SourceView.tsx, src/components/viewers/MarkdownViewer.tsx | medium | no | open |
| arch-delete-source-viewer | Delete dead code SourceViewer.tsx | P3 | feature | yes | architect, product | src/components/viewers/SourceViewer.tsx | low | no | done |
| arch-shiki-singleton | Consolidate three Shiki highlighter singletons into one | P3 | feature | no | architect | src/components/viewers/SourceView.tsx, src/components/viewers/MarkdownViewer.tsx, src/lib/highlighter.ts | medium | no | open |
| security-enable-csp | Enable Content Security Policy in tauri.conf.json | P2 | bug | no | react-tauri | src-tauri/tauri.conf.json | medium | no | open |
| security-narrow-capabilities | Narrow Tauri capability permissions to least privilege | P3 | feature | yes | react-tauri | src-tauri/capabilities/default.json | low | no | done |
| perf-shiki-whole-doc | Switch Shiki from per-line to whole-document highlighting | P2 | feature | no | performance | src/components/viewers/SourceView.tsx | medium | no | open |
| rust-levenshtein-migration | Move Levenshtein fuzzy matching to Rust command | P2 | rust-migration | no | performance, architect | src/lib/comment-matching.ts, src-tauri/src/commands.rs | medium | no | open |
| rust-html-asset-resolution | Move HTML asset resolution to single Rust command | P3 | rust-migration | no | react-tauri | src/lib/resolve-html-assets.ts, src-tauri/src/commands.rs | medium | no | open |
| rust-path-computation | Move relative path computation to Rust | P3 | rust-migration | yes | architect | src/hooks/useAutoSaveComments.ts, src-tauri/src/commands.rs | low | no | done |
| feat-approval-workflow | Add file/session review approval workflow | P3 | feature | no | product | src/store/index.ts, src-tauri/src/commands.rs, src/components/TabBar/TabBar.tsx | medium | no | open |
| feat-comment-export | Add comment export for agent consumption | P3 | feature | no | product | src-tauri/src/commands.rs | medium | no | open |
| feat-keyboard-comments-panel | Add keyboard accessibility to CommentsPanel | P3 | feature | yes | ux | src/components/comments/CommentsPanel.tsx | low | no | open |
| feat-tab-persistence | Persist open tabs across sessions | P3 | feature | yes | product | src/store/index.ts | low | no | open |
| arch-replace-dom-events | Replace DOM CustomEvent bridge with Zustand store signals | P3 | feature | no | react-tauri, architect | src/hooks/useFileWatcher.ts, src/components/viewers/SourceView.tsx, src/components/viewers/MarkdownViewer.tsx | medium | no | open |
| perf-fold-regions-string-concat | Fix O(n²) string concatenation in computeFoldRegions | P3 | feature | yes | performance | src/lib/fold-regions.ts | low | no | open |
| react-use-deferred-value-shiki | Add useDeferredValue for Shiki highlighting | P3 | feature | yes | react-tauri | src/components/viewers/SourceView.tsx | low | no | open |
| react-use-transition-search | Add useTransition for search input | P3 | feature | yes | react-tauri | src/hooks/useSearch.ts | low | no | open |
| tauri-emit-to-window | Use emit_to() instead of emit() for file-changed events | P3 | feature | yes | react-tauri | src-tauri/src/watcher.rs | low | no | open |
| feat-comment-markdown-render | Render comment text as markdown instead of plain text | P3 | feature | yes | product | src/components/comments/CommentThread.tsx | low | no | open |

<!-- Status values: open, done, failed, skipped -->

---

## Task Details

### bug-stale-content-tab-switch
- **Priority**: P1
- **Type**: bug
- **Quick win**: yes
- **Risk**: low
- **Found by**: bug-hunter
- **Location**: src/hooks/useFileContent.ts:29-34
- **Evidence**: `loading` is only set when `reloadKey === 0`. After one reload, switching `path` to a different file skips loading state and can briefly show the previous file's content until `readTextFile()` resolves.
- **Fix**: Always set `loading = true` when `path` changes, regardless of `reloadKey` value.
- **Rust-first**: no
- **Failing test outline**:
```typescript
it('should show loading when path changes after reload', () => {
  const { rerender, result } = renderHook(({ path }) => useFileContent(path), {
    initialProps: { path: '/file-a.md' }
  });
  // Simulate reload (reloadKey > 0)
  act(() => { /* trigger file-changed event */ });
  rerender({ path: '/file-b.md' });
  expect(result.current.loading).toBe(true);
});
```

### bug-stale-anchor-line
- **Priority**: P1
- **Type**: bug
- **Quick win**: yes
- **Risk**: low
- **Found by**: bug-hunter
- **Location**: src/lib/comment-matching.ts:31-35
- **Evidence**: On exact `selected_text` match, code updates `matchedLineNumber` but not `line`. Comment object becomes internally inconsistent (`line` stays old, displayed anchor moves).
- **Fix**: Update both `matchedLineNumber` and `line` when exact match is found at a different position.
- **Rust-first**: yes — candidate for full comment matching Rust migration
- **Failing test outline**:
```typescript
it('should update line when selected_text matches at different line', () => {
  const result = matchComments(
    [{ line: 10, selected_text: "abc", id: "1" }],
    ["xxx", "abc"],
    ["xxx", "abc"]
  );
  expect(result[0].line).toBe(2);
});
```

### bug-git-error-swallowed
- **Priority**: P1
- **Type**: bug
- **Quick win**: yes
- **Risk**: low
- **Found by**: bug-hunter
- **Location**: src-tauri/src/commands.rs:310-322
- **Evidence**: All `git rev-parse` failures return `Ok(None)`, hiding real command failures (missing git, permission problems, bad cwd) from the frontend. Frontend can't distinguish "not a repo" from "command failed".
- **Fix**: Return `Err` for command execution failures; reserve `Ok(None)` only for "not a git repo" (exit code 128).
- **Rust-first**: already in Rust
- **Failing test outline**:
```rust
#[test]
fn get_git_head_returns_error_on_command_failure() {
    // Set PATH to empty so git is not found
    // Call get_git_head with a valid repo path
    // Assert returns Err, not Ok(None)
}
```

### perf-memoize-blob-size
- **Priority**: P2
- **Type**: feature
- **Quick win**: yes
- **Risk**: low
- **Found by**: performance
- **Location**: src/components/viewers/ViewerRouter.tsx:84
- **Evidence**: `new Blob([content]).size` runs in render body (not memoized). Benchmarked: 0.68ms for 500KB file × 60 re-renders/sec = ~41ms/sec wasted on main thread.
- **Fix**: Memoize with `useMemo(() => content ? new TextEncoder().encode(content).length : undefined, [content])` or use `content.length` approximation.
- **Rust-first**: no

### perf-zustand-selectors
- **Priority**: P2
- **Type**: feature
- **Quick win**: yes
- **Risk**: low
- **Found by**: performance, architect, react-tauri
- **Location**: App.tsx:119, FolderTree.tsx:12, CommentsPanel.tsx:14, CommentThread.tsx:28, TabBar.tsx:6,38, LineCommentMargin.tsx:26
- **Evidence**: 8 components use bare `useStore()` without selectors, subscribing to entire Zustand store. Every `set()` call triggers re-render of all 8. `useShallow` already imported but only used in 1 place.
- **Fix**: Replace all bare `useStore()` with individual selectors or `useShallow` batched selectors. Action functions are referentially stable in Zustand so individual selectors for actions won't cause re-renders.
- **Rust-first**: no

### perf-throttle-scroll-top
- **Priority**: P2
- **Type**: feature
- **Quick win**: yes
- **Risk**: low
- **Found by**: performance
- **Location**: src/components/viewers/ViewerRouter.tsx:46
- **Evidence**: `setScrollTop(path, scrollTop)` fires on every scroll event (~60/sec). Creates new `tabs` array each time via `store/index.ts:167-169`.
- **Fix**: Wrap in `requestAnimationFrame` to throttle to ~16ms intervals.
- **Rust-first**: no

### perf-scan-sidecar-only
- **Priority**: P2
- **Type**: feature
- **Quick win**: yes
- **Risk**: low
- **Found by**: performance
- **Location**: src/hooks/useFileWatcher.ts:48-59
- **Evidence**: `scanReviewFiles` walks entire workspace tree (up to 50 depth, 10K files) on every `kind === "deleted"` event, even for non-sidecar files. On a large repo this is expensive.
- **Fix**: Only re-scan when `path.endsWith(".review.yaml") || path.endsWith(".review.json")`.
- **Rust-first**: no
- **Failing test outline**:
```typescript
it('should not scan on non-sidecar file deletion', async () => {
  // Dispatch file-changed event with kind=deleted, path=/some/file.ts
  // Assert scanReviewFiles was NOT called
});
it('should scan on sidecar file deletion', async () => {
  // Dispatch file-changed event with kind=deleted, path=/some/file.md.review.yaml
  // Assert scanReviewFiles WAS called
});
```

### perf-comment-mutation-targeted
- **Priority**: P2
- **Type**: feature
- **Quick win**: yes
- **Risk**: low
- **Found by**: performance, architect
- **Location**: src/store/index.ts:221-286
- **Evidence**: `editComment`, `deleteComment`, `resolveComment`, `unresolveComment` rebuild entire `commentsByFile` via `Object.fromEntries(Object.entries(...).map(...))`. Invalidates selectors for unrelated files.
- **Fix**: Accept `filePath` parameter; update only the target file's array with spread operator.
- **Rust-first**: no

### arch-extract-comment-hook
- **Priority**: P2
- **Type**: feature
- **Quick win**: no
- **Risk**: medium
- **Found by**: architect
- **Location**: SourceView.tsx:119-363, MarkdownViewer.tsx:317-504
- **Evidence**: ~200 lines of duplicated comment orchestration: loading, sidecar watching, matching, auto-save, selection toolbar, scroll-to-line. Bug fix in one viewer will be missed in the other.
- **Fix**: Extract `useCommentSystem(filePath, lines)` hook returning `{ comments, commentsByLine, matchedComments, commentLoadKey }`.
- **Rust-first**: no

### arch-delete-source-viewer
- **Priority**: P3
- **Type**: feature
- **Quick win**: yes
- **Risk**: low
- **Found by**: architect, product
- **Location**: src/components/viewers/SourceViewer.tsx (115 lines)
- **Evidence**: Not imported anywhere in production code. Only test files reference it. Duplicates langFromPath and Shiki setup from SourceView.
- **Fix**: Delete SourceViewer.tsx and its test file.
- **Rust-first**: no

### arch-shiki-singleton
- **Priority**: P3
- **Type**: feature
- **Quick win**: no
- **Risk**: medium
- **Found by**: architect
- **Location**: SourceView.tsx:28, SourceViewer.tsx:14, MarkdownViewer.tsx:68
- **Evidence**: Three independent Shiki highlighter instances with same themes. Also duplicated `langFromPath` between SourceView and SourceViewer.
- **Fix**: Extract shared `src/lib/highlighter.ts` exporting single `getHighlighter()`.
- **Rust-first**: no

### security-enable-csp
- **Priority**: P2
- **Type**: bug
- **Quick win**: no
- **Risk**: medium
- **Found by**: react-tauri
- **Location**: src-tauri/tauri.conf.json:24
- **Evidence**: `"csp": null` disables CSP entirely. `dangerouslySetInnerHTML` used in SourceView.tsx:434, SourceViewer.tsx:110, MarkdownViewer.tsx:107, MermaidView.tsx:89. XSS in rendered content executes with full Tauri privileges.
- **Fix**: Set restrictive CSP: `default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' asset: data: blob:; connect-src ipc: http://ipc.localhost`
- **Rust-first**: no

### security-narrow-capabilities
- **Priority**: P3
- **Type**: feature
- **Quick win**: yes
- **Risk**: low
- **Found by**: react-tauri
- **Location**: src-tauri/capabilities/default.json:6-11
- **Evidence**: Uses `*:default` grants for all plugins. App only needs specific permissions (clipboard write, dialog open, opener url).
- **Fix**: Replace with explicit minimal permissions.
- **Rust-first**: no

### perf-shiki-whole-doc
- **Priority**: P2
- **Type**: feature
- **Quick win**: no
- **Risk**: medium
- **Found by**: performance
- **Location**: src/components/viewers/SourceView.tsx:282-288
- **Evidence**: `codeToHtml()` called per line (5000 calls for 5K file). Loses cross-line syntax context (multiline strings, comments).
- **Fix**: Call `codeToHtml` once for whole document, split resulting HTML by line.
- **Rust-first**: no

### rust-levenshtein-migration
- **Priority**: P2
- **Type**: rust-migration
- **Quick win**: no
- **Risk**: medium
- **Found by**: performance, architect
- **Location**: src/lib/comment-matching.ts:80-137
- **Evidence**: Benchmarked: 5K-line file with 10 fuzzy comments = 625ms on main thread. Full O(m×n) DP matrix per line per comment. Runs in useMemo blocking React render.
- **Fix**: `#[tauri::command] fn match_comments(comments: Vec<MrsfComment>, lines: Vec<String>) -> Vec<MatchedComment>` using `strsim` crate.
- **Rust-first**: yes

### rust-html-asset-resolution
- **Priority**: P3
- **Type**: rust-migration
- **Quick win**: no
- **Risk**: medium
- **Found by**: react-tauri
- **Location**: src/lib/resolve-html-assets.ts:1-112
- **Evidence**: Makes N separate IPC calls (one per image + stylesheet) from TypeScript. Moving to single Rust command eliminates ~2N IPC round-trips per HTML view.
- **Fix**: `#[tauri::command] fn resolve_html_assets(html: String, path: String) -> String`
- **Rust-first**: yes

### rust-path-computation
- **Priority**: P3
- **Type**: rust-migration
- **Quick win**: yes
- **Risk**: low
- **Found by**: architect
- **Location**: src/hooks/useAutoSaveComments.ts:8-17
- **Evidence**: Path normalization with cross-platform backslash handling is fragile in TypeScript. Rust's `std::path` handles UNC paths and symlinks natively.
- **Fix**: `#[tauri::command] fn compute_document_path(file: String, root: Option<String>) -> String`
- **Rust-first**: yes

### feat-approval-workflow
- **Priority**: P3
- **Type**: feature
- **Quick win**: no
- **Risk**: medium
- **Found by**: product
- **Location**: src/store/index.ts (absent), src-tauri/src/commands.rs:62-67 (no status in MrsfSidecar)
- **Evidence**: Zero hits for approve/approval/reject/review status in app code. No mechanism to mark files as reviewed.
- **Fix**: Add `status: Option<String>` to MrsfSidecar, Rust command `set_review_status`, surface in TabBar and FolderTree.
- **Rust-first**: yes

### feat-comment-export
- **Priority**: P3
- **Type**: feature
- **Quick win**: no
- **Risk**: medium
- **Found by**: product
- **Location**: src-tauri/src/commands.rs:277 (scan_review_files can be reused)
- **Evidence**: Zero hits for export_review_summary. Agent feedback loop is one-directional. Supports CLI goal in issue #17.
- **Fix**: `#[tauri::command] fn export_review_summary(root: String) -> String` aggregating all unresolved comments.
- **Rust-first**: yes

### feat-keyboard-comments-panel
- **Priority**: P3
- **Type**: feature
- **Quick win**: yes
- **Risk**: low
- **Found by**: ux
- **Location**: src/components/comments/CommentsPanel.tsx:47-58
- **Evidence**: Clickable `<div>` items with no `tabIndex`, `role`, or `onKeyDown`. Users can't navigate comments via keyboard.
- **Fix**: Add `role="button"`, `tabIndex={0}`, `onKeyDown` handler for Enter/Space.
- **Rust-first**: no

### feat-tab-persistence
- **Priority**: P3
- **Type**: feature
- **Quick win**: yes
- **Risk**: low
- **Found by**: product
- **Location**: src/store/index.ts:336-345
- **Evidence**: `tabs` and `activeTabPath` absent from `partialize`. All open tabs lost on restart.
- **Fix**: Add to `partialize`, validate file existence on restore using `check_path_exists`.
- **Rust-first**: no

### arch-replace-dom-events
- **Priority**: P3
- **Type**: feature
- **Quick win**: no
- **Risk**: medium
- **Found by**: react-tauri, architect
- **Location**: useFileWatcher.ts:41-45, SourceView.tsx:139-148, MarkdownViewer.tsx:370-379
- **Evidence**: `mdownreview:file-changed` and `scroll-to-line` CustomEvents bypass React data flow, invisible to DevTools, hard to test.
- **Fix**: Use Zustand store for file-change signals and scroll targets.
- **Rust-first**: no

### perf-fold-regions-string-concat
- **Priority**: P3
- **Type**: feature
- **Quick win**: yes
- **Risk**: low
- **Found by**: performance
- **Location**: src/lib/fold-regions.ts:9-108
- **Evidence**: `stripStringsAndComments()` uses `result += ch` string concatenation which is O(n²) per line. Benchmarked: 10K lines = 74.8ms.
- **Fix**: Use `chars.push(ch)` + `chars.join("")` pattern instead.
- **Rust-first**: no

### react-use-deferred-value-shiki
- **Priority**: P3
- **Type**: feature
- **Quick win**: yes
- **Risk**: low
- **Found by**: react-tauri
- **Location**: src/components/viewers/SourceView.tsx:266
- **Evidence**: Shiki highlighting runs in useEffect triggered by content changes. For large files, blocks main thread. React 19's `useDeferredValue` would let raw content render immediately.
- **Fix**: `const deferredContent = useDeferredValue(content)` for Shiki effect only.
- **Rust-first**: no

### react-use-transition-search
- **Priority**: P3
- **Type**: feature
- **Quick win**: yes
- **Risk**: low
- **Found by**: react-tauri
- **Location**: src/hooks/useSearch.ts:31-34
- **Evidence**: `setQuery` sets state synchronously. For files with thousands of lines, the matches computation in useMemo runs immediately, causing input lag.
- **Fix**: Wrap in `startTransition` to keep search input responsive.
- **Rust-first**: no

### tauri-emit-to-window
- **Priority**: P3
- **Type**: feature
- **Quick win**: yes
- **Risk**: low
- **Found by**: react-tauri
- **Location**: src-tauri/src/watcher.rs:94
- **Evidence**: `app_handle.emit()` broadcasts to all webviews. Works now with single window but breaks with multi-window.
- **Fix**: `app_handle.get_webview_window("main").emit()` to scope to main window.
- **Rust-first**: already in Rust

### feat-comment-markdown-render
- **Priority**: P3
- **Type**: feature
- **Quick win**: yes
- **Risk**: low
- **Found by**: product
- **Location**: src/components/comments/CommentThread.tsx:71
- **Evidence**: `<p className="comment-text">{comment.text}</p>` renders as plain text. AI comments often contain code, links, bullets. `react-markdown` already in bundle.
- **Fix**: Render `comment.text` through lightweight react-markdown.
- **Rust-first**: no

## Retrospective Notes

### 2026-04-22 — bug-stale-content-tab-switch — DONE
- **Lesson**: Small React hook state bugs are well-scoped for auto-improve; ref-based previous-value tracking is a clean pattern
- **New tasks added**: none (react-tauri StrictMode suggestion noted but not elevated to task — cosmetic only)
- **Tasks re-prioritized**: none
- **Process improvement**: none

### 2026-04-22 — bug-stale-anchor-line — DONE
- **Lesson**: Expert evidence can be stale — the bug was already fixed. Always verify evidence before implementing. Tests still valuable as coverage gap fill.
- **New tasks added**: none
- **Tasks re-prioritized**: none
- **Process improvement**: Validate expert evidence against current code before branching

### 2026-04-22 — bug-git-error-swallowed — DONE
- **Lesson**: Rust error handling fixes are clean auto-improve targets; catch-all arms that swallow errors are real bugs
- **New tasks added**: none (architect's console.warn suggestion is polish, not a new task)
- **Tasks re-prioritized**: none
- **Process improvement**: none

### 2026-04-22 — perf-memoize-blob-size — DONE
- **Lesson**: Perf expert noted content.length is O(1) and sufficient for approximate size checks — TextEncoder.encode allocates unnecessarily
- **New tasks added**: none (content.length optimization is minor polish)
- **Tasks re-prioritized**: none
- **Process improvement**: Consider simpler alternatives before reaching for precise byte counting

### 2026-04-22 — perf-zustand-selectors — DONE
- **Lesson**: Expert review caught pattern inconsistency (actions in useShallow) across 3 experts independently — validates the multi-expert approach. Fixed before commit.
- **New tasks added**: none
- **Tasks re-prioritized**: none
- **Process improvement**: Apply expert feedback before committing when fixes are trivial

### 2026-04-22 — perf-throttle-scroll-top — DONE
- **Lesson**: rAF throttle is a half-fix; scroll mutations touching tabs array still cause cascading re-renders and IPC calls. Separate scrollTop into its own map is the proper fix.
- **New tasks added**: none (store-level scroll separation is a medium-risk refactor, not auto-improvable)
- **Tasks re-prioritized**: none
- **Process improvement**: none

### 2026-04-22  perf-scan-sidecar-only  DONE
- **Lesson**: Architect review caught a real regression  sidecar-only filtering would miss ghost detection on source file deletion. Debouncing all deletions is the correct approach.
- **New tasks added**: none
- **Tasks re-prioritized**: none
- **Process improvement**: When a perf task narrows a code path, verify all semantic cases the original broad path covered

### 2026-04-22  perf-comment-mutation-targeted  DONE
- **Lesson**: Straightforward pattern replacement. findFileForComment linear scan is fine for typical usage.
- **New tasks added**: none
- **Tasks re-prioritized**: none
- **Process improvement**: none

### 2026-04-22  rust-path-computation  DONE
- **Lesson**: Perf expert correctly noted IPC overhead for trivial computation. Kept per AGENTS.md Rust-first for path ops. Applied Promise.all to parallelize independent IPC calls. Test-gap reviewer caught CI-breaking Windows test - gated with cfg(windows).
- **New tasks added**: none
- **Tasks re-prioritized**: none
- **Process improvement**: Always cfg-gate platform-specific Rust tests

### 2026-04-22  arch-delete-source-viewer  DONE
- **Lesson**: Dead code deletion is low-risk, skip expert review.
- **New tasks added**: none
- **Tasks re-prioritized**: none
- **Process improvement**: none

### 2026-04-22  security-narrow-capabilities  DONE
- **Lesson**: Security review found core:webview:default was also unnecessary. Also found pre-existing bug: process plugin not set up for restart.
- **New tasks added**: none (process plugin bug is pre-existing)
- **Tasks re-prioritized**: none
- **Process improvement**: Always run security reviewer for capability changes
