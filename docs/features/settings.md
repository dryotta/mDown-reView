# Settings

## What it is

A single, full-page **Settings** region (not a modal) that surfaces the platform-integration toggles mdownreview wants the OS to know about: where the CLI lives, whether `.md`/`.mdx` opens with mdownreview by default, and whether the folder context-menu is registered. It replaces the legacy first-run modal flow (`FirstRunPanel` / `SetupPanel`) deleted in #79.

Every row reflects **live OS state** rather than a stored "I clicked this once" bit. A user who installs the CLI from the terminal and reopens the app sees the row as `installed` without ever clicking the in-app switch.

## How it works

- **Routing.** `App.tsx` renders `<SettingsView />` whenever `settingsSurface === 'inline'` — even if a tab is open. The viewer is hidden behind it. Closing Settings (Esc, ×, or the toolbar gear toggling off) returns the user to the previously-active tab.
- **Region semantics.** `<SettingsView>` is a `<div role="region" aria-label="Settings">`, NOT a `<dialog>`. There is no backdrop, no focus trap, and no `inert`-ing of the surrounding chrome — clicking the toolbar gear or pressing Esc dismisses it.
- **One IPC command** drives the persisted state (`onboarding_state` — schema-versioned `OnboardingState` blob at `app_config_dir/onboarding.json`). Live status reads (`cli_shim_status`, `default_handler_status`, `folder_context_status`) and the action mutators (`install_cli_shim`, `remove_cli_shim`, `set_default_handler`, `register_folder_context`, `unregister_folder_context`) are documented in [installation.md](installation.md).
- **Per-row local pending state.** The store models *outcome* (status + formatted error). Transient action progress is tracked in `useState` inside `SettingsView` so two rows can be in-flight independently.
- **Error rendering.** Action errors land in `onboardingErrors[sectionKey]` via `formatOnboardingError` (exhaustively matches every tagged-enum variant — never falls back to `JSON.stringify`) and render under the row in a `role="alert"` block.

## Entry points (4)

| Entry point | Source | Behavior |
|---|---|---|
| **Toolbar gear** | `src/App.tsx` (`.toolbar` block) | Calls `openSettings()` on the store. |
| **Native menu — Help → Settings…** | `src-tauri/src/lib.rs` (`help-settings` MenuItem) → `useMenuListeners` (`menu-help-settings`) | Same store action. |
| **WelcomeView link** | `src/components/WelcomeView.tsx` ("Set up CLI, file associations, and agent integration → Settings") | Visible whenever no tab is open. |
| **No-tab default? No.** | `src/App.tsx` routing | The no-tab area shows `<WelcomeView>` by default and `<SettingsView>` only when `settingsSurface === 'inline'`. Settings is opt-in, not the landing page. |

## Rows

Three integration rows render inside the body:

| Key | Status command | Action(s) | Done-state UI |
|---|---|---|---|
| `cliShim` | `cli_shim_status` | `install_cli_shim` / `remove_cli_shim` | Toggle switch — both directions. |
| `defaultHandler` | `default_handler_status` | `set_default_handler` (no remove IPC) | Switch hidden; "Already the default — change in System Settings." |
| `folderContext` | `folder_context_status` | `register_folder_context` / `unregister_folder_context` | Toggle switch — both directions. On non-Windows: switch hidden; "Not available on this platform." |

Each row carries: the title, a one-line description, a status badge (`installed` / `missing` / `unsupported` / `error`), and either a `role="switch"` button or fallback text per the table above.

## Esc closes

`SettingsView` registers a window keydown listener that calls `closeSettings()` on `Escape`. The listener is unmounted with the component.

## Author / preferences dialog (legacy)

The legacy `<SettingsDialog>` (display-name editor backed by `set_author`/`get_author`) is reachable from a footer link inside `SettingsView` ("Author & preferences…"). It is gated by an independent `authorDialogOpen` boolean so it can layer OVER the inline page without unmounting it — opening the dialog must NOT drop the user back to Welcome/Viewer when they dismiss it.

## Key source

- `src/components/SettingsView.tsx` — the region component
- `src/styles/settings-view.css` — `.settings-view` / `.settings-row` / `.settings-switch` / `.settings-footer-link`
- `src/store/index.ts` — `OnboardingSlice` (statuses, errors, `settingsSurface`, `authorDialogOpen`, action wrappers)
- `src/lib/tauri-commands.ts` — typed IPC wrappers for `onboarding_state`, the three `*_status` reads, and the five action mutators
- `src-tauri/src/commands/onboarding.rs` — single IPC command (`onboarding_state`)
- `src-tauri/src/core/onboarding.rs` — schema-versioned persisted state

## Related

- [installation.md](installation.md) — what each integration command actually does on disk
- [app-chrome.md](app-chrome.md) — toolbar layout (Open File, Open Folder, Comments, Settings)
- Atomic on-disk writes — rule 27 in [`docs/architecture.md`](../architecture.md)
