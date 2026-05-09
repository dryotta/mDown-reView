# Native E2E tests

These tests drive the real Tauri app on a Windows runner via WebView2 + the
Chrome DevTools Protocol (CDP). They are listed alphabetically and run
serially because they share a single app window (see
`playwright.native.config.ts`).

## Two-config layout (issue #364)

The native E2E suite is split across **two Playwright configs** so a spec
that mutates global Windows state cannot kill the shared debug binary used
by the rest of the suite:

| Config | Runs | Globalsetup |
|---|---|---|
| `playwright.native.config.ts` | every spec EXCEPT `installer.spec.ts` | spawns one CDP-attached debug binary; specs share it serially |
| `playwright.installer.config.ts` | `installer.spec.ts` only | none — the installer spec spawns/tears down its own NSIS binary |

The two configs MUST be invoked separately because Playwright's `globalSetup`
is **config-level, not per-project** (https://playwright.dev/docs/api/class-testproject —
`TestProject` has no `globalSetup` property). A project-split inside one
config would still share one CDP-attached binary, defeating the isolation.

Run via:
- `npm run test:e2e:native` — every spec except installer.
- `npm run test:e2e:native:installer` — installer smoke only.

## Per-spec window-scope reset (issue #366)

Specs share one debug binary, so per-window watcher state
(`tree_watched_dirs`, `watched_paths`) accumulates across specs. The
`nativePage` fixture in `e2e/native/fixtures.ts` invokes the
`#[cfg(debug_assertions)]`-only `reset_window_scope_for_test` IPC
between the `__TAURI_INTERNALS__` readiness check and `await use(page)`,
giving every spec a clean precondition. Single-chokepoint pattern: any
spec using the `nativePage` fixture is reset; specs that bypass the
fixture and call `base.test` directly are NOT reset (none currently do).

New specs do NOT need to call this manually — using the `nativePage`
fixture is the static invariant.

## Specs

- `01-smoke.spec.ts` — app boots and shows the welcome view.
- `02-ipc-commands.spec.ts` — IPC round-trips work.
- `03-file-reload.spec.ts` — file change re-renders.
- `04-scroll-stability.spec.ts` — scroll position is preserved across re-renders.
- `05-multi-window.spec.ts` — second window opens with its own state.
- `06-mrsf-config-reload.spec.ts` — MRSF config hot-reload.
- `07-asset-scope.spec.ts` — asset-protocol scope grants.
- `08-excalidraw-real-write.spec.ts` — Excalidraw save round-trip via the workspace-write chokepoint.
- `09-outside-file-open.spec.ts` — outside-workspace file open path (issue #359).
- `installer.spec.ts` — **real-installer smoke**, run by the second config (above). See the Two-config layout section for why it lives in its own config.
- `multiwin-concurrent-cli-launch.spec.ts` — registry race (E1).
- `multiwin-macos-clipboard.spec.ts` — macOS-only clipboard preservation across windows.
- `multiwin-macos-close-hides.spec.ts` — macOS-only close-hides-window semantics.
- `multiwin-new-window-ux.spec.ts` — new-window opening UX.
- `multiwin-window-destroy-cleanup.spec.ts` — registry cleanup on window destroy.
