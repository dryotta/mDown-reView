# Security & Reliability

Canonical for threat-model and safety rules. Cite violations as "violates rule N in `docs/security.md`". Charter: [`docs/principles.md`](principles.md).

## Principles

1. **Local-only, offline-first trust model.** No outbound calls except the signed updater check and user-initiated `openUrl` links. The IPC surface is local-trust only.
2. **Custom IPC commands replace `tauri-plugin-fs` scope.** File access is intentionally unscoped at the plugin layer and gated by command-level guards (size, binary, canonicalization). Every custom command enforces its own bounds.
3. **Rendered content is structurally sanitized by default.** Markdown renders without `rehype-raw`; any `dangerouslySetInnerHTML` is paired with an explicit sanitizer or produces output from a library whose output is known-safe.
4. **Atomic writes, never partial sidecars.** Comment persistence uses temp-write + rename so a crash or watcher race never leaves a half-written `.review.yaml`. The only acceptable failure is "no write".
5. **Fail closed, log, continue.** Command handlers return `Result<_, String>` and log; React renders behind `ErrorBoundary`; the Rust panic hook logs before propagating; promise rejections route to the log. A viewer never crashes to a blank window on malformed input.

## Rules

### File-read bounds
1. Every Rust command that opens a file enforces a 10 MB hard cap. (`commands.rs:114` in `read_text_file`; `:139` in `read_binary_file`.)
2. `read_text_file` rejects binaries by scanning the first 512 bytes for NUL, and only succeeds on valid UTF-8. (`commands.rs:120-128`.)
3. Size and binary checks happen on already-read bytes, not on `metadata()` before a second read (no TOCTOU). (`commands.rs:108` comment.)
4. `read_dir` canonicalizes the requested path and rejects any request whose canonical form differs from the canonicalized input. (`commands.rs:58-69`.)

### Sidecar atomicity & integrity
5. Sidecar writes are temp-file + atomic rename; a failed rename cleans up the temp file. (`core/sidecar.rs:91-101`.)
6. Saving an empty comment list deletes the sidecar rather than writing an empty YAML. (`core/sidecar.rs:74-79`.)
7. Sidecar loading prefers YAML over JSON and treats a missing file as `Ok(None)`, never an error. (`core/sidecar.rs:42-62`.)
8. Malformed YAML/JSON surfaces as a typed error (`SidecarError::YamlParse` / `JsonParse`), not a panic. (`core/sidecar.rs:45,57`.)

### Launch-args & CLI handling
9. The `LaunchArgsState` handler uses `.take()` so launch args are consumed exactly once. (`commands.rs:150-153`.)
10. Single-instance emits `args-received` only when `get_webview_window("main")` is `Some`. (`lib.rs:95-102`.)
11. CLI argument parsing canonicalizes every path via `std::fs::canonicalize` and silently drops paths that fail. (`lib.rs:24-44`.)

### Markdown rendering safety
12. No `rehype-raw` in markdown rendering; only `remarkGfm` and `rehypeSlug`. (`MarkdownViewer.tsx:387-388`.)
13. Markdown anchor clicks open only `http(s)` URLs, blocking `file://`, `javascript:`, etc. (`MarkdownViewer.tsx:146-148`.)
14. Local image `src` is piped through `convertFileSrc` so the WebView loads via `asset:`, never raw `file://`. (`MarkdownViewer.tsx:302-309`.)
15. Mermaid runs with `securityLevel: "strict"`. (`MermaidView.tsx:21`.)
16. `SourceView`'s `dangerouslySetInnerHTML` payload comes only from Shiki output, `escapeHtml`, or search highlight built from `escapeHtml`-segmented pieces. (`SourceView.tsx:184-190`; `useSourceHighlighting.ts:8-10`.)

### Process-level hardening
17. The CSP disallows inline scripts, `object`, `frame-ancestors`, and whitelists `asset:` for images only. (`tauri.conf.json:23`.)
18. The window requests only the minimal Tauri capability set: log, dialog open, clipboard write-text, opener open-url, updater. (`capabilities/default.json:5-16`.)
19. The updater verifies payloads via the configured minisign public key. (`tauri.conf.json:55`.)
20. `set_root_via_test` compiles out of release via `#[cfg(debug_assertions)]`. (`commands.rs:172`.)

### Watcher integrity
21. The watcher watches parent directories (not individual files) to survive atomic-rename saves, and emits only for paths on the current watch list. (`watcher.rs:146-169, 80-102`.) Debounce window: rule 4 in [`docs/performance.md`](performance.md).
22. Watcher bookkeeping stores both canonical and raw paths so deleted files (which cannot canonicalize) still match. (`watcher.rs:184-197`.)
23. Closing a tab evicts that path from `lastSaveByPath` so stale timestamps cannot suppress a later event. (`store/index.ts:156-159`.)

### Logging & crash capture
24. Release builds forward only `warn`/`error` from WebView `console.*` to the log. (`lib.rs:75-77`.)
25. Log rotation caps file size at 5 MB and keeps rotated files. (`lib.rs:55-56`.)
26. Rust panics are logged with location via a panic hook installed in `setup`. (`lib.rs:109-123`.)

### Cross-doc references
- IPC chokepoint: rule 1 in [`docs/architecture.md`](architecture.md).
- `window.onerror` at module scope before `createRoot`: rule 1 in [`docs/design-patterns.md`](design-patterns.md).
- `ErrorBoundary` wrapping: rule 2 in [`docs/design-patterns.md`](design-patterns.md).
- `read_dir` sidecar filtering: rule 22 in [`docs/architecture.md`](architecture.md).

## Gaps

- **No path-origin restriction on mutation commands.** `add_comment`, `edit_comment`, `delete_comment`, `set_comment_resolved`, `add_reply`, `get_file_comments` accept any `file_path` string; a confused renderer call could write `<any_path>.review.yaml`. Mitigation: allowlist against open tabs/root.
- **`check_path_exists` and `read_binary_file` lack the canonicalization guard used by `read_dir`** (`commands.rs:10-16, 133-146`). A symlink could redirect image loads outside the workspace.
- **Sidecar `selected_text` and `text` have no length limit** (`core/types.rs:17-45`); `load_sidecar` uses unbounded `fs::read_to_string`. A 50 MB comment would pass through SHA-256 + YAML ser.
- **Full file paths are logged unredacted** (`commands.rs:237`, `watcher.rs:158`). Shared logs leak workspace structure and usernames.
- **No MRSF schema version gate.** `load_sidecar` accepts any `mrsf_version`; a future-versioned sidecar may deserialize with silently dropped fields.
- **Mermaid SVG injected via `dangerouslySetInnerHTML`** (`MermaidView.tsx:89`) relies on upstream `securityLevel: "strict"` with no defense in depth.
- **Supply-chain rule is not codified.** No `deny.toml` / `cargo-deny` or npm audit gate in CI.
- **`patch_comment` in `core/sidecar.rs` is public and internally reachable.** Future wiring without `with_sidecar_mut` would bypass atomic-save.
- **Launch-args race on macOS "Open With"** (`lib.rs:258-287`): if `get_launch_args` fires between the `is_none` check and emit, files can be silently lost.
