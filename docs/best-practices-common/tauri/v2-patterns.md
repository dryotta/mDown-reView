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
