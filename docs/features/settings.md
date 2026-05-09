# Settings

## What it is

A centered **Settings** dialog (native `<dialog>` + `showModal()`) that groups every user-configurable preference into typed categories. It replaces the legacy first-run modal flow (`FirstRunPanel` / `SetupPanel`) deleted in #79, and was converted from an inline region to a popup dialog in #160.

Every integration row reflects **live OS state** rather than a stored "I clicked this once" bit. A user who installs the CLI from the terminal and reopens the app sees the row updated without ever clicking the in-app switch.

## How it works

- **Routing.** `App.tsx` renders `<SettingsView onClose={closeSettings} />` whenever `settingsDialogOpen === true`. The dialog overlays the viewer — closing it (Esc, ×, backdrop click) returns the user to the previously-active tab.
- **Dialog semantics.** `<SettingsView>` is a `<dialog>` opened via `showModal()`. Native focus trap, Esc handling (via `cancel` event), and backdrop overlay come for free. Pattern mirrors `<AboutDialog>`.
- **Typed category descriptors.** The body is driven by `SETTINGS_CATEGORIES` — a module-scope `readonly SettingsCategory[]` constant. Each category has a `title` and an array of `SettingsRowDescriptor` items (discriminated union on `kind`). Adding a new setting means adding a descriptor — no render logic changes.
- **One IPC command** drives the persisted state (`onboarding_state` — schema-versioned `OnboardingState` blob at `app_config_dir/onboarding.json`). Live status reads (`cli_shim_status`, `default_handler_status`) and the action mutators (`install_cli_shim`, `remove_cli_shim`, `set_default_handler`) are documented in [installation.md](installation.md).
- **Theme persistence** flows through the `set_theme` IPC into the same `OnboardingState` blob. The frontend write path uses the `useThemePref` write-through VM (`src/lib/vm/useThemePref.ts`, peer of `useAuthor`); `useApplyTheme.ts` remains a pure DOM applier with no IPC writes. The renderer reads theme synchronously from Zustand `persist` (localStorage) — there is no `get_theme` IPC by design (asymmetric vs `author` because `theme` is in the `partialize` allowlist and the inline `<script>` in `index.html` reads it for FOUC mitigation). Rust reads the persisted `OnboardingState.theme` at window-construction time via `commands::config::resolve_window_bg` to fix cold-start chrome — see [app-chrome.md](app-chrome.md#multi-window-behavior).
- **Per-row local pending state.** The store models *outcome* (status + formatted error). Transient action progress is tracked in `useState` inside `SettingsView` so two rows can be in-flight independently.
- **Error rendering.** Action errors land in `onboardingErrors[sectionKey]` via `formatOnboardingError` (exhaustively matches every tagged-enum variant — never falls back to `JSON.stringify`) and render under the row in a `role="alert"` block.

## Entry points (2)

| Entry point | Source | Behavior |
|---|---|---|
| **Native menu — Help → Settings…** | `src-tauri/src/lib.rs` (`help-settings` MenuItem) → `useMenuListeners` (`menu-help-settings`) | Calls `openSettings()` on the store. |
| **WelcomeView link** | `src/components/WelcomeView.tsx` ("Set up CLI, file associations, and agent integration → Settings") | Visible whenever no tab is open. |

## Categories and rows

Three categories with four rows, defined in `SETTINGS_CATEGORIES`:

| Category | Row | Kind | Description |
|---|---|---|---|
| **General** | Display name | `input` | Name shown on authored comments. Inline text field with save-on-blur. |
| **AI Integration** | Add `mdownreview-cli` to your PATH | `switch` | Toggle to install/remove the CLI shim. AI-agent-framed copy explains how coding agents use it. Status-dependent description (no badge). |
| **AI Integration** | Install agent skills | `info` | Informational card with plugin marketplace commands and a copy-to-clipboard button. No IPC. |
| **File Associations** | Default app for `.md` and `.mdx` files | `action` | Shows current status hint (✓ Currently mdownreview / Currently another app). "Open system settings" button calls `set_default_handler` which opens `ms-settings:defaultapps` on Windows or equivalent on macOS. |

## Esc closes

The native `<dialog>` fires a `cancel` event on Esc. `SettingsView` prevents the default and calls `onClose()` to route through the parent's state management.

## Display name (author) editing

The display-name editor is inline in the General category (merged from the deleted `<SettingsDialog>` in #160). It uses the `useAuthor` hook with a `editedDraft ?? author` hydration-race guard. Save triggers on blur or Enter; validation errors from the `set_author` IPC (`ConfigError` tagged enum) render inline.

## Key source

- `src/components/SettingsView.tsx` — the dialog component + typed descriptors
- `src/styles/settings-view.css` — `.settings-dialog` / `.settings-row` / `.settings-switch` / `.settings-copy-btn`
- `src/store/index.ts` — `settingsDialogOpen`, `onboardingStatuses`, `onboardingErrors`, `defaultHandlerRawStatus`, action wrappers
- `src/lib/bindings.ts` — auto-generated typed IPC wrappers for `onboarding_state`, `cli_shim_status`, `default_handler_status`, and action mutators (re-exported through the `src/lib/tauri-commands.ts` façade that production code imports)
- `src-tauri/src/commands/onboarding.rs` — single IPC command (`onboarding_state`)
- `src-tauri/src/core/onboarding.rs` — schema-versioned persisted state

## Related

- [installation.md](installation.md) — what each integration command actually does on disk
- [app-chrome.md](app-chrome.md) — toolbar layout (Open File, Open Folder, Comments)
- Atomic on-disk writes — rule 27 in [`docs/architecture.md`](../architecture.md)
