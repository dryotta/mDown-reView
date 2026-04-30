# Tauri v2 Patterns

Project-agnostic Tauri v2 audit checklist. Cite a rule as `violates rule <rule-id> in docs/best-practices-common/tauri/v2-patterns.md`.

> **Scope:** Tauri v2 only. v1-specific guidance is out of scope and intentionally omitted. React-specific rules live in [`../react/`](../react/).

## IPC -- `ipc-*`

### `ipc-typed-wrappers`

All `invoke()` calls go through a single typed module (e.g. `src/lib/tauri-commands.ts`). Components MUST NOT import `@tauri-apps/api/core` directly. The wrapper file is the single source of truth for command names, argument shapes, and return types.

### `ipc-no-direct-invoke`

A component or hook that imports `invoke` from `@tauri-apps/api/core` is a layering violation. Add a wrapper, then import the wrapper.

### `ipc-tagged-enum-exhaustive`

When a Rust command returns a tagged enum (`#[serde(tag = "kind")]`), the TypeScript consumer MUST `switch` exhaustively on `kind`. Otherwise unhandled variants render as `JSON.stringify(...)` in the UI. Use a `never` assertion in the default branch.

### `ipc-result-error-mapping`

A Rust `Result<T, E>` becomes a Promise rejection in TypeScript. Every `invoke` call site MUST either `.catch()` or `await` inside a `try`. Silent failures (no catch, no awaited try) are a bug, not a style issue.

### `ipc-narrow-payloads`

Send the minimum payload across the IPC boundary. Avoid sending an entire document on every change; send the delta. Avoid sending file paths plus content when content can be re-read by path.

## Events -- `events-*`

### `events-flat-kebab-names`

Tauri menu and lifecycle event names are flat kebab-case (e.g. `menu-open-file`, `app-blur`). Never use URI schemes (`menu://x`) or dotted namespaces. The same name MUST appear in the frontend type registry and the Rust id-map.

### `events-listener-cleanup`

Every `listen()` call inside a `useEffect` MUST return its `unlisten()` from the cleanup function. A listener without cleanup is a leak.

### `events-once-vs-listen`

Use `once()` for one-shot subscriptions (initial state pull). Use `listen()` for ongoing subscriptions. A `listen()` used as `once()` leaks; an `once()` used for ongoing events drops updates.

## Capabilities -- `caps-*`

### `caps-narrow-acl`

`tauri.conf.json` capabilities and `capabilities/*.json` MUST grant the narrowest scope sufficient for the feature. Wildcards (`fs:allow-read-text-file` with `**`) are a red flag; prefer explicit allowlisted paths.

### `caps-window-scope`

Capabilities MUST be scoped to the window(s) that need them. Granting a capability to all windows when only the main window uses it is a violation.

### `caps-no-shell-execute`

`shell:allow-execute` MUST NOT be enabled unless there is a specific, documented user-initiated workflow. Even then, restrict by program name and validated argument shape.

## Plugins -- `plugins-*`

### `plugins-singleton-init`

Plugins that hold state (updater, single-instance, log) MUST be initialized exactly once in `lib.rs::run()`. Re-initializing or registering twice is a footgun.

### `plugins-single-instance-route`

Second-launch payloads from `tauri-plugin-single-instance` MUST be handled by the same code path that handles initial-launch payloads. Two parallel paths drift.

### `plugins-updater-respect-user`

Updater checks MUST not interrupt the user mid-task. Schedule the prompt for an idle moment or a defer-to-restart UI; do not block the active view.

### `plugins-log-chokepoint`

All Rust logging MUST go through the configured `tauri-plugin-log` chokepoint with a consistent prefix (e.g. `[rust]`). Frontend logging mirrors this with a `[web]` prefix. Direct `println!` / `console.log` in production code is a violation.

## Windows -- `windows-*`

### `windows-config-not-runtime`

Window properties that the app does not change at runtime (title, min size, decorations) MUST be set in `tauri.conf.json`, not by calling `setTitle` / `setSize` / etc. on startup. Runtime-set static properties cause a flash and complicate testing.

### `windows-decorations-platform`

Decoration choices (frame, traffic lights, custom title bar) MUST be tested on every supported platform. A decoration that works on macOS often misbehaves on Windows and vice versa.

### `windows-close-handler`

The window close request handler MUST give the app a chance to surface unsaved state (a confirm dialog or auto-save) before destroying the window. Closing without this hook loses user work.

## Filesystem -- `fs-*`

### `fs-canonicalize-once`

Path canonicalization MUST happen at the IPC boundary (the Rust command), not in the calling code. Once canonicalized, the workspace-root check is a single substring/prefix comparison.

### `fs-bounded-reads`

`read_text_file` / `read_binary_file` MUST enforce a maximum size at the Rust layer. Frontend size hints are advisory; the Rust layer is the chokepoint.

### `fs-atomic-writes`

Writes that must not be torn (sidecars, settings) MUST go through a `write_atomic` helper: write to `*.tmp`, `fsync`, then rename. A direct `write` is a violation for any file the user expects to remain consistent.

## Security cross-references

CSP, OS-association registration, and capability ACL specifics for v2 are stack-agnostic enough to belong here, but project-specific bounds (size caps, allowed schemes) live in the consuming project's `docs/security.md`.

## Multi-Window -- `multiwin-*`

Best practices distilled from Tauri v2 (2.10+) documentation, runtime source, and empirical testing. Multi-window is an area where Tauri v2 has specific design intent that diverges from single-window patterns — getting it wrong causes subtle bugs (events to wrong window, state bleed, hangs during window creation).

### `multiwin-per-window-menu`

Each window MUST own its own menu, set via `WebviewWindowBuilder::menu(menu)` at build time. Do NOT use `app.set_menu()` for multi-window apps.

**Why:** `app.set_menu()` installs a global menu. Menu events fired through `app.on_menu_event()` carry no window identity — the `MenuEvent` only has an `id` field, not a window label. Any routing heuristic (`is_focused()`, last-active tracking) is a workaround that breaks under race conditions (menu dropdown steals focus, OS focus manager quirks, rapid window switching).

Per-window menus solve this at the platform level. On Windows, each HWND owns its HMENU. On macOS, the shared menu bar switches automatically when the frontmost window changes. Tauri v2's `WebviewWindowBuilder::menu()` wires both correctly.

**Pattern:** Build a helper function that constructs the menu and returns it. Call it once per window creation (in `setup()` for the main window, in every `WebviewWindowBuilder` for secondary windows). If menu items need to vary per window (e.g. a "Close Folder" item only for folder windows), compose the menu conditionally.

### `multiwin-window-scoped-events`

Events that target a specific window MUST use `emit_to(label, event, payload)`, not `emit(event, payload)`. Global `emit()` is only appropriate for events that genuinely need all windows to react (e.g. a global theme change).

**Why:** `emit()` broadcasts to every window. In a multi-window app, this means:
- Every window's event listeners fire, even when the event is irrelevant
- Frontend code must filter by checking "is this file/folder mine?" — duplicating routing logic that belongs in Rust
- Performance degrades linearly with window count
- Bugs are silent: a window that forgets to filter processes events intended for another

**Applies to:** `file-changed`, `folder-changed`, `sidecar-config-changed`, `comments-changed`, `args-received`, `open-file-tab`, menu events. Only `update-progress` (always to main) and truly global preference changes warrant broadcast.

**Pattern:** The Rust side (watcher, command handler) must know which window(s) care about a given file/folder path. The `WindowRegistry` already tracks this — use it to look up the target label, then `emit_to(label, ...)`.

### `multiwin-emit-filter`

When an event may be relevant to a *subset* of windows (not exactly one, not all), use `emit_filter()` with a predicate rather than looping over labels manually.

```rust
// Example: emit to all windows whose folder is an ancestor of the changed path
app.emit_filter("file-changed", payload, |target| {
    matches!(target, EventTarget::WebviewWindow { label } if registry.owns_path(label, &path))
})?;
```

This keeps the "who receives what" logic in one place and avoids forgetting a window.

### `multiwin-lifecycle-registry`

Every window MUST be tracked in a Rust-side registry from creation to destruction. The registry is the single source of truth for:
- Window labels and their associated content (folder path, file-only)
- Routing decisions (where to open a new file/folder)
- Cleanup on window close (unregister, stop watchers, drain pending args)

**Pattern:** `WindowRegistry` is managed state. `on_window_event(WindowEvent::Destroyed)` MUST call `registry.unregister(label)`. New windows MUST call `registry.register(label, kind)` immediately after `builder.build()`. No window may exist without a registry entry.

### `multiwin-args-delivery`

When creating a new window and pushing launch args into the registry for it to drain, ALWAYS emit a signal event (`args-received`) to the new window **after** `push_args`. The reason: the webview's React mount may issue its initial `get_launch_args` drain before `push_args` completes (race). The signal event triggers a re-drain that picks up any args that arrived late.

**Pattern:**
```rust
match builder.build() {
    Ok(new_win) => {
        reg.register(label.clone(), kind);
        reg.push_args(&label, args);
        let _ = new_win.emit("args-received", ());  // ensure frontend re-drains
    }
    Err(e) => log::error!("window creation failed: {e}"),
}
```

### `multiwin-no-focused-fallback`

Do NOT use `is_focused()` polling or `focused_or_main()` helpers to route events to a window. Focus state is unreliable during native menu interaction (the menu dropdown takes focus on Windows) and during rapid window switching. If you need to know which window originated an action, the action's dispatch path must carry the window identity — not query it after the fact.

### `multiwin-state-isolation`

Each window MUST have its own frontend state instance. Per-window state (tabs, active file, folder tree expansion, scroll position) is NEVER shared or persisted cross-window. Only global preferences (theme, author name, reading width) may be synchronized — via `localStorage` events or a dedicated IPC channel, never by sharing a store reference.

### `multiwin-window-creation-nonblocking`

Window creation (`WebviewWindowBuilder::build()`) runs on the main thread and may take 100–500 ms for WebView2 initialization on Windows. During this time, the event loop is blocked and other windows cannot process events. Minimize work in the menu event handler around window creation:
- Do NOT acquire locks that IPC handlers also need
- Do NOT perform I/O (file scanning, canonicalization) synchronously before or after `build()`
- Move any post-creation setup (arg pushing, event emission) to be as fast as possible

## Platform-Specific Cross-References

| Platform | Document |
|----------|----------|
| macOS | [`macos-platform.md`](macos-platform.md) — app menu structure, window lifecycle (close-hides), WKWebView quirks, distribution, keyboard conventions |

Menu construction, window close behavior, and clipboard handling differ significantly between macOS and Windows. Always use `#[cfg(target_os = "...")]` or runtime detection to branch platform-specific logic. Never assume Windows behavior is universal.
