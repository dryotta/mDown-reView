# Tauri v2 Patterns

Project-agnostic audit checklist for any Tauri v2 + frontend codebase. These patterns prevent the most common v1→v2 regressions and v2-specific footguns regardless of which frontend framework you pair with Tauri.

> **Scope:** Tauri v2 only. v1 patterns and v1→v2 migration steps are NOT covered here -- consult the [official Tauri v2 migration guide](https://v2.tauri.app/start/migrate/from-tauri-1/).

## When to apply

- Reviewing any change under `src-tauri/`.
- Reviewing any frontend file that imports from `@tauri-apps/api/*` or `@tauri-apps/plugin-*`.
- Auditing `tauri.conf.json` or capability files.
- Upgrading Tauri or any `tauri-plugin-*` dependency.

## Rule categories

| Priority | Category | Impact | Prefix |
|---|---|---|---|
| 1 | IPC commands | HIGH | `ipc-` |
| 2 | Events | HIGH | `events-` |
| 3 | Capabilities & permissions | HIGH | `caps-` |
| 4 | Plugins | MEDIUM | `plugins-` |
| 5 | Window management | MEDIUM | `windows-` |

## Rules

### `ipc-typed-commands` -- Use `#[tauri::command]` with typed parameters and a `Result` return

**Impact: HIGH (prevents silent IPC breakage; gives the frontend a typed surface)**

Every IPC entry point declares a typed parameter list and returns `Result<T, E>` where both `T` and `E` are `Serialize`. Avoid `String`-typed errors that hide variants from the frontend.

**Incorrect: untyped error string**

```rust
#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}
```

**Correct: tagged enum error visible to the frontend**

```rust
#[derive(serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ReadError {
    PermissionDenied,
    NotFound,
    Io { message: String },
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, ReadError> { ... }
```

The frontend can `switch (err.kind)` exhaustively instead of regex-matching on a sentence.

### `ipc-single-chokepoint` -- All `invoke()` calls go through one typed wrapper module

**Impact: HIGH (single point of mock, single point of error policy)**

A frontend module (e.g. `src/lib/tauri-commands.ts`) wraps every Tauri command with a typed function. No component imports `invoke` directly. This:

- Lets tests mock the wrapper module instead of each call site.
- Centralises retry / logging / error-translation policy.
- Makes Rust ↔ TypeScript signature drift a compile error.

A grep for `from "@tauri-apps/api/core"` outside the wrapper module = violation.

### `events-window-scope-by-default` -- Prefer `emit_to(window, ...)` over global `emit`

**Impact: HIGH (prevents cross-window event leaks and surprise re-renders)**

`emit()` broadcasts to every window. In a multi-window app this delivers events to listeners that did not subscribe. Default to `emit_to(&window_label, ...)`. Use `emit_filter` when you need predicate-based addressing. Reserve global `emit` for app-wide lifecycle signals (e.g. shutdown).

```rust
// Incorrect: every window receives this
app.emit("file-changed", payload)?;

// Correct: only the main window
app.emit_to("main", "file-changed", payload)?;
```

### `events-cleanup-listeners` -- Frontend `listen()` MUST `unlisten()` on cleanup

**Impact: HIGH (subscription leaks accumulate across HMR / route changes / re-mounts)**

Every `listen()` returns an `unlisten` function. Call it from the effect's cleanup path. Missing cleanup is a confirmed bug, not a style issue.

```typescript
// Incorrect
useEffect(() => {
  listen("file-changed", handler);
}, []);

// Correct
useEffect(() => {
  let unlisten: UnlistenFn | undefined;
  listen("file-changed", handler).then((fn) => (unlisten = fn));
  return () => unlisten?.();
}, []);
```

### `caps-least-privilege` -- Capabilities are minimal and per-window-scoped

**Impact: HIGH (capabilities are the v2 security boundary)**

In `src-tauri/capabilities/*.json`, only list the permissions actually used. Scope capabilities to specific window labels (`"windows": ["main"]`) rather than the default `["*"]` wildcard. File-system scopes are explicit allowlists, never `**`.

A new capability added "just in case" is a violation. Remove unused permissions in the same diff that removes the calling code.

### `caps-fs-scopes-explicit` -- File-system scopes are explicit and read-only by default

**Impact: HIGH (prevents path traversal exposure)**

The `fs` plugin scope MUST list specific directories. Read-only access (`fs:allow-read-text-file`) is preferred over write permissions. Granting `fs:default` (which includes write) requires a documented justification.

```json
{
  "permissions": [
    {
      "identifier": "fs:allow-read-text-file",
      "allow": [{ "path": "$APPDATA/yourapp/**" }]
    }
  ]
}
```

### `plugins-pin-versions` -- Plugins are version-pinned and auditable

**Impact: MEDIUM (plugin updates can change IPC surface)**

Pin both the Cargo crate (`tauri-plugin-foo = "=2.x.y"`) and the npm wrapper (`"@tauri-apps/plugin-foo": "2.x.y"`) to the same exact version. A version mismatch between Rust and JS sides of a plugin is a confirmed bug source.

### `plugins-error-handling` -- Plugin async APIs are awaited and errors surfaced

**Impact: MEDIUM (silent failures degrade UX trust)**

Plugin calls return Promises. Every call must be `await`ed (or chained with `.catch`) and the error surfaced to the user, not swallowed by an empty `.catch(() => {})`.

```typescript
// Incorrect
clipboard.writeText(value).catch(() => {});

// Correct
try {
  await clipboard.writeText(value);
} catch (err) {
  showToast({ kind: "error", message: "Could not copy to clipboard" });
  logger.warn("clipboard.writeText failed", err);
}
```

### `windows-webview-window-import` -- Use `WebviewWindow` from `@tauri-apps/api/webviewWindow`

**Impact: MEDIUM (v1 used `WebviewWindow` from `@tauri-apps/api/window` -- changed in v2)**

The v2 split `Window` (frame, OS chrome) from `WebviewWindow` (the webview that hosts the UI). Importing from the wrong path will type-check but call methods that no longer exist.

```typescript
// Incorrect (v1 path)
import { WebviewWindow } from "@tauri-apps/api/window";

// Correct (v2 path)
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
```

### `windows-multi-window-aware` -- Code does not assume a single window

**Impact: MEDIUM (single-instance plugin still permits secondary windows for previews, settings, etc.)**

Window-bound state (focus, scroll position, opened files) is keyed by `WebviewWindow.label`, not stored at module scope. Even single-window apps gain auxiliary windows over time -- writing window-aware code from day one is cheaper than a later refactor.

### `windows-single-instance-payload` -- Use `tauri-plugin-single-instance` for second-launch arguments

**Impact: MEDIUM (prevents file associations from spawning duplicate processes)**

When the app is already running and the user opens another file via OS association, `tauri-plugin-single-instance` forwards the new CLI args to the existing process. Register the callback in `setup` and route the args to the same handler that processes initial-launch args. Two independent code paths for "open at startup" and "open while running" is a smell.
