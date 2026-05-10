---
tags: [tauri-v2, ipc, security, events]
source: vercel-labs/agent-skills (vendored  see LICENSE-vercel-skills.md)
---

# Tauri v2 Patterns

Project-agnostic Tauri v2 audit checklist. Cite a rule by its `<rule-id>`. Rule IDs are stable; the file path is local to whichever agent has bundled this knowledge.

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

**Applies to:** `file-changed`, `folder-changed`, `sidecar-config-changed`, `comments-changed`, `args-received`, `open-file-tab`, `flush-before-close`, `focus-tab`, `drag-drop-rejected`, menu events. Only `update-progress` (always to main) and truly global preference changes warrant broadcast.

**Pattern:** The Rust side (watcher, command handler) must know which window(s) care about a given file/folder path. The `WindowRegistry` already tracks this — use it to look up the target label, then `emit_to(label, ...)`.

**Per-event target & emit method.** Every event in `src/lib/tauri-events.ts::EventPayloads` MUST be emitted via the method in the "Required emit method" column. The "Target (rule)" column is the rule's prescription; the "Current call site" + "Current state" columns document today's reality so the table cannot lie about shipped code (Docs Reflect Shipped Code, `docs/principles.md`). Enforcement: `event-emit-target.test.ts` parses this table, asserts parity with `EventPayloads`, and forbids the broadcast pattern `.emit("<window-scoped-event>", …)` in non-test Rust code.

**Always `emit_to(label, …)` for window-scoped delivery.** `WebviewWindow::emit` is NOT window-scoped: Tauri 2.x's `Emitter::emit` calls `AppManager::emit` regardless of receiver, and that helper iterates every webview. Calling `emit` on `App`, `AppHandle`, `Window`, `Webview`, or `WebviewWindow` all behave identically as a global broadcast (Tauri ships a unit test under `tauri::manager` that asserts this). The ONLY way to scope delivery to one window is `emit_to(label, …)`; for a subset, use `emit_filter(...)`.

| Event | Target (rule) | Required emit method | Current call site | Current state |
|---|---|---|---|---|
| `file-changed` | set (windows watching the path) | `emit_filter` | `watcher.rs:313` | ✅ |
| `folder-changed` | one (watching window) | `emit_to(label, …)` | `watcher.rs:333` | ✅ |
| `args-received` | one (target window) | `emit_to(label, …)` | `launch_routing.rs::route_args_inner` (3×: ClaimForTarget, CreateFolder, CreateFileOnly arms), `lib.rs::run` setup loop, `commands/launch.rs::set_root_via_test` | ✅ |
| `open-file-tab` | one (routed window) | `emit_to(label, …)` | `launch_routing.rs::route_args_inner` (file branch's `AddToWindow` arm) | ✅ |
| `comments-changed` | set (windows with the file open) | `emit_filter` (registry-owns-path predicate) | `commands/comments/mod.rs:90` (`Emitter::emit` on `AppHandle`) | ❌ violates `multiwin-window-scoped-events` — global emit; should be `emit_filter` on registry-owns-path predicate. Future C2 fix. |
| `update-progress` | one (`"main"`) | `emit_to("main", …)` | `update.rs:115,123` (`Emitter::emit` on `AppHandle`) | ❌ violates `multiwin-window-scoped-events` — broadcast; should be `emit_to("main", …)`. Future H2 fix. |
| `sidecar-config-changed` | all | `app.emit(…)` | `commands/sidecar_config.rs:65-67` (manual `for win in app.webview_windows().values()` loop) | ❌ violates `multiwin-emit-filter` — manual loop over `app.webview_windows()`; should be `app.emit(…)`. Future C2 fix. |
| `menu-open-file` | one (firing window) | `emit_to(label, …)` | `lib.rs::on_menu_event` via `menu::dispatch_menu_event` | ✅ |
| `menu-open-folder` | one (firing window) | `emit_to(label, …)` | `lib.rs::on_menu_event` via `menu::dispatch_menu_event` | ✅ |
| `menu-close-folder` | one (firing window) | `emit_to(label, …)` | `lib.rs::on_menu_event` via `menu::dispatch_menu_event` | ✅ |
| `menu-close-tab` | one (firing window) | `emit_to(label, …)` | `lib.rs::on_menu_event` via `menu::dispatch_menu_event` | ✅ |
| `menu-close-all-tabs` | one (firing window) | `emit_to(label, …)` | `lib.rs::on_menu_event` via `menu::dispatch_menu_event` | ✅ |
| `menu-toggle-comments-pane` | one (firing window) | `emit_to(label, …)` | `lib.rs::on_menu_event` via `menu::dispatch_menu_event` | ✅ |
| `menu-next-tab` | one (firing window) | `emit_to(label, …)` | `lib.rs::on_menu_event` via `menu::dispatch_menu_event` | ✅ |
| `menu-prev-tab` | one (firing window) | `emit_to(label, …)` | `lib.rs::on_menu_event` via `menu::dispatch_menu_event` | ✅ |
| `menu-theme-system` | all | `app.emit(…)` | `lib.rs::on_menu_event` via `menu::dispatch_menu_event` | ✅ |
| `menu-theme-light` | all | `app.emit(…)` | `lib.rs::on_menu_event` via `menu::dispatch_menu_event` | ✅ |
| `menu-theme-dark` | all | `app.emit(…)` | `lib.rs::on_menu_event` via `menu::dispatch_menu_event` | ✅ |
| `menu-about` | one (firing window) | `emit_to(label, …)` | `lib.rs::on_menu_event` via `menu::dispatch_menu_event` | ✅ |
| `menu-check-updates` | one (`"main"`) | `emit_to("main", …)` | `lib.rs::on_menu_event` via `menu::dispatch_menu_event` | ✅ |
| `menu-help-settings` | one (firing window) | `emit_to(label, …)` | `lib.rs::on_menu_event` via `menu::dispatch_menu_event` | ✅ |
| `flush-before-close` | one (firing window) | `emit_to(label, …)` | `commands/close_flush.rs::flush_pending_writes_before_close` | ✅ |
| `focus-tab` | one (path's owner window) | `emit_to(label, …)` | `commands/open_file_registry.rs::claim_open_file` | ✅ |
| `drag-drop-rejected` | one (target window) | `emit_to(label, …)` | `commands/drag_drop.rs::handle_dropped_paths` | ✅ |

Legend: **one** = exactly one window (`AppHandle::emit_to(label, …)` — `WebviewWindow::emit` is broadcast, see above), **set** = subset of windows determined by registry predicate (`emit_filter`), **all** = every window must react (`app.emit(…)` — never a manual loop, which violates `multiwin-emit-filter`); use **all** only for genuinely global state changes.

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

### `multiwin-atomic-registry-mutations`

`WindowKind::Folder(path)` MUST be reached only via `WindowRegistry::try_claim_folder`, never via a separate `find_by_folder` check followed by `register`. The decision-and-claim pair must be atomic under the entries lock; the lock MUST be dropped before the subsequent `WebviewWindowBuilder::build()` (rule `multiwin-window-creation-nonblocking`).

**Why:** A read-then-register pattern lets two concurrent CLI launches (single-instance forwarding + macOS `RunEvent::Opened`) both decide `CreateFolder` for the same canonical path and both register, breaking the one-folder-one-window invariant. The atomic claim API exists at `src-tauri/src/registry.rs:152` precisely to prevent this; bypassing it is a Zero-Bug-Policy violation (`docs/principles.md`).

**Pattern:**
```rust
// BAD — src-tauri/src/lib.rs (route_args_through_registry): two-step
// register after a non-atomic route_folder read.
reg.register(label.clone(), registry::WindowKind::Folder(path.clone()));

// GOOD — atomic claim that rejects duplicates with the existing label.
reg.try_claim_folder(&label, path.clone())?;
```

### `multiwin-args-delivery`

When creating a new window and pushing launch args into the registry for it to drain, ALWAYS emit a signal event (`args-received`) to the new window **after** `push_args`. The reason: the webview's React mount may issue its initial `get_launch_args` drain before `push_args` completes (race). The signal event triggers a re-drain that picks up any args that arrived late.

**Pattern:**
```rust
match builder.build() {
    Ok(_new_win) => {
        reg.register(label.clone(), kind);
        reg.push_args(&label, args);
        // Window-scoped via AppHandle::emit_to (rule
        // multiwin-window-scoped-events). `WebviewWindow::emit` would
        // broadcast — see that rule's prose.
        let _ = handle.emit_to(&label, "args-received", ());
    }
    Err(e) => log::error!("window creation failed: {e}"),
}
```

### `multiwin-managed-state-cleanup`

Every `app.manage()`'d state with **per-window or per-path keying** MUST register cleanup in `on_window_event(WindowEvent::Destroyed)`. Process-global state (`PendingUpdate`, theme) is exempt; everything else (registry, watcher, BadgeCache, file-viewer prefs cache, future per-window caches) MUST declare its cleanup discipline.

**Why:** A keyed cache that never evicts grows monotonically across window churn. Long-lived sessions across many windows leak memory (Lean pillar, `docs/principles.md`); the destroyed window's per-path entries also wrongly grant `is_path_allowed` privileges (rule `multiwin-allowlist-scope`).

**Pattern:**
```rust
// In on_window_event(Destroyed):
if let Some(reg) = window.try_state::<registry::WindowRegistry>() {
    reg.unregister(&label);
}
if let Some(ws) = window.try_state::<watcher::WatcherState>() {
    ws.remove_window(&label);
}
// REQUIRED — every keyed managed state must be evicted here.
if let Some(badges) = window.try_state::<commands::comments::BadgeCache>() {
    badges.remove_window(&label);
}
```

PRs adding `app.manage(X)` MUST include a `// Cleanup: …` rustdoc comment on the manage call describing Destroyed behavior. Enforcement: planned in `managed-state-cleanup-doc-test.rs` (iter-2 of #315). Cites the meta-principle "Docs Reflect Shipped Code" (`docs/principles.md`) — the test does not exist yet.

### `multiwin-no-focused-fallback`

Do NOT use `is_focused()` polling or `focused_or_main()` helpers to route events to a window. Focus state is unreliable during native menu interaction (the menu dropdown takes focus on Windows) and during rapid window switching. If you need to know which window originated an action, the action's dispatch path must carry the window identity — not query it after the fact.

### `multiwin-state-isolation`

Each window MUST have its own frontend state instance.

**MUST be cross-window** (synchronized via `useCrossWindowPrefsSync` `storage` events; declared in the exported `CROSS_WINDOW_SYNCED_KEYS` constant per rule `multiwin-cross-window-state-whitelist`):

- `theme`, `authorName`, `updateChannel`, `readingWidth`, `recentItems`

**MUST be persisted-but-NOT-synced** (per-window seed for new windows; ping-pong-prone):

- `folderPaneWidth`, `commentsPaneVisible` — persisted as defaults for new windows but never propagated to other open windows.

**MUST be per-window only** (NEVER persisted, NEVER synced):

- `tabs`, `activeTabPath`, `tabHistory`, `expandedFolders`, `root`
- `viewModeByTab`, `fileMetaByPath`, `ghostEntries`, `lastSaveByPath`
- `pendingFileLevelInputFor`, `pendingLineCompose`, `pendingFragment`
- `showSidecarFiles`, `sidecarConfigDialogOpen`, `settingsDialogOpen`, `aboutOpen`
- `updateStatus`, `updateVersion`, `updateProgress` (updater UI is main-window-only)
- `allowedRemoteImageDocs`, `zoomByFiletype`

**MUST never be in a shared store at all** (re-derive per call):

- File contents (lazy via `read_text_file` IPC), comment lists per file (re-fetched on demand).

A new persisted key without explicit classification in one of the three lists above is a defect. Enforcement: planned in `cross-window-whitelist-meta-test.ts` (iter-2 of #315). Cites the meta-principle "Docs Reflect Shipped Code" (`docs/principles.md`) — the test does not exist yet.

### `multiwin-cross-window-state-whitelist`

Cross-window-synced state MUST be declared in a single exported `CROSS_WINDOW_SYNCED_KEYS` constant in `src/store/index.ts`. The persist `partialize` and the `useCrossWindowPrefsSync` patch builder BOTH consume it. Hard-coded inline allowlists in either place are a violation.

**Why:** Two opaque allowlists (one in persist config, one in the sync hook) drift the moment a developer adds a new persisted key without updating both. The single constant is the source of truth; runtime and lints reference it identically. Cross-references `docs/architecture.md` rule 15.

**Pattern:**
```typescript
// In src/store/index.ts:
export const CROSS_WINDOW_SYNCED_KEYS = [
  "theme", "authorName", "updateChannel", "readingWidth", "recentItems",
] as const;

partialize: (state) => Object.fromEntries(
  CROSS_WINDOW_SYNCED_KEYS.map((k) => [k, state[k]])
);

// In src/hooks/useCrossWindowPrefsSync.ts:
for (const key of CROSS_WINDOW_SYNCED_KEYS) {
  if (state[key] !== undefined && state[key] !== cur[key]) patch[key] = state[key];
}
```

### `multiwin-rejection-affects-store`

When a Rust IPC rejects a state-affecting action, the renderer MUST `await` the IPC and reconcile its store before proceeding. Treating an IPC rejection as a `void warn(...)` log while the store has already optimistically updated leaves a "ghost" state — the renderer believes a folder is open while the registry says otherwise.

**Why:** Optimistic update + fire-and-forget IPC violates the **Reliable** pillar (`docs/principles.md`). A `registerWindowFolder` rejection (folder already open in another window) must NOT leave `store.root` set; otherwise the FolderTree populates, the user adds a comment, and `enforce_workspace_path` rejects with a confusing "path not in workspace" error.

**Pattern:**
```typescript
// BAD — ghost state survives the IPC failure
useStore.getState().setRoot(folder);
registerWindowFolder(folder).catch((e) => warn(`failed: ${e}`));

// GOOD — reconcile on rejection
try {
  await registerWindowFolder(folder);
  useStore.getState().setRoot(folder);
} catch (e) {
  showError(`Folder already open in another window: ${e}`);
  // store.root remains null
}
```

### `multiwin-rehydrate-clamp`

Persisted per-window UI state (`folderPaneWidth`, future pane sizes, scroll positions) MUST be clamped against the current viewport on rehydrate. Persisted state from an ultra-wide monitor must not break the layout when the user opens the app on a 1080p screen.

**Why:** A 1200 px folder pane persisted on 4K and rehydrated on 1366×768 covers the entire viewport; the drag handle is offscreen and the app appears broken until the user clears localStorage. Clamping on the writer is not enough — viewport size is a property of the rehydrate moment.

**Pattern:**
```typescript
// In Zustand persist config:
onRehydrateStorage: () => (state) => {
  if (!state || typeof window === "undefined") return;
  state.folderPaneWidth = Math.max(160, Math.min(state.folderPaneWidth, window.innerWidth * 0.4));
}
```

### `multiwin-window-creation-nonblocking`

Window creation (`WebviewWindowBuilder::build()`) runs on the main thread and may take 100–500 ms for WebView2 initialization on Windows. During this time, the event loop is blocked and other windows cannot process events. Minimize work in the menu event handler around window creation:
- Do NOT acquire locks that IPC handlers also need
- Do NOT perform I/O (file scanning, canonicalization) synchronously before or after `build()`
- Move any post-creation setup (arg pushing, event emission) to be as fast as possible

### `multiwin-per-window-startup-recorder`

Every `WebviewWindowBuilder::build()` success MUST record a per-window startup phase keyed by label. The `StartupRecorder` (`docs/observability.md`) is per-process today, which makes secondary-window startup invisible in `[startup]` logs.

**Why:** A multi-window app's startup ladder lies if `WebviewReady` is recorded only for `"main"`. Telemetry that depends on per-window first-paint cannot tell whether window N took 50 ms or 5 s.

**Pattern:**
```rust
match builder.build() {
    Ok(win) => {
        startup_recorder::record_window_phase(win.label(), StartupPhase::WebviewBuilt);
        // … rest of post-build setup
    }
    Err(e) => log::error!("…"),
}
```

### `multiwin-allowlist-scope`

`WatcherState::is_path_allowed` and `is_path_or_parent_allowed` MUST scope to the calling window's label, not union across all windows. A renderer in window B must not gain mutation rights for paths only window A has watched.

**Why:** Combined with `update_tree_watched_dirs` accepting an arbitrary `root` from any window, the global union becomes a sandbox-escape primitive: a renderer can extend the union to `~/.ssh` and then write `id_rsa.review.yaml` next to a private key. Per-window scope plus a registry-equality check on the supplied `root` closes this hole. Cross-references `docs/security.md`'s workspace-allowlist rule.

Applies to the family of allowlist methods: `is_path_allowed` AND `is_path_or_parent_allowed` at `watcher.rs:54-76, 90-112`.

**Pattern:**
```rust
// BAD — src-tauri/src/watcher.rs:60: union across all windows.
for set in watched.values() { if set.contains(&canonical) { return true; } }

// GOOD — scope to the calling window's label (threaded from window.label()
// at the IPC command boundary).
if let Some(set) = watched.get(window_label) { return set.contains(&canonical); }
```

### `multiwin-canonicalize-at-ingest`

Strengthens `fs-canonicalize-once`: every path entering the multi-window subsystem (CLI argv via `parse_launch_args`, macOS `RunEvent::Opened`, IPC commands receiving a path) is canonicalized exactly **once** at ingest. Downstream code (registry, watcher, command handlers) trusts the boundary and MUST NOT re-canonicalize. Renderer-side intake (`openFilesFromArgs`, `useOpenFileTab`, drop handlers) shares this contract — both consumer paths into the store must canonicalize symmetrically.

**Why:** Three syscalls per launched folder (route_args_through_registry, register_window_folder, set_tree_watched_dirs all canonicalize the same path) wastes the cold-startup budget (`docs/performance.md`). Asymmetric renderer-side canonicalization (`useOpenFileTab` skips, `openFilesFromArgs` doesn't) causes duplicate-tab bugs when the two intakes disagree on path form.

**Pattern:**
```rust
// At ingest only:
let canonical = canonicalize_no_verbatim(&raw_path)?;

// Downstream: no further canonicalize calls; pass the canonical PathBuf around.
```

### `multiwin-no-hardcoded-label`

The literal `"main"` MUST appear only in:
1. `src-tauri/tauri.conf.json` window config
2. The bootstrap registration in `lib.rs::setup` (the unique unprefixed label)

Anywhere else (`reg.push_args("main", …)`, `app.get_webview_window("main")`, mocks, tests) is a multi-window bug. Use `window.label()` (in IPC handlers; Tauri-injected) or registry queries.

**Why:** The `next_label()` counter starts at `win-1`, making `"main"` a sentinel only in the bootstrap. Hardcoding `"main"` in routing code (e.g. `set_root_via_test`, debug-only test commands, mocks) breaks multi-window scenarios silently — the test populates the wrong window. Fixing this is also a precondition for native E2E that creates multiple windows.

**Pattern:**
```rust
// BAD — hardcoded label in non-bootstrap code:
let main = app.get_webview_window("main").unwrap();

// GOOD — derive from registry or from the IPC's injected Window:
let label = registry.bootstrap_label();
let win = app.get_webview_window(&label);
```

### `multiwin-renderer-window-context`

Every renderer hook, test, or mock that affects per-window state via IPC MUST be Tauri-window-aware. Hooks running in a webview implicitly use `window.label()` for IPCs that take `window: tauri::Window` (injected by Tauri runtime), but tests, mocks, and any future "send IPC to a different window from this window" pattern MUST go through an explicit label parameter — never assume the calling webview's label is correct.

**Why:** The IPC mock at `src/__mocks__/@tauri-apps/api/core.ts` hard-codes `"main"` in its window-label seam, which makes second-window unit tests impossible. The `set_root_via_test` debug IPC has the same shape on the Rust side. Both need parametrized window context for multi-window tests to be writable.

**Pattern:**
```typescript
// BAD — implicit "current window" via global mock state:
mockInvoke({ command: "register_window_folder", returns: ok });

// GOOD — explicit window label seam:
mockInvoke({ windowLabel: "win-1", command: "register_window_folder", returns: ok });
```

## Platform-Specific Cross-References

| Platform | Document |
|----------|----------|
| macOS | [`macos-platform.md`](macos-platform.md) — app menu structure, window lifecycle (close-hides), WKWebView quirks, distribution, keyboard conventions |

Menu construction, window close behavior, and clipboard handling differ significantly between macOS and Windows. Always use `#[cfg(target_os = "...")]` or runtime detection to branch platform-specific logic. Never assume Windows behavior is universal.
