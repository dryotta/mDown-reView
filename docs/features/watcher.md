# File System Watcher

## What it is

While the user reviews files, mdownreview watches the workspace on disk. When a file the user is looking at changes — because the AI agent wrote a new version, or the user hit save in another editor — the tab refreshes. When a file is deleted, its tab flips to a "ghost" state that preserves any orphaned comments rather than silently discarding them.

## How it works

The Rust watcher (`notify-debouncer-mini`, canonical window defined in [`docs/performance.md`](../performance.md)) observes only the files and directories the UI has registered via `update_watched_files`. Events are debounced, deduplicated, then emitted as Tauri events addressed to the main window (never broadcast — per rule 4 in [`docs/architecture.md`](../architecture.md)).

On the React side, `useFileWatcher` installs one listener per visible tab and cleans it up on unmount. Rehydration uses the commands path (`read_text_file`, `check_path_exists`), not the event path, so bootstrap is deterministic even if events arrive before React's first `useEffect`.

Two debounce windows matter: the save-loop debounce (avoid re-triggering the watcher on our own sidecar writes) and the ghost-entry rescan (coalesce bursts of `deleted` events into one `scan_review_files`). Both windows are canonical in [`docs/performance.md`](../performance.md) and covered by isolation tests (rules 19 + 20 in [`docs/test-strategy.md`](../test-strategy.md)).

```mermaid
sequenceDiagram
    autonumber
    participant FS as Filesystem
    participant W as Rust watcher<br/>(notify-debouncer-mini)
    participant Cmd as commands.rs
    participant Hook as useFileWatcher
    participant Bus as window CustomEvent<br/>(mdownreview:file-changed)
    participant Tab as useFileContent
    FS->>W: write / rename / delete
    Note over W: 300 ms debounce<br/>(rule 4 perf.md)
    W->>Hook: emit_to("main", "file-changed")<br/>kind: content / review / deleted
    Hook->>Hook: save-loop check<br/>(< 1500 ms since local save? drop)
    Hook->>Bus: dispatch CustomEvent
    Bus->>Tab: reload via read_text_file
    Note over Hook: deleted bursts coalesced<br/>at 500 ms → scan_review_files
    Hook->>Cmd: scan_review_files (ghost rescan)
```

## Key source

- **Rust watcher:** `src-tauri/src/watcher.rs`
- **Rust command:** `src-tauri/src/watcher.rs` — `update_watched_files`; `src-tauri/src/commands/launch.rs` — `scan_review_files`
- **Hook:** `src/hooks/useFileWatcher.ts`
- **Store interactions:** `watcherSlice` in `src/store/index.ts`

## Related rules

- Debounce windows — rules 5 and 6 in [`docs/performance.md`](../performance.md).
- Commands mutate, events notify — rule 4 in [`docs/architecture.md`](../architecture.md).
- Listener cleanup on unmount (`unlisten` discipline) — [`docs/design-patterns.md`](../design-patterns.md).
- Debounce isolation tests — rules 19 + 20 in [`docs/test-strategy.md`](../test-strategy.md).
- Save-loop prevention — [`docs/security.md`](../security.md) §sidecar atomicity.
