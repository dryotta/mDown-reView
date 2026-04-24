# Security & Reliability — rules for mdownreview

**Status:** Canonical. Cite violations as "violates rule N in `docs/security.md`".
**Charter:** [`docs/principles.md`](principles.md)
**Last updated:** 2026-04-23

## Principles

1. **Local-only, offline-first trust model.** The app never trusts network input and never makes outbound calls except a signed updater check and user-initiated `openUrl` links, so the entire IPC surface is local-trust only.
   **Pillars:** Reliable, Professional.
   **Rationale:** Without this boundary, the intentional `tauri-plugin-fs` bypass would be unsafe. Keeping network out of the threat model lets us treat filesystem IPC as local-privileged.

2. **Custom IPC commands replace `tauri-plugin-fs` scope.** File access is intentionally unscoped at the plugin layer and is instead gated by explicit command-level guards (size, binary, extension, canonicalization).
   **Pillars:** Reliable, Lean.
   **Rationale:** A markdown viewer pointed at arbitrary local folders cannot work under plugin path-scope. The trade-off is that every custom command MUST enforce its own bounds.

3. **Rendered content is structurally sanitized by default.** Markdown is rendered without `rehype-raw`; any `dangerouslySetInnerHTML` call site is paired with a sanitizer or produces output from a library whose output is known-safe.
   **Pillars:** Reliable, Professional.
   **Rationale:** `react-markdown` escapes HTML by default; preserving that default is the single most important XSS control.

4. **Atomic writes, never partial sidecars.** Comment persistence uses temp-write + rename so a crash or watcher race never leaves a half-written `.review.yaml`.
   **Pillars:** Reliable.
   **Rationale:** Sidecar corruption is a zero-bug category — the only acceptable failure is "no write".

5. **Fail closed, log, continue.** Command handlers return `Result<_, String>` and log; React renders behind `ErrorBoundary`; the Rust panic hook logs before propagating; promise rejections route to the log.
   **Pillars:** Reliable, Professional.
   **Rationale:** A viewer must never crash to a blank window on malformed input.

## Rules

1. Every Rust command that opens a file MUST enforce the 10 MB hard cap. **Evidence:** `src-tauri/src/commands.rs:114` in `read_text_file`; `:139` in `read_binary_file`.
2. `read_text_file` MUST reject binaries by scanning the first 512 bytes for NUL and MUST only succeed on valid UTF-8. **Evidence:** `src-tauri/src/commands.rs:120-128`.
3. Size and binary checks MUST happen on already-read bytes, not on `metadata()` before a second read (no TOCTOU). **Evidence:** `src-tauri/src/commands.rs:108` comment "Read first, then check size".
4. `read_dir` MUST canonicalize the requested path and reject any request whose canonical form differs from the canonicalized absolute input. **Evidence:** `src-tauri/src/commands.rs:58-69`.
5. `read_dir` MUST strip `.review.yaml` and `.review.json` files from results. **Evidence:** `src-tauri/src/commands.rs:28-30, 86-88`.
6. `scan_review_files` MUST cap results at 10,000 entries and cap walker depth. **Evidence:** `src-tauri/src/commands.rs:168`; `src-tauri/src/core/scanner.rs:12`.
7. Sidecar writes MUST be temp-file + atomic rename; a failed rename MUST clean up the temp file. **Evidence:** `src-tauri/src/core/sidecar.rs:91-101`.
8. Saving an empty comment list MUST delete the sidecar rather than writing an empty YAML. **Evidence:** `src-tauri/src/core/sidecar.rs:74-79`.
9. Sidecar loading MUST prefer YAML over JSON and MUST treat a missing file as `Ok(None)`, never as an error. **Evidence:** `src-tauri/src/core/sidecar.rs:42-62`.
10. Malformed YAML/JSON MUST surface as a typed error (`SidecarError::YamlParse` / `JsonParse`), not a panic. **Evidence:** `src-tauri/src/core/sidecar.rs:45, 57`.
11. Launch args MUST be delivered via a poll command (`get_launch_args`) on mount; second-instance args MUST use the `args-received` event only after the window exists. **Evidence:** `src/App.tsx:98-105`; `src-tauri/src/lib.rs:95-102`.
12. The `LaunchArgsState` handler MUST use `.take()` so launch args are consumed exactly once. **Evidence:** `src-tauri/src/commands.rs:150-153`.
13. CLI argument parsing MUST canonicalize every path via `std::fs::canonicalize` and silently drop anything that fails to resolve. **Evidence:** `src-tauri/src/lib.rs:24-44`.
14. Markdown rendering MUST NOT use `rehype-raw`; only `remarkGfm` and `rehypeSlug` are installed. **Evidence:** `src/components/viewers/MarkdownViewer.tsx:387-388`.
15. Markdown anchor clicks MUST only open `http(s)` URLs, blocking `file://`, `javascript:`, etc. **Evidence:** `src/components/viewers/MarkdownViewer.tsx:146-148`.
16. Local image `src` MUST be piped through `convertFileSrc` so the WebView loads it via the `asset:` scheme, never raw `file://`. **Evidence:** `src/components/viewers/MarkdownViewer.tsx:302-309`.
17. Mermaid MUST run with `securityLevel: "strict"`. **Evidence:** `src/components/viewers/MermaidView.tsx:21`.
18. SourceView's `dangerouslySetInnerHTML` payload MUST come only from Shiki output, `escapeHtml`, or search highlight built from `escapeHtml`-segmented pieces — never from raw content. **Evidence:** `src/components/viewers/SourceView.tsx:184-190`; `src/hooks/useSourceHighlighting.ts:8-10`.
19. The CSP MUST disallow inline scripts, `object`, `frame-ancestors`, and MUST whitelist `asset:` for images only. **Evidence:** `src-tauri/tauri.conf.json:23`.
20. The window MUST request only the minimal Tauri capability set: log, dialog open, clipboard write-text, opener open-url, updater. **Evidence:** `src-tauri/capabilities/default.json:5-16`.
21. The file watcher MUST watch parent directories (not individual files, to survive atomic-rename saves) and MUST emit only for paths on the current watch list. **Evidence:** `src-tauri/src/watcher.rs:146-169, 80-102`.
22. Watcher writes MUST store both canonical and raw paths so deleted files (which cannot canonicalize) still match. **Evidence:** `src-tauri/src/watcher.rs:184-197`.
23. The frontend MUST drop any `file-changed` event received within 1500 ms of a local save to the same path. **Evidence:** `src/hooks/useFileWatcher.ts:7, 56-59`.
24. Closing a tab MUST evict that path from `lastSaveByPath` so stale timestamps cannot suppress a later event. **Evidence:** `src/store/index.ts:156-159`.
25. `window.onerror` and `window.onunhandledrejection` MUST be installed before `ReactDOM.createRoot` to capture module-load errors. **Evidence:** `src/main.tsx:6-19`.
26. React subtrees (toolbar, folder pane, viewer, comments) MUST each be wrapped in an `ErrorBoundary`. **Evidence:** `src/App.tsx:278,306,315,325,335`.
27. Rust panics MUST be logged with location via a panic hook installed in `setup`. **Evidence:** `src-tauri/src/lib.rs:109-123`.
28. Release builds MUST forward only `warn`/`error` from WebView `console.*` to the log. **Evidence:** `src-tauri/src/lib.rs:75-77`.
29. Log rotation MUST cap file size at 5 MB and keep rotated files (no indefinite growth mode). **Evidence:** `src-tauri/src/lib.rs:55-56`.
30. The updater MUST verify payloads via the configured minisign public key. **Evidence:** `src-tauri/tauri.conf.json:55`.
31. All frontend IPC MUST route through `src/lib/tauri-commands.ts`; no component calls `invoke` directly. **Evidence:** `src/lib/tauri-commands.ts:1-155`.
32. The `set_root_via_test` command MUST be compiled out of release builds. **Evidence:** `src-tauri/src/commands.rs:172` `#[cfg(debug_assertions)]`.

## Gaps (unenforced, backlog)

- **No path-origin restriction on mutation commands.** `add_comment`, `edit_comment`, `delete_comment`, `set_comment_resolved`, `add_reply`, `get_file_comments` accept any `file_path` string from the frontend. A compromised/confused renderer call could write `<any_path>.review.yaml`. Mitigation: allowlist against open tabs/root.
- **`check_path_exists` and `read_binary_file` lack the canonicalization guard used by `read_dir`** (`commands.rs:10-16, 133-146`). A symlink under a reviewed folder could redirect `convertFileSrc` image load outside the workspace.
- **Sidecar `selected_text` and `text` have no length limit** (`core/types.rs:17-45`). A 50 MB comment would pass through SHA-256 + YAML ser. DoS via malformed sidecar; `load_sidecar` uses unbounded `fs::read_to_string` (`core/sidecar.rs:42`).
- **Full file paths are logged unredacted** (`commands.rs:237`, `watcher.rs:158`). Users sharing logs leak workspace structure and usernames.
- **No MRSF schema version gate.** `load_sidecar` accepts any `mrsf_version` string. A future-versioned sidecar may deserialize with silently dropped fields, losing data on round-trip save.
- **Mermaid SVG is injected via `dangerouslySetInnerHTML`** (`MermaidView.tsx:89`). `securityLevel: "strict"` removes most vectors but SVG is not post-sanitized; any upstream regression becomes XSS.
- **Supply-chain rule is not codified.** No `deny.toml` / `cargo-deny` and no npm audit gate in CI. A new transitive dep could pull in a network-using crate, silently breaking the offline principle.
- **`patch_comment` in `core/sidecar.rs` is internally reachable but public.** Future wiring without `with_sidecar_mut` discipline would bypass atomic-save.
- **Launch-args race on macOS "Open With"** (`lib.rs:258-287`): if `get_launch_args` fires between the `is_none` check and the emit, files can be silently lost.
