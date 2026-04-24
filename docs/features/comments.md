# Review Comments

## What it is

The core workflow of the app: a user reviewing AI-generated files selects a span of text, leaves an inline comment, replies, resolves, and moves on. Comments are threaded, line-anchored, indestructible across refactors, and persisted to disk next to the reviewed file — never to a database or a cloud service.

## How it works

Persistence lives in per-file MRSF sidecars (`foo.md` → `foo.md.review.yaml`). The MRSF v1.0 schema, atomic write protocol, and sidecar lifecycle are defined in [`docs/architecture.md`](../architecture.md) and [`docs/security.md`](../security.md). Rust is the source of truth: React asks for comments via a typed command, renders them, and sends mutations back — the frontend never writes YAML.

Anchoring survives file edits through a 4-step algorithm — exact match at original line, full-document exact search, line fallback, fuzzy Levenshtein, then orphan. The algorithm is implemented in Rust core and specified in [`docs/architecture.md`](../architecture.md) §4-step re-anchoring. Orphaned comments never disappear silently — they surface in the `DeletedFileViewer` when their file is removed, and in an orphan banner when their anchor text no longer matches.

The UI surface is a selection toolbar that appears on text selection, a comment input, a threaded reply view, and an aggregated panel that summarises unresolved counts across the workspace. Line-gutter indicators in `SourceView` make every anchored comment discoverable at a glance.

```mermaid
sequenceDiagram
    autonumber
    participant UI as CommentInput / Thread
    participant VM as useCommentActions
    participant TC as lib/tauri-commands.ts
    participant Cmd as Rust commands.rs
    participant SC as MRSF sidecar (.review.yaml)
    participant W as watcher / listeners
    UI->>VM: addComment / editComment / addReply
    VM->>TC: typed wrapper
    TC->>Cmd: invoke("add_comment")
    Cmd->>Cmd: with_sidecar_mut<br/>load → mutate → re-anchor
    Cmd->>SC: temp-write + atomic rename
    Cmd-->>TC: Result<Comment, String>
    Cmd--)W: emit_to("main", "comments-changed")
    W-->>UI: useComments re-fetch via get_file_comments
```

## Key source

- **UI components:** `src/components/comments/{CommentInput,CommentThread,CommentsPanel,LineCommentMargin,SelectionToolbar}.tsx`
- **Hooks:** `src/hooks/{useSelectionToolbar,useThreadsByLine,useUnresolvedCounts}.ts`
- **Store slice:** `src/store/index.ts` — `commentsSlice`
- **Rust core:** `src-tauri/src/core/{comments.rs,threads.rs,anchors.rs,matching.rs,sidecar.rs,types.rs}`
- **Commands:** `src-tauri/src/commands/comments.rs` — `get_file_comments`, `add_comment`, `add_reply`, `edit_comment`, `delete_comment`, `set_comment_resolved`, `compute_anchor_hash`, `get_unresolved_counts`; `src-tauri/src/commands/launch.rs` — `scan_review_files`

## Related rules

- MRSF v1.0 schema + 4-step re-anchoring — [`docs/architecture.md`](../architecture.md).
- Atomic sidecar writes and save-loop prevention — [`docs/security.md`](../security.md) + [`docs/design-patterns.md`](../design-patterns.md).
- Anchor branches each need an integration test — rule 3 + rule 8 in [`docs/test-strategy.md`](../test-strategy.md).
- Comment-matching branch coverage — rule 3 in [`docs/test-strategy.md`](../test-strategy.md); round-trip MRSF test — rule 8.
- "Reliable" pillar (comments indestructible across refactors) and "Zero Bug Policy" — [`docs/principles.md`](../principles.md).
