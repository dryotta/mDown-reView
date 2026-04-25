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
1. Every Rust command that opens a file enforces a 10 MB hard cap. (`commands/fs.rs:91-94` in `read_text_file`; `:120-123` in `read_binary_file`.)
2. `read_text_file` rejects binaries by scanning the first 512 bytes for NUL, and only succeeds on valid UTF-8. (`commands/fs.rs:96-100, 103-106`.)
3. Size and binary checks happen on already-read bytes, not on `metadata()` before a second read (no TOCTOU). (`commands/fs.rs:85` comment.)
4. `read_dir` canonicalizes the requested path and rejects any request whose canonical form differs from the canonicalized input. (`commands/fs.rs:19-32`.)

### Sidecar atomicity & integrity
5. Sidecar writes are temp-file + atomic rename; a failed rename cleans up the temp file. (`core/sidecar.rs:91-101`.)
6. Saving an empty comment list deletes the sidecar rather than writing an empty YAML. (`core/sidecar.rs:74-79`.)
7. Sidecar loading prefers YAML over JSON and treats a missing file as `Ok(None)`, never an error. (`core/sidecar.rs:42-62`.)
8. Malformed YAML/JSON surfaces as a typed error (`SidecarError::YamlParse` / `JsonParse`), not a panic. (`core/sidecar.rs:45,57`.)

### Launch-args & CLI handling
9. The `get_launch_args` handler drains a pending-args queue (`PendingArgsState`) so each batch of launch args is consumed exactly once. (`commands/launch.rs:15-55`.)
10. Single-instance emits `args-received` only when `get_webview_window("main")` is `Some`. (`lib.rs:95-102`.)
11. CLI argument parsing canonicalizes every path via `std::fs::canonicalize` and silently drops paths that fail. (`commands/launch.rs:68-125`; sidecar resolution under `core/paths.rs::resolve_sidecar` adds stricter folder-root containment.)

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
20. `set_root_via_test` compiles out of release via `#[cfg(debug_assertions)]`. (`commands/launch.rs:31-33`.)

### Watcher integrity
21. The watcher watches parent directories (not individual files) to survive atomic-rename saves, and emits only for paths on the current watch list. (`watcher.rs:146-169, 80-102`.) Debounce window: rule 4 in [`docs/performance.md`](performance.md).
22. Watcher bookkeeping stores both canonical and raw paths so deleted files (which cannot canonicalize) still match. (`watcher.rs:184-197`.)
23. Closing a tab evicts that path from `lastSaveByPath` so stale timestamps cannot suppress a later event. (`store/index.ts:156-159`.)

### Logging & crash capture
24. Release builds forward only `warn`/`error` from WebView `console.*` to the log. (`lib.rs:75-77`.)
25. Log rotation caps file size at 5 MB and keeps rotated files. (`lib.rs:55-56`.)
26. Rust panics are logged with location via a panic hook installed in `setup`. (`lib.rs:109-123`.)

### Remote asset fetching
27. `fetch_remote_asset` enforces five bounds before returning bytes to the renderer: (a) URL must parse and use scheme `https` (`http`, `file`, `javascript`, `data` rejected); (b) connect + read timeouts are 10 s each via a single shared `reqwest::Client`; (c) body is streamed and aborted on overflow at an 8 MB cap; (d) `Content-Type` (sans parameters) must match the image allowlist `image/{png,jpeg,gif,webp,svg+xml,avif}`; (e) HTTP status must equal 200. Bytes are handed to the frontend and converted to a `blob:` URL — the CSP `img-src`/`connect-src` directives are never widened to permit remote origins. (`commands/remote_asset.rs`.)

### Cross-doc references
- IPC chokepoint: rule 1 in [`docs/architecture.md`](architecture.md).
- `window.onerror` at module scope before `createRoot`: rule 1 in [`docs/design-patterns.md`](design-patterns.md).
- `ErrorBoundary` wrapping: rule 2 in [`docs/design-patterns.md`](design-patterns.md).
- `read_dir` sidecar filtering: rule 22 in [`docs/architecture.md`](architecture.md).

## Gaps

- **No path-origin restriction on mutation commands.** `add_comment`, `edit_comment`, `delete_comment`, `set_comment_resolved`, `add_reply`, `get_file_comments` accept any `file_path` string; a confused renderer call could write `<any_path>.review.yaml`. Mitigation: allowlist against open tabs/root.
- **`check_path_exists` and `read_binary_file` lack the canonicalization guard used by `read_dir`** (`commands/fs.rs:9-15, 96-109`). A symlink could redirect image loads outside the workspace.
- **Sidecar `selected_text` and `text` have no length limit** (`core/types.rs:17-45`); `load_sidecar` uses unbounded `fs::read_to_string`. A 50 MB comment would pass through SHA-256 + YAML ser.
- **Full file paths are logged unredacted** (across `commands/*.rs` `tracing::error!` sites and `watcher.rs:158`). Shared logs leak workspace structure and usernames.
- **No MRSF schema version gate.** `load_sidecar` accepts any `mrsf_version`; a future-versioned sidecar may deserialize with silently dropped fields.
- **Mermaid SVG injected via `dangerouslySetInnerHTML`** (`MermaidView.tsx:89`) relies on upstream `securityLevel: "strict"` with no defense in depth.
- **Supply-chain rule is not codified.** No `deny.toml` / `cargo-deny` or npm audit gate in CI.
- **`patch_comment` in `core/sidecar.rs` is public and internally reachable.** Future wiring without `with_sidecar_mut` would bypass atomic-save.
- **Launch-args race on macOS "Open With"** (`lib.rs:258-287`): if `get_launch_args` fires between the `is_none` check and emit, files can be silently lost.
