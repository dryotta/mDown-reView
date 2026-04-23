---
generated_at: 2026-04-23T15:19:00-07:00
head_sha: aee160498371c274fc3ca9c4d1cdec2e228e7993
branch: main
directive: "clean up web layer code and fully embrace model and viewmodel from native; simplify code; remove duplicate and dead code; test coverage and validate; bigger changes welcome; goal is best possible client architecture"
---

# Expert Review Backlog

## Summary Table

| ID | Task | Priority | Type | Quick Win | Expert | Files | Risk | Has Test Outline | Directive-Aligned | Status |
|----|------|----------|------|-----------|--------|-------|------|------------------|-------------------|--------|
| bug-dead-comments-by-file | Fix commentsByFile never populated → badges always 0, then remove dead slice | P1 | bug+dead-code | no | all 6 | store/index.ts, FolderTree.tsx, TabBar.tsx | medium | yes | yes | open |
| bug-highlight-race | Fix useSourceHighlighting async race (stale results overwrite) | P1 | bug | yes | react-tauri, bug-hunter | hooks/useSourceHighlighting.ts | low | yes | no | done |
| delete-comment-threads-ts | Delete TS comment-threads.ts, pass Rust threads by line | P1 | dead-code | yes | architect, product, perf, bug-hunter, react-tauri | lib/comment-threads.ts, LineCommentMargin.tsx, MarkdownViewer.tsx | medium | no | yes | open |
| delete-comment-anchors-ts | Delete TS comment-anchors.ts, wire Rust compute_anchor_hash | P1 | dead-code+rust-first | yes | architect, product, perf, bug-hunter, react-tauri | lib/comment-anchors.ts, useSelectionToolbar.ts, LineCommentMargin.tsx, MarkdownViewer.tsx | low | no | yes | done |
| simplify-comment-utils-ts | Remove Rust-duplicated functions from comment-utils.ts | P1 | dead-code | yes | architect, bug-hunter, react-tauri | lib/comment-utils.ts | low | no | yes | done |
| dead-rust-commands | Remove 7 unused Rust IPC commands from lib.rs and commands.rs | P1 | dead-code+security | yes | bug-hunter, security, product, react-tauri | src-tauri/src/lib.rs, commands.rs | low | no | yes | done |
| delete-comments-slice | Remove CommentsSlice entirely, move authorName to UISlice | P1 | refactor | yes | architect, product, react-tauri | store/index.ts | low | no | yes | done |
| standardize-matched-comment | Replace CommentWithOrphan with MatchedComment everywhere | P1 | refactor | yes | architect, product, react-tauri | store/index.ts, CommentThread.tsx, LineCommentMargin.tsx | low | no | yes | open |
| rust-unresolved-counts | Add batch Rust command for badge unresolved counts | P1 | rust-first | no | architect, product, perf, react-tauri | src-tauri/src/commands.rs, FolderTree.tsx, TabBar.tsx | medium | yes | yes | open |
| refactor-markdownviewer-hooks | Extract shared hooks from MarkdownViewer (selection, comments-by-line, scroll) | P1 | refactor | no | architect, product | MarkdownViewer.tsx, useSelectionToolbar.ts | medium | no | yes | open |
| perf-memo-usecomments-flatmap | Add useMemo to useComments flatMap of threads | P2 | perf | yes | perf | lib/vm/use-comments.ts | low | no | yes | open |
| perf-shiki-whole-doc | Switch Shiki from per-line to whole-document highlighting | P2 | perf | no | perf | hooks/useSourceHighlighting.ts | medium | yes | no | open |
| extract-use-theme | Extract shared useTheme hook from duplicate MutationObserver pattern | P2 | refactor | yes | product | useSourceHighlighting.ts, MarkdownViewer.tsx | low | no | yes | open |
| dedup-size-warn-threshold | Extract shared SIZE_WARN_THRESHOLD constant | P2 | dead-code | yes | product | SourceView.tsx, MarkdownViewer.tsx | low | no | yes | open |
| standardize-listen-cleanup | Standardize Tauri listen() cleanup pattern across all hooks | P2 | bug | no | react-tauri, bug-hunter | useFileWatcher.ts, App.tsx, use-comments.ts | medium | yes | yes | open |
| refactor-rust-mutation-boilerplate | Extract with_sidecar_mut helper for 5 Rust mutation commands | P2 | refactor | yes | react-tauri | src-tauri/src/commands.rs | low | no | yes | open |
| dedup-lib-rs-handlers | Deduplicate invoke_handler debug/release blocks in lib.rs | P2 | refactor | yes | react-tauri | src-tauri/src/lib.rs | low | no | yes | open |
| test-line-comment-margin | Add tests for LineCommentMargin (zero coverage) | P2 | test | no | bug-hunter | components/comments/LineCommentMargin.tsx | low | yes | yes | open |
| dead-vite-css | Remove Vite boilerplate CSS selectors from App.css | P2 | dead-code | yes | bug-hunter | src/App.css | low | no | yes | open |
| extract-app-icons | Extract inline SVG icons from App.tsx to shared module | P2 | refactor | yes | architect | App.tsx | low | no | yes | open |
| simplify-customevent-bridge | Replace DOM CustomEvent bridges with direct Tauri/Zustand signals | P2 | refactor | no | react-tauri, architect | useFileWatcher.ts, useFileContent.ts, CommentsPanel.tsx | medium | no | yes | open |
| security-shellopen-scheme | Validate URL scheme before shellOpen in MarkdownViewer | P2 | security | yes | security | MarkdownViewer.tsx | low | no | no | open |
| security-mermaid-strict | Add securityLevel: strict to Mermaid init | P2 | security | yes | security | MermaidView.tsx | low | no | no | open |
| security-iframe-sandbox | Fix iframe sandbox allow-same-origin + allow-scripts combo | P2 | security | yes | security | HtmlPreviewView.tsx | low | no | no | open |
| security-csp-extend | Add object-src, base-uri, frame-src to CSP | P2 | security | yes | security | src-tauri/tauri.conf.json | low | no | no | open |
| simplify-usecomments-dual-load | Merge duplicate load/effect in useComments into single mechanism | P3 | refactor | yes | react-tauri, product | lib/vm/use-comments.ts | low | no | yes | open |
| bug-file-comments-swallow-error | Handle file-read errors in get_file_comments instead of unwrap_or_default | P3 | bug | yes | bug-hunter | src-tauri/src/commands.rs | low | yes | no | open |
| security-path-validation | Add workspace root path validation to all Rust commands | P3 | security | no | security | src-tauri/src/commands.rs | high | yes | no | open |
| test-app-tsx | Add tests for App.tsx keyboard shortcuts and event listeners | P3 | test | no | bug-hunter | App.tsx | low | no | yes | open |
| perf-virtualize-sourceview | Add windowing/virtualization to SourceView for large files | P3 | perf | no | perf | SourceView.tsx | high | no | no | open |
| security-serde-yaml-deprecation | Migrate from deprecated serde_yaml to maintained fork | P3 | security | no | security | src-tauri/Cargo.toml | medium | no | no | open |

<!-- Status values: open, done, failed, skipped -->

---

## Task Details

### bug-dead-comments-by-file
- **Priority**: P1
- **Type**: bug + dead-code
- **Quick win**: no (touches 5+ files)
- **Risk**: medium
- **Found by**: all 6 experts (consensus)
- **Location**: store/index.ts:54,187,282-285, FolderTree.tsx:301, TabBar.tsx:9
- **Evidence**: `commentsByFile` initialized as `{}` and never populated after MVVM migration (commit bae107a removed mutations). `useUnresolvedCount` (store/index.ts:282-285) always returns 0. FolderTree.tsx:301 reads `commentsByFile[path]` — always `[]`. Tab badges and folder tree comment badges are permanently broken. All 6 experts independently confirmed this.
- **Fix**: Two-phase: (1) Add `get_unresolved_counts` Rust batch command. (2) Replace `useUnresolvedCount` and FolderTree badge logic with calls to the new command. Then delete `commentsByFile`, `CommentWithOrphan`, and `useUnresolvedCount` from the store. Move `authorName`/`setAuthorName` to UISlice. Delete CommentsSlice.
- **Rust-first**: yes — new batch command
- **Directive**: yes
- **Failing test outline**:
```typescript
it("TabBar shows comment badge when file has unresolved comments", () => {
  // Mock getUnresolvedCounts to return { "/test.md": 2 }
  // Render TabBar with tab for /test.md
  // Assert badge shows "2" — currently always 0
});
```

### bug-highlight-race
- **Priority**: P1
- **Type**: bug
- **Quick win**: yes
- **Risk**: low
- **Found by**: react-tauri, bug-hunter
- **Location**: src/hooks/useSourceHighlighting.ts:43-68
- **Evidence**: The highlight effect calls `getSharedHighlighter()` (async) then `setHighlightedLines(...)` with no cancellation guard. On rapid content/path changes, stale promise resolution overwrites current results. Unlike useComments which has a `cancelled` flag (line 46), this effect has none.
- **Fix**: Add `let cancelled = false` guard in the effect, check before `setHighlightedLines`.
- **Rust-first**: no
- **Directive**: no
- **Failing test outline**:
```typescript
it("does not apply stale highlight results after rapid path changes", async () => {
  const { rerender } = renderHook(({ content, path }) => useSourceHighlighting(content, path),
    { initialProps: { content: "const x = 1;", path: "a.ts" } });
  rerender({ content: "print('hello')", path: "b.py" });
  await act(async () => { await new Promise(r => setTimeout(r, 200)); });
  // Result should be for b.py, not stale a.ts
});
```

### delete-comment-threads-ts
- **Priority**: P1
- **Type**: dead-code
- **Quick win**: yes
- **Risk**: medium
- **Found by**: architect, product, perf, bug-hunter, react-tauri (5 experts)
- **Location**: src/lib/comment-threads.ts:13-41, LineCommentMargin.tsx:5,53, MarkdownViewer.tsx:29,247
- **Evidence**: Rust `get_file_comments` already returns `CommentThread[]`. The useComments hook flattens them (use-comments.ts:100) then LineCommentMargin and MarkdownViewer re-thread with the TS function — a flatten→re-thread antipattern. Identical algorithm to Rust `core::threads::group_into_threads()`.
- **Fix**: Build `threadsByLine: Map<number, CommentThread[]>` directly from the already-threaded data in useComments. Pass `CommentThread[]` to LineCommentMargin and MarkdownViewer instead of flat `MatchedComment[]`. Delete `comment-threads.ts`.
- **Rust-first**: already in Rust
- **Directive**: yes

### delete-comment-anchors-ts
- **Priority**: P1
- **Type**: dead-code + rust-first
- **Quick win**: yes
- **Risk**: low
- **Found by**: architect, product, perf, bug-hunter, react-tauri (5 experts)
- **Location**: src/lib/comment-anchors.ts:3-9, useSelectionToolbar.ts:75, LineCommentMargin.tsx:37, MarkdownViewer.tsx:420
- **Evidence**: TS `computeSelectedTextHash` uses Web Crypto SHA-256. Rust already has `compute_anchor_hash` command (commands.rs:468-472) but it's never called from TS. Three TS call sites use the local version. Having two implementations risks hash divergence.
- **Fix**: Add `computeAnchorHash` wrapper to tauri-commands.ts. Replace 3 call sites. Delete `comment-anchors.ts`.
- **Rust-first**: yes — use existing Rust command
- **Directive**: yes

### simplify-comment-utils-ts
- **Priority**: P1
- **Type**: dead-code
- **Quick win**: yes
- **Risk**: low
- **Found by**: architect, bug-hunter, react-tauri
- **Location**: src/lib/comment-utils.ts:6-54
- **Evidence**: `truncateSelectedText()` and `validateTargetingFields()` duplicate Rust `core::anchors.rs:56-81`. Since all mutations go through Rust commands, the TS-side truncation (called in LineCommentMargin:36 and useSelectionToolbar:74) is redundant — Rust already truncates before saving. `generateCommentId()` is unused in production since Phase 2. `TEXT_MAX_LENGTH` constant is unused in production.
- **Fix**: Keep only `SELECTED_TEXT_MAX_LENGTH` and `TEXT_MAX_LENGTH` constants for UI input limits. Remove `truncateSelectedText`, `validateTargetingFields`, `generateCommentId`. Update `LineCommentMargin` and `useSelectionToolbar` to pass raw text to Rust.
- **Rust-first**: already in Rust
- **Directive**: yes

### dead-rust-commands
- **Priority**: P1
- **Type**: dead-code + security
- **Quick win**: yes
- **Risk**: low
- **Found by**: bug-hunter, security, product, react-tauri (4 experts)
- **Location**: src-tauri/src/lib.rs:225-270, src-tauri/src/commands.rs
- **Evidence**: 7 Rust commands registered in invoke_handler but with zero TS callers: `save_review_comments`, `load_review_comments`, `get_git_head`, `compute_document_path`, `match_comments_to_file`, `build_comment_threads`, `compute_anchor_hash` (TS uses own impl). Each is unnecessary attack surface. Security expert specifically flagged `save_review_comments` (arbitrary file write) and `load_review_comments` (arbitrary file read).
- **Fix**: Remove from both debug and release `generate_handler![]` blocks. Keep `compute_anchor_hash` if wiring it to TS (see delete-comment-anchors-ts). Delete unused Rust functions.
- **Rust-first**: N/A (deletion)
- **Directive**: yes

### delete-comments-slice
- **Priority**: P1
- **Type**: refactor
- **Quick win**: yes
- **Risk**: low (after bug-dead-comments-by-file)
- **Found by**: architect, product, react-tauri
- **Location**: store/index.ts:48-57,187
- **Evidence**: After fixing badge consumers, the entire CommentsSlice is dead: `commentsByFile` removed, only `authorName`/`setAuthorName` remain. These are user preferences, belonging in UISlice.
- **Fix**: Move `authorName`/`setAuthorName` to UISlice. Delete CommentsSlice interface and implementation. Delete `CommentWithOrphan` type.
- **Rust-first**: no
- **Directive**: yes
- **Depends on**: bug-dead-comments-by-file

### standardize-matched-comment
- **Priority**: P1
- **Type**: refactor
- **Quick win**: yes
- **Risk**: low
- **Found by**: architect, product, react-tauri
- **Location**: store/index.ts:48-51, CommentThread.tsx:4, LineCommentMargin.tsx, comment-threads.ts
- **Evidence**: `CommentWithOrphan extends MrsfComment` has optional `isOrphaned?` and `matchedLineNumber?`. Rust-returned `MatchedComment extends MrsfComment` has non-optional versions plus `anchoredText?`. After MVVM migration, `MatchedComment` is canonical. 7 files still import `CommentWithOrphan`.
- **Fix**: Replace all `CommentWithOrphan` usage with `MatchedComment`. Delete `CommentWithOrphan` from store.
- **Rust-first**: no (type alignment)
- **Directive**: yes
- **Depends on**: delete-comments-slice

### rust-unresolved-counts
- **Priority**: P1
- **Type**: rust-first
- **Quick win**: no
- **Risk**: medium
- **Found by**: architect, product, perf, react-tauri
- **Location**: src-tauri/src/commands.rs (new), FolderTree.tsx:301, TabBar.tsx:9
- **Evidence**: After removing `commentsByFile`, tab/tree badges need a data source. Making N individual `get_file_comments` calls per visible node is expensive. A batch command is needed.
- **Fix**: Add `get_unresolved_counts(file_paths: Vec<String>) -> Vec<(String, u32)>` Rust command. Load sidecar per file, count unresolved, return batch. Create `useUnresolvedCounts` hook. Wire into FolderTree and TabBar.
- **Rust-first**: yes
- **Directive**: yes
- **Depends on**: bug-dead-comments-by-file
- **Failing test outline**:
```rust
#[test]
fn get_unresolved_counts_returns_correct_counts() {
    // Create temp files with sidecars containing 2 unresolved, 1 resolved
    // Call get_unresolved_counts with those paths
    // Assert: returns [(path, 2)]
}
```

### refactor-markdownviewer-hooks
- **Priority**: P1
- **Type**: refactor
- **Quick win**: no
- **Risk**: medium
- **Found by**: architect, product
- **Location**: MarkdownViewer.tsx:286-431
- **Evidence**: MarkdownViewer (436 lines) reimplements: selection toolbar state/mouse handling (286-431, same as useSelectionToolbar hook), commentsByLine grouping (299-307, identical to SourceView:77-86), scroll-to-line listener (327-341, identical to SourceView:97-112), pendingSelectionAnchor management. The SourceView extraction (commit 70334c8) created shared hooks but MarkdownViewer was not migrated.
- **Fix**: Reuse `useSelectionToolbar` in MarkdownViewer (or generalize it). Extract shared `commentsByLine` grouping. Extract shared `useScrollToLine`. Target: 436 → ~250 lines.
- **Rust-first**: no
- **Directive**: yes

### perf-memo-usecomments-flatmap
- **Priority**: P2
- **Type**: perf
- **Quick win**: yes
- **Risk**: low
- **Found by**: perf
- **Location**: src/lib/vm/use-comments.ts:100-104
- **Evidence**: `threads.flatMap(t => [t.root, ...t.replies])` runs on every render (no useMemo). Creates new array reference, causing downstream useMemo deps (commentsByLine in SourceView:77, MarkdownViewer:299) to fire unnecessarily.
- **Fix**: Wrap in `useMemo(() => threads.flatMap(...), [threads])`.
- **Rust-first**: no
- **Directive**: yes

### perf-shiki-whole-doc
- **Priority**: P2
- **Type**: perf
- **Quick win**: no
- **Risk**: medium
- **Found by**: perf
- **Location**: src/hooks/useSourceHighlighting.ts:59-62
- **Evidence**: `codeToHtml()` called per line (5000 separate Shiki invocations for a 5K-line file). Each creates a HAST tree, runs tokenizer, serializes HTML. Also breaks cross-line syntax context (multi-line strings, block comments highlight incorrectly).
- **Fix**: Call `codeToHtml` once for full content, split HTML by `<span class="line">` boundaries. Benchmark to verify improvement.
- **Rust-first**: no (Shiki is JS/WASM)
- **Directive**: no
- **Failing test outline**:
```typescript
// Vitest bench
bench('per-line (current)', async () => { /* 5000 codeToHtml calls */ });
bench('whole-document (proposed)', async () => { /* 1 codeToHtml call */ });
```

### extract-use-theme
- **Priority**: P2
- **Type**: refactor
- **Quick win**: yes
- **Risk**: low
- **Found by**: product
- **Location**: useSourceHighlighting.ts:31-39, MarkdownViewer.tsx:70-79
- **Evidence**: Both set up MutationObserver on `document.documentElement` to track `data-theme`, map "dark" → "github-dark". Identical 10+ line blocks.
- **Fix**: Extract `useTheme()` hook returning Shiki theme name. Replace both usages. ~20 lines removed.
- **Rust-first**: no
- **Directive**: yes

### dedup-size-warn-threshold
- **Priority**: P2
- **Type**: dead-code
- **Quick win**: yes
- **Risk**: low
- **Found by**: product
- **Location**: SourceView.tsx:13, MarkdownViewer.tsx:36
- **Evidence**: `const SIZE_WARN_THRESHOLD = 500 * 1024;` defined identically in both files.
- **Fix**: Extract to `lib/constants.ts` or shared viewer util.
- **Rust-first**: no
- **Directive**: yes

### standardize-listen-cleanup
- **Priority**: P2
- **Type**: bug
- **Quick win**: no
- **Risk**: medium
- **Found by**: react-tauri, bug-hunter
- **Location**: useFileWatcher.ts:75-76, App.tsx:167-168, App.tsx:307-308, use-comments.ts:76,96
- **Evidence**: All Tauri `listen()` subs use `return () => { unlisten.then(fn => fn()); }`. If component unmounts before promise resolves, there's a window where events fire on stale callbacks. Commit 195b378 fixed use-comments.ts but the pattern persists in useFileWatcher and App.tsx.
- **Fix**: Standardize pattern: `let mounted = true; listen(...).then(fn => { if (mounted) unlistenFn = fn; else fn(); }); return () => { mounted = false; unlistenFn?.(); };` Extract as `useTauriListener` utility hook.
- **Rust-first**: no
- **Directive**: yes
- **Failing test outline**:
```typescript
it("cleans up listener even when listen resolves after unmount", async () => {
  // Delay listen() resolution, unmount, resolve, verify unlisten called
});
```

### refactor-rust-mutation-boilerplate
- **Priority**: P2
- **Type**: refactor
- **Quick win**: yes
- **Risk**: low
- **Found by**: react-tauri
- **Location**: src-tauri/src/commands.rs:312-466
- **Evidence**: 5 mutation commands (add_comment, add_reply, edit_comment, delete_comment, set_comment_resolved) duplicate load-sidecar → mutate → save → emit pattern (~15 lines each).
- **Fix**: Extract `with_sidecar_mut(app, file_path, |sidecar| { ... })` helper.
- **Rust-first**: yes
- **Directive**: yes

### dedup-lib-rs-handlers
- **Priority**: P2
- **Type**: refactor
- **Quick win**: yes
- **Risk**: low
- **Found by**: react-tauri
- **Location**: src-tauri/src/lib.rs:219-274
- **Evidence**: Debug and release `generate_handler![]` blocks repeat 20+ command registrations. Only `set_root_via_test` differs. Adding a command requires editing two blocks.
- **Fix**: Build handler list conditionally, add `set_root_via_test` only under `#[cfg(debug_assertions)]`.
- **Rust-first**: yes
- **Directive**: yes

### test-line-comment-margin
- **Priority**: P2
- **Type**: test
- **Quick win**: no
- **Risk**: low
- **Found by**: bug-hunter
- **Location**: src/components/comments/LineCommentMargin.tsx (no test file exists)
- **Evidence**: Zero test coverage for LineCommentMargin. Untested paths: handleSave async anchor creation, expand/collapse toggle, "Add comment" button visibility, null/empty matchedComments edge case.
- **Fix**: Create `__tests__/LineCommentMargin.test.tsx` with coverage for core interactions.
- **Rust-first**: no
- **Directive**: yes

### dead-vite-css
- **Priority**: P2
- **Type**: dead-code
- **Quick win**: yes
- **Risk**: low
- **Found by**: bug-hunter
- **Location**: src/App.css:1-7,24-47,94-96
- **Evidence**: Dead selectors from Tauri starter template: `.logo.vite`, `.logo.react`, `.container`, `.logo`, `.logo.tauri`, `.row`, `#greet-input`. None of these class names exist in src/.
- **Fix**: Delete dead selectors.
- **Rust-first**: no
- **Directive**: yes

### extract-app-icons
- **Priority**: P2
- **Type**: refactor
- **Quick win**: yes
- **Risk**: low
- **Found by**: architect
- **Location**: App.tsx:25-93
- **Evidence**: ~70 lines of inline SVG component definitions (IconFile, IconFolder, IconComment, IconSun, IconMoon, IconAuto, IconInfo) with zero logic. App.tsx is 404 lines.
- **Fix**: Move to `src/components/icons/ToolbarIcons.tsx`. App.tsx → ~330 lines.
- **Rust-first**: no
- **Directive**: yes

### simplify-customevent-bridge
- **Priority**: P2
- **Type**: refactor
- **Quick win**: no
- **Risk**: medium
- **Found by**: react-tauri, architect
- **Location**: useFileWatcher.ts:62-66, useFileContent.ts:19-27, CommentsPanel.tsx:31, SourceView.tsx:97-112, MarkdownViewer.tsx:327-340
- **Evidence**: Two DOM CustomEvent bridges: (1) useFileWatcher converts Tauri file-changed → DOM mdownreview:file-changed → useFileContent listens. Extra hop unnecessary. (2) CommentsPanel dispatches scroll-to-line → viewers listen. Untraceable data flow, no TypeScript type safety.
- **Fix**: For (1): useFileContent listens directly to Tauri event. For (2): use Zustand store for scroll targets or callback props.
- **Rust-first**: no
- **Directive**: yes

### security-shellopen-scheme
- **Priority**: P2
- **Type**: security
- **Quick win**: yes
- **Risk**: low
- **Found by**: security
- **Location**: src/components/viewers/MarkdownViewer.tsx:154
- **Evidence**: `shellOpen(href)` passes unvalidated URLs to OS opener. Crafted markdown can contain `file:///`, `smb://`, `ms-msdt:`, or custom protocol URLs triggering OS-level behavior.
- **Fix**: `if (/^https?:\/\//i.test(href)) shellOpen(href);`
- **Rust-first**: no
- **Directive**: no

### security-mermaid-strict
- **Priority**: P2
- **Type**: security
- **Quick win**: yes
- **Risk**: low
- **Found by**: security
- **Location**: src/components/viewers/MermaidView.tsx:21
- **Evidence**: `mermaid.initialize({ startOnLoad: false, theme: "default" })` — `securityLevel` not explicitly set. Relies on Mermaid v10+ default of `'strict'`. Mermaid has had historical XSS CVEs.
- **Fix**: Add `securityLevel: "strict"` to initialize call.
- **Rust-first**: no
- **Directive**: no

### security-iframe-sandbox
- **Priority**: P2
- **Type**: security
- **Quick win**: yes
- **Risk**: low
- **Found by**: security
- **Location**: src/components/viewers/HtmlPreviewView.tsx:13
- **Evidence**: Unsafe mode sets `sandbox="allow-same-origin allow-scripts"`. This combination allows framed content to escape the sandbox entirely per MDN docs.
- **Fix**: Change unsafe mode to `"allow-scripts"` only (without `allow-same-origin`).
- **Rust-first**: no
- **Directive**: no

### security-csp-extend
- **Priority**: P2
- **Type**: security
- **Quick win**: yes
- **Risk**: low
- **Found by**: security
- **Location**: src-tauri/tauri.conf.json:23
- **Evidence**: CSP missing `object-src 'none'`, `base-uri 'self'`, `frame-src 'none'`.
- **Fix**: Append these directives to existing CSP string.
- **Rust-first**: no
- **Directive**: no

### simplify-usecomments-dual-load
- **Priority**: P3
- **Type**: refactor
- **Quick win**: yes
- **Risk**: low
- **Found by**: react-tauri, product
- **Location**: src/lib/vm/use-comments.ts:27-64
- **Evidence**: The `load` callback (27-42) and `useEffect` IIFE (44-64) both call `getFileComments(filePath)` and set threads. Duplicate cancellation logic. The effect should just call `load()`.
- **Fix**: Merge into single loading mechanism. Effect calls `load()` with ref-based cancellation token.
- **Rust-first**: no
- **Directive**: yes

### bug-file-comments-swallow-error
- **Priority**: P3
- **Type**: bug
- **Quick win**: yes
- **Risk**: low
- **Found by**: bug-hunter
- **Location**: src-tauri/src/commands.rs:283
- **Evidence**: `std::fs::read_to_string(&file_path).unwrap_or_default()` — if source file can't be read (permissions, encoding), content becomes "" and all comments become orphans silently.
- **Fix**: Return error or log warning when source file read fails.
- **Rust-first**: yes
- **Directive**: no
- **Failing test outline**:
```rust
#[test]
fn get_file_comments_reports_error_on_unreadable_file() {
    // Create sidecar but make source file unreadable
    // Assert: returns error or includes warning in response
}
```

### security-path-validation
- **Priority**: P3
- **Type**: security
- **Quick win**: no
- **Risk**: high
- **Found by**: security
- **Location**: src-tauri/src/commands.rs (all file-accepting commands)
- **Evidence**: read_text_file, read_binary_file, read_dir, scan_review_files, all sidecar commands accept arbitrary paths. A compromised WebView can read/write any file. read_dir has a traversal check that is a no-op (canonicalize called on same input twice).
- **Fix**: Create `validate_within_workspace(path, roots)` helper. Store workspace roots in Tauri managed state. Call at top of every file-touching command.
- **Rust-first**: yes
- **Directive**: no
- **Failing test outline**:
```rust
#[test]
fn read_text_file_rejects_path_outside_workspace() {
    // Set workspace root to /tmp/test
    // Call read_text_file with /etc/passwd
    // Assert: error "path outside workspace"
}
```

### test-app-tsx
- **Priority**: P3
- **Type**: test
- **Quick win**: no
- **Risk**: low
- **Found by**: bug-hunter
- **Location**: src/App.tsx (no test file exists)
- **Evidence**: Zero tests for App.tsx. Untested: global keyboard shortcuts (Ctrl+O, theme cycle), drag-resize folder pane, update check flow, 12 menu event listeners.
- **Fix**: Create `__tests__/App.test.tsx` with coverage for keyboard shortcuts and core layout.
- **Rust-first**: no
- **Directive**: yes

### perf-virtualize-sourceview
- **Priority**: P3
- **Type**: perf
- **Quick win**: no
- **Risk**: high
- **Found by**: perf
- **Location**: src/components/viewers/SourceView.tsx:151-251
- **Evidence**: Renders ALL lines in DOM (10,000+ DOM nodes for large files). No windowing/virtualization. Interacts with code folding, search highlighting, and comment margins.
- **Fix**: Add `@tanstack/virtual` or `react-window`. Only render visible lines (~50-100). Significant architectural change.
- **Rust-first**: no
- **Directive**: no

### security-serde-yaml-deprecation
- **Priority**: P3
- **Type**: security
- **Quick win**: no
- **Risk**: medium
- **Found by**: security
- **Location**: src-tauri/Cargo.toml:43
- **Evidence**: `serde_yaml` 0.9 is officially deprecated by its author (dtolnay). No security patches. Used to parse `.review.yaml` sidecar files — untrusted content.
- **Fix**: Migrate to `serde_yml` (community fork) or `yaml-rust2`.
- **Rust-first**: yes
- **Directive**: no
