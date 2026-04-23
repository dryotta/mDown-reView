---
generated_at: 2026-04-23T13:30:00-07:00
head_sha: 9d9040cdd63c3e2f6fe3991ff7ae260f9c8899dc
branch: main
directive: "clean up web layer code and fully embrace model and viewmodel from native; simplify code; remove duplicate and dead code; test coverage and validate"
---

# Expert Review Backlog

## Summary Table

| ID | Task | Priority | Type | Quick Win | Expert | Files | Risk | Has Test Outline | Directive-Aligned | Status |
|----|------|----------|------|-----------|--------|-------|------|------------------|-------------------|--------|
| bug-rust-emit-comments-changed | Fix Rust mutation commands to emit comments-changed event | P1 | bug | yes | product, react-tauri, architect, security | src-tauri/src/commands.rs | low | yes | yes | done |
| migrate-viewers-to-vm-hooks | Wire useComments + useCommentActions into all viewers | P1 | refactor | no | all | SourceView.tsx, MarkdownViewer.tsx, DeletedFileViewer.tsx, CommentsPanel.tsx, CommentThread.tsx, LineCommentMargin.tsx | high | no | yes | open |
| delete-ts-comment-pipeline | Delete comment-matching.ts, comment-threads.ts, dead anchor exports | P1 | dead-code | yes | perf, architect, security, test-gap | src/lib/comment-matching.ts, src/lib/comment-threads.ts, src/lib/comment-anchors.ts | medium | no | yes | open |
| hollow-out-comments-slice | Remove comment CRUD from Zustand store, keep only authorName | P1 | refactor | no | react-tauri, architect, security | src/store/index.ts | high | no | yes | open |
| delete-auto-save-hook | Delete useAutoSaveComments and useCommitEnricher hooks | P1 | dead-code | yes | product, react-tauri, architect | src/hooks/useAutoSaveComments.ts, src/hooks/useCommitEnricher.ts | medium | no | yes | open |
| test-vm-hooks | Write comprehensive tests for useComments and useCommentActions | P1 | test | no | test-gap, product | src/lib/vm/use-comments.ts, src/lib/vm/use-comment-actions.ts | low | yes | yes | open |
| bug-listen-cleanup-race | Fix listen() cleanup race in use-comments.ts | P2 | bug | yes | react-tauri | src/lib/vm/use-comments.ts | low | yes | yes | done |
| fix-stale-persistence-test | Fix stale persistence test contradicting tab persistence | P2 | test | yes | test-gap | src/__tests__/store/persistence.test.ts | low | no | yes | open |
| perf-comments-panel-memo | Add useMemo to CommentsPanel grouping/sorting/filtering | P2 | perf | yes | perf | src/components/comments/CommentsPanel.tsx | low | no | no | open |
| simplify-custom-event-bus | Replace DOM CustomEvent bridge with direct Tauri event subs | P2 | refactor | no | react-tauri, architect | src/hooks/useFileWatcher.ts, viewers | medium | no | yes | open |
| security-enable-csp | Enable Content Security Policy in tauri.conf.json | P2 | security | yes | security | src-tauri/tauri.conf.json | medium | no | no | open |
| security-path-validation | Add path validation to all file-accepting Rust commands | P2 | security | no | security | src-tauri/src/commands.rs | medium | yes | no | open |
| refactor-sourceview-god-component | Break up SourceView.tsx into focused hooks | P2 | refactor | no | architect | src/components/viewers/SourceView.tsx | medium | no | yes | open |
| perf-shiki-whole-doc | Switch Shiki from per-line to whole-document highlighting | P2 | perf | no | perf | src/components/viewers/SourceView.tsx | medium | no | no | open |
| dead-ipc-wrappers | Remove unused IPC wrappers from tauri-commands.ts | P2 | dead-code | yes | perf | src/lib/tauri-commands.ts | low | no | yes | open |
| bug-unicode-truncation | Fix Unicode truncation mismatch between TS and Rust | P2 | bug | yes | security | src/lib/comment-utils.ts, src-tauri/src/core/anchors.rs | low | yes | yes | done |
| dedup-welcome-path-helpers | Replace inline path helpers in WelcomeView with path-utils | P3 | dead-code | yes | perf | src/components/WelcomeView.tsx | low | no | yes | open |
| remove-dead-collapse-all | Remove unused collapseAll store action | P3 | dead-code | yes | perf | src/store/index.ts | low | no | yes | open |
| remove-dead-reset-commit-cache | Remove unused resetCommitCache export | P3 | dead-code | yes | security | src/hooks/useCommitEnricher.ts | low | no | yes | open |
| simplify-search-hook | Replace useTransition+deferredQuery with useDeferredValue | P3 | refactor | yes | react-tauri | src/hooks/useSearch.ts | low | no | yes | open |
| rust-html-asset-resolution | Move HTML asset resolution to single Rust command | P3 | rust-migration | no | react-tauri | src/lib/resolve-html-assets.ts | medium | no | no | open |
| rust-fold-regions | Port fold region computation to Rust | P3 | rust-migration | no | architect | src/lib/fold-regions.ts | medium | no | no | open |
| security-sidecar-file-lock | Add per-file mutex for concurrent sidecar writes | P3 | security | no | security | src-tauri/src/core/sidecar.rs | medium | yes | no | open |
| feat-approval-workflow | Add file/session review approval workflow | P3 | feature | no | product | src/store/index.ts, src-tauri/src/commands.rs | medium | no | no | open |
| feat-comment-export | Add comment export for agent consumption | P3 | feature | no | product | src-tauri/src/commands.rs | medium | no | no | open |
| arch-replace-dom-events | Replace DOM CustomEvent bridge with Zustand store signals | P3 | refactor | no | react-tauri, architect | src/hooks/useFileWatcher.ts | medium | no | yes | open |

<!-- Status values: open, done, failed, skipped -->

---

## Task Details

### bug-rust-emit-comments-changed
- **Priority**: P1
- **Type**: bug
- **Quick win**: yes
- **Risk**: low
- **Found by**: product, react-tauri, architect, security
- **Location**: src-tauri/src/commands.rs:306-451
- **Evidence**: All 5 Rust mutation commands (add_comment, add_reply, edit_comment, delete_comment, set_comment_resolved) write to sidecar but never emit a `comments-changed` Tauri event. The VM hook `use-comments.ts:71` listens for this event but nothing produces it. Grep for `comments-changed` in `src-tauri/` returns zero matches. This makes the entire VM layer non-functional.
- **Fix**: Add `app: tauri::AppHandle` parameter to all mutation commands; emit `comments-changed` with `{ file_path }` payload after each successful sidecar write.
- **Rust-first**: already in Rust
- **Directive**: yes
- **Failing test outline**:
```rust
#[test]
fn add_comment_emits_comments_changed_event() {
    // Setup: create temp file, init sidecar
    // Act: call add_comment command with AppHandle
    // Assert: "comments-changed" event was emitted with { file_path: ... }
}
```

### migrate-viewers-to-vm-hooks
- **Priority**: P1
- **Type**: refactor
- **Quick win**: no
- **Risk**: high
- **Found by**: all 6 experts
- **Location**: SourceView.tsx:79-163, MarkdownViewer.tsx:299-387, DeletedFileViewer.tsx:14-36, CommentsPanel.tsx:14-27, CommentThread.tsx:29-32, LineCommentMargin.tsx:53
- **Evidence**: All viewers use old Zustand `commentsByFile` + TS `matchComments()` + `groupCommentsIntoThreads()`. The VM hooks (`useComments`, `useCommentActions`) wrap the Rust `get_file_comments` single-IPC-call hot path but have zero consumers. All 6 experts independently confirmed zero component imports of the VM layer.
- **Fix**: Replace old load/match/thread pipeline in each viewer with `useComments(filePath)`. Replace mutation calls (store.addComment, etc.) with `useCommentActions()`. Eliminates ~140 lines of duplicated effects and ~90 lines of duplicated matching/threading per viewer.
- **Rust-first**: already done in Rust — just needs frontend wiring
- **Directive**: yes
- **Depends on**: bug-rust-emit-comments-changed, test-vm-hooks

### delete-ts-comment-pipeline
- **Priority**: P1
- **Type**: dead-code
- **Quick win**: yes
- **Risk**: medium
- **Found by**: perf, architect, security, test-gap
- **Location**: src/lib/comment-matching.ts (139 lines), src/lib/comment-threads.ts (41 lines), src/lib/comment-anchors.ts:13-47 (dead exports), src/lib/comment-utils.ts:12-20 (duplicate ID gen + truncation)
- **Evidence**: Full Levenshtein matching, threading, hash, and ID generation duplicated in both TS and Rust. The TS Levenshtein uses O(m×n) 2D array vs Rust's O(min(m,n)) single-row. Unicode truncation diverges (TS UTF-16 vs Rust Unicode scalars). `createLineAnchor` and `createSelectionAnchor` have zero production consumers.
- **Fix**: Delete `comment-matching.ts`, `comment-threads.ts`, dead anchor exports from `comment-anchors.ts`, and duplicate utils from `comment-utils.ts` after viewer migration.
- **Rust-first**: already in Rust
- **Directive**: yes
- **Depends on**: migrate-viewers-to-vm-hooks

### hollow-out-comments-slice
- **Priority**: P1
- **Type**: refactor
- **Quick win**: no
- **Risk**: high
- **Found by**: react-tauri, architect, security
- **Location**: src/store/index.ts:207-326 (~120 lines)
- **Evidence**: Full CRUD (addComment, addReply, editComment, deleteComment with §9.1 reparenting, resolveComment, unresolveComment) operates purely in-memory on `commentsByFile`. These do not call any Rust IPC — persistence only happens via debounced `useAutoSaveComments`. Zustand mutations can clobber concurrent Rust saves. `commentsByFile` entries are never cleaned up when tabs close (memory leak).
- **Fix**: Remove all mutation methods from CommentsSlice. Remove `commentsByFile`. Keep only `authorName` and its setter. Comments are now loaded fresh from Rust via `useComments` hook.
- **Rust-first**: N/A (deletion)
- **Directive**: yes
- **Depends on**: migrate-viewers-to-vm-hooks

### delete-auto-save-hook
- **Priority**: P1
- **Type**: dead-code
- **Quick win**: yes
- **Risk**: medium
- **Found by**: product, react-tauri, architect
- **Location**: src/hooks/useAutoSaveComments.ts (87 lines), src/hooks/useCommitEnricher.ts (52 lines)
- **Evidence**: `useAutoSaveComments` implements debounced save with dirty tracking and unmount flush. This exists because old path mutates in-memory first. With Rust-first mutations, persistence is atomic — no debounce needed. `enrichCommentsWithCommit` can move into Rust `add_comment` command. `resetCommitCache` is a dead export.
- **Fix**: Delete both hooks after MVVM migration. Move git HEAD enrichment into Rust `add_comment`.
- **Rust-first**: commit enrichment should move to Rust
- **Directive**: yes
- **Depends on**: migrate-viewers-to-vm-hooks

### test-vm-hooks
- **Priority**: P1
- **Type**: test
- **Quick win**: no
- **Risk**: low
- **Found by**: test-gap, product
- **Location**: src/lib/vm/use-comments.ts, src/lib/vm/use-comment-actions.ts
- **Evidence**: 42+ test scenarios identified with zero coverage. These hooks are the new canonical comment interface and must be tested before wiring into components. Key scenarios: load→threads, filePath changes, event listener cleanup, error handling, rapid unmount, stale response discarding.
- **Fix**: Create `src/lib/vm/__tests__/use-comments.test.ts` and `use-comment-actions.test.ts` with comprehensive coverage.
- **Rust-first**: no
- **Directive**: yes
- **Depends on**: bug-rust-emit-comments-changed

### bug-listen-cleanup-race
- **Priority**: P2
- **Type**: bug
- **Quick win**: yes
- **Risk**: low
- **Found by**: react-tauri
- **Location**: src/lib/vm/use-comments.ts:71-78, 90-103
- **Evidence**: `listen()` async promise captures `unlisten` in closure. If component unmounts before promise resolves, `unlisten` is null and listener leaks. Same pattern at lines 86-108.
- **Fix**: `const listenerPromise = listen(...); return () => { listenerPromise.then(fn => fn()); };`
- **Rust-first**: no
- **Directive**: yes
- **Failing test outline**:
```typescript
it("cleans up Tauri listener even on rapid unmount", async () => {
  const mockUnlisten = vi.fn();
  let resolvePromise: (fn: () => void) => void;
  vi.mocked(listen).mockReturnValue(new Promise((r) => { resolvePromise = r; }));
  const { unmount } = renderHook(() => useComments("/test.md"));
  unmount();
  resolvePromise!(mockUnlisten);
  await flushPromises();
  expect(mockUnlisten).toHaveBeenCalled();
});
```

### fix-stale-persistence-test
- **Priority**: P2
- **Type**: test
- **Quick win**: yes
- **Risk**: low
- **Found by**: test-gap
- **Location**: src/__tests__/store/persistence.test.ts:50-60
- **Evidence**: Asserts tabs/activeTabPath NOT persisted, but auto-improve task `feat-tab-persistence` added them to partialize. `tabPersistence.test.ts` correctly proves they ARE persisted. The old test is misleading green.
- **Fix**: Update or delete stale assertions in persistence.test.ts.
- **Rust-first**: no
- **Directive**: yes

### perf-comments-panel-memo
- **Priority**: P2
- **Type**: perf
- **Quick win**: yes
- **Risk**: low
- **Found by**: perf
- **Location**: src/components/comments/CommentsPanel.tsx:17-27
- **Evidence**: 4 array allocations (groupCommentsIntoThreads + sort + 2× filter) on every render without useMemo. handleClick and handleKeyDown callbacks recreated every render.
- **Fix**: Wrap grouping/sorting/filtering in useMemo. Wrap handlers in useCallback.
- **Rust-first**: no
- **Directive**: no

### simplify-custom-event-bus
- **Priority**: P2
- **Type**: refactor
- **Quick win**: no
- **Risk**: medium
- **Found by**: react-tauri, architect
- **Location**: src/hooks/useFileWatcher.ts:62-64, SourceView.tsx:139, MarkdownViewer.tsx:367
- **Evidence**: `useFileWatcher` receives Tauri event and re-dispatches as DOM CustomEvent. Multiple components subscribe via addEventListener. After VM hooks, comment reloading is handled by direct Tauri event subscription in `useComments`. Only `useFileContent` still needs file-changed for content reload.
- **Fix**: After MVVM migration, simplify to Zustand signal or direct Tauri subscription in useFileContent only.
- **Rust-first**: no
- **Directive**: yes
- **Depends on**: migrate-viewers-to-vm-hooks

### security-enable-csp
- **Priority**: P2
- **Type**: security
- **Quick win**: yes
- **Risk**: medium
- **Found by**: security
- **Location**: src-tauri/tauri.conf.json:22-24
- **Evidence**: `"csp": null` disables all CSP. Combined with `dangerouslySetInnerHTML` in MermaidView, SourceView (shiki output). XSS in rendered content executes with full Tauri IPC access.
- **Fix**: Set restrictive CSP: `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' asset: data:; script-src 'self'`
- **Rust-first**: no
- **Directive**: no

### security-path-validation
- **Priority**: P2
- **Type**: security
- **Quick win**: no
- **Risk**: medium
- **Found by**: security
- **Location**: src-tauri/src/commands.rs:107-146
- **Evidence**: `read_text_file` and `read_binary_file` accept any path with zero validation. HTML asset resolution accepts `../` relative paths. Combined with no path validation, enables arbitrary file reads.
- **Fix**: Create shared `validate_path()` helper; apply to all file-accepting commands.
- **Rust-first**: already in Rust
- **Directive**: no
- **Failing test outline**:
```rust
#[test]
fn read_text_file_rejects_traversal() {
    let result = read_text_file("../../etc/passwd".to_string());
    assert!(result.is_err());
}
```

### refactor-sourceview-god-component
- **Priority**: P2
- **Type**: refactor
- **Quick win**: no
- **Risk**: medium
- **Found by**: architect
- **Location**: src/components/viewers/SourceView.tsx (470+ lines, 11 useState, 8 useEffect)
- **Evidence**: Manages highlighting, comments, search, folding, selection toolbar, keyboard shortcuts. 16 imports, 11 useState calls.
- **Fix**: Extract `useSyntaxHighlighting(content, path, theme)` and `useSelectionToolbar()` hooks. Comment logic handled by VM migration.
- **Rust-first**: no
- **Directive**: yes
- **Depends on**: migrate-viewers-to-vm-hooks

### perf-shiki-whole-doc
- **Priority**: P2
- **Type**: perf
- **Quick win**: no
- **Risk**: medium
- **Found by**: perf
- **Location**: src/components/viewers/SourceView.tsx:282-288
- **Evidence**: `codeToHtml()` called per line (5000 calls for 5K file). Loses cross-line syntax context.
- **Fix**: Call `codeToHtml` once for whole document, split resulting HTML by line.
- **Rust-first**: no
- **Directive**: no

### dead-ipc-wrappers
- **Priority**: P2
- **Type**: dead-code
- **Quick win**: yes
- **Risk**: low
- **Found by**: perf
- **Location**: src/lib/tauri-commands.ts
- **Evidence**: `matchCommentsToFile` (L118), `buildCommentThreads` (L124), `computeAnchorHash` (L176) have zero callers outside their declarations. Once `getFileComments` is wired in, these are redundant.
- **Fix**: Remove unused wrappers after migration confirms they're not needed.
- **Rust-first**: N/A
- **Directive**: yes
- **Depends on**: migrate-viewers-to-vm-hooks

### bug-unicode-truncation
- **Priority**: P2
- **Type**: bug
- **Quick win**: yes
- **Risk**: low
- **Found by**: security
- **Location**: src/lib/comment-utils.ts:17-20 ↔ src-tauri/src/core/anchors.rs:57-62
- **Evidence**: TS `truncateSelectedText` uses `text.length`/`text.slice()` (UTF-16 code units). Rust uses `text.chars().count()`/`.take()` (Unicode scalar values). For emoji/surrogates, different truncation points produce different SHA-256 hashes, causing anchor-matching failures.
- **Fix**: Move all truncation/hash to Rust via `compute_anchor_hash` command. Delete TS versions.
- **Rust-first**: already in Rust
- **Directive**: yes

### dedup-welcome-path-helpers
- **Priority**: P3
- **Type**: dead-code
- **Quick win**: yes
- **Risk**: low
- **Found by**: perf
- **Location**: src/components/WelcomeView.tsx:57-66
- **Evidence**: `getFileName()` and `getParentPath()` functionally identical to `basename()` and `dirname()` in `path-utils.ts`.
- **Fix**: Replace inline functions with imports from `@/lib/path-utils`.
- **Rust-first**: no
- **Directive**: yes

### remove-dead-collapse-all
- **Priority**: P3
- **Type**: dead-code
- **Quick win**: yes
- **Risk**: low
- **Found by**: perf
- **Location**: src/store/index.ts:165
- **Evidence**: `collapseAll` action has zero component consumers. Only used in `workspace.test.ts:47-69`.
- **Fix**: Remove action and its test, or wire into sidebar UI.
- **Rust-first**: no
- **Directive**: yes

### remove-dead-reset-commit-cache
- **Priority**: P3
- **Type**: dead-code
- **Quick win**: yes
- **Risk**: low
- **Found by**: security
- **Location**: src/hooks/useCommitEnricher.ts:13
- **Evidence**: `resetCommitCache()` exported but never imported anywhere.
- **Fix**: Remove export. Entire hook slated for deletion in delete-auto-save-hook.
- **Rust-first**: no
- **Directive**: yes

### simplify-search-hook
- **Priority**: P3
- **Type**: refactor
- **Quick win**: yes
- **Risk**: low
- **Found by**: react-tauri
- **Location**: src/hooks/useSearch.ts:11-38
- **Evidence**: Manual `useTransition` + `deferredQuery` state reimplements what `useDeferredValue` provides in one line.
- **Fix**: `const deferredQuery = useDeferredValue(query); const isPending = query !== deferredQuery;`
- **Rust-first**: no
- **Directive**: yes

### rust-html-asset-resolution
- **Priority**: P3
- **Type**: rust-migration
- **Quick win**: no
- **Risk**: medium
- **Found by**: react-tauri
- **Location**: src/lib/resolve-html-assets.ts:1-112
- **Evidence**: Makes N separate IPC calls per HTML view (one per img + stylesheet). Single Rust command eliminates ~2N round-trips.
- **Fix**: `#[tauri::command] fn resolve_html_assets(html: String, html_dir: String) -> Result<String, String>`
- **Rust-first**: yes
- **Directive**: no

### rust-fold-regions
- **Priority**: P3
- **Type**: rust-migration
- **Quick win**: no
- **Risk**: medium
- **Found by**: architect
- **Location**: src/lib/fold-regions.ts (118 lines)
- **Evidence**: Brace matching, string/comment stripping, indent fold computation — text processing that's more performant in Rust for large files.
- **Fix**: `#[tauri::command] fn compute_fold_regions(content: String) -> Vec<FoldRegion>`
- **Rust-first**: yes
- **Directive**: no

### security-sidecar-file-lock
- **Priority**: P3
- **Type**: security
- **Quick win**: no
- **Risk**: medium
- **Found by**: security
- **Location**: src-tauri/src/core/sidecar.rs:67-104
- **Evidence**: No per-file locking. Concurrent add_comment/save_review_comments on same file → load→modify→write race → data loss.
- **Fix**: `DashMap<String, Mutex<()>>` wrapping load+modify+save per file.
- **Rust-first**: already in Rust
- **Directive**: no
- **Failing test outline**:
```rust
#[tokio::test]
async fn concurrent_saves_dont_clobber() {
    // Spawn 10 concurrent add_comment calls on same file
    // Assert all 10 comments present in final sidecar
}
```

### feat-approval-workflow
- **Priority**: P3
- **Type**: feature
- **Quick win**: no
- **Risk**: medium
- **Found by**: product
- **Location**: src/store/index.ts (absent), src-tauri/src/commands.rs
- **Evidence**: Zero hits for approve/approval/reject in app code. No mechanism to mark files as reviewed.
- **Fix**: Add `status: Option<String>` to MrsfSidecar, Rust command `set_review_status`.
- **Rust-first**: yes
- **Directive**: no

### feat-comment-export
- **Priority**: P3
- **Type**: feature
- **Quick win**: no
- **Risk**: medium
- **Found by**: product
- **Location**: src-tauri/src/commands.rs:277
- **Evidence**: Zero hits for export. Comments only live in sidecar files. No way for AI agents to consume structured feedback.
- **Fix**: `#[tauri::command] fn export_review_summary(root: String) -> String`
- **Rust-first**: yes
- **Directive**: no

### arch-replace-dom-events
- **Priority**: P3
- **Type**: refactor
- **Quick win**: no
- **Risk**: medium
- **Found by**: react-tauri, architect
- **Location**: src/hooks/useFileWatcher.ts:41-45, SourceView.tsx:139-148, MarkdownViewer.tsx:370-379
- **Evidence**: `mdownreview:file-changed` and `scroll-to-line` CustomEvents bypass React data flow, invisible to DevTools. After VM hooks adoption, much of this is redundant.
- **Fix**: Use Zustand store for file-change signals and scroll targets.
- **Rust-first**: no
- **Directive**: yes
- **Depends on**: migrate-viewers-to-vm-hooks
