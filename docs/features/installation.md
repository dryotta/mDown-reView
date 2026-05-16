# Installation

## What it is

How users get mdownreview onto their machine, and the trust posture for the first launch. mdownreview is open-source and ships **without** an Apple Developer ID or Windows EV certificate; the install paths below are designed so a normal user reaches a working app without an unsigned-binary scare and without escalating privileges.

## How it works

There are three install paths, in decreasing order of recommendation:

### 1. Script install (recommended)

**macOS**

```bash
curl -LsSf https://dryotta.github.io/mdownreview/install.sh | sh
```

`curl` does **not** apply the macOS quarantine attribute (`com.apple.quarantine`), so the downloaded `.app` launches without a Gatekeeper warning. The script symlinks `mdownreview-cli` into `/usr/local/bin` and falls back to `~/.local/bin` when `/usr/local/bin` is not writable — no `sudo` ever required.

**Windows**

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://dryotta.github.io/mdownreview/install.ps1 | iex"
```

The Windows install runs the NSIS installer in per-user mode and adds the install directory to the per-user `PATH` so `mdownreview-cli` is on `PATH` for new shells. No UAC prompt.

### 2. Manual download (DMG / ZIP)

The GitHub Release page hosts `.dmg` (macOS) and `.zip` (Windows) artifacts.

When a user downloads the `.dmg` through a browser, macOS tags it with the quarantine attribute. After dragging `mdownreview.app` to `/Applications`, the user must clear the attribute once:

```bash
xattr -d com.apple.quarantine /Applications/mdownreview.app
```

Alternative: System Settings → Privacy & Security → "Open Anyway" after the first blocked launch.

### 3. Cargo (CLI-only, automation)

```bash
cargo install --git https://github.com/dryotta/mdownreview.git --bin mdownreview-cli
```

For CI pipelines and automation users who only need the CLI and already have a Rust toolchain.

## Codesigning posture

The app is **ad-hoc signed** — `tauri.conf.json` sets `signingIdentity: "-"`. There is no Apple Developer ID and no notarization. arm64 macOS requires *some* signature for a binary to execute at all; ad-hoc signing satisfies that hard requirement without paying for a Developer ID.

The `mdownreview-cli` binary embedded inside the `.app` bundle (`externalBin`) is also ad-hoc signed, and the release workflow verifies both signatures before publishing the artifact.

## Per-user install

No UAC on Windows, no `sudo` on macOS — both install paths run entirely in user space. NSIS uses `installMode: currentUser` (`tauri.conf.json`) and `site/install.sh` falls back from `/usr/local/bin` to `~/.local/bin` rather than escalating.

## DMG (macOS)

The `.dmg` ships with Tauri's default DMG bundler layout (window size, app/Applications-folder positions, no custom background). The release workflow (`.github/workflows/release.yml` "Verify DMG layout") asserts that the DMG mounts cleanly and contains the `Applications` symlink alongside `mdownreview.app`.

> The unsigned-binary unquarantine instructions live in the GitHub release notes (see `release.yml` `--notes` block) and on `https://dryotta.github.io/mdownreview/` — not inside the DMG. Tauri v2's DMG bundler does not support arbitrary files at the DMG root via config, and `bundle.resources` ships files inside the .app bundle (Contents/Resources/), not at the mount root.

## NSIS installer hooks (Windows)

`tauri.conf.json` `bundle.windows.nsis.installerHooks` points at `src-tauri/installer/installer-hooks.nsh`. Two macros, **HKCU only — no UAC**:

- `NSIS_HOOK_POSTINSTALL` — uses stock NSIS (`ReadRegStr` / `WriteRegExpandStr` on `HKCU\Environment`, plus a `WM_SETTINGCHANGE` broadcast via `MdrBroadcastEnvChange`) to add `$INSTDIR` to per-user `PATH`. A small private macro `MdrFilterPath` walks the `;`-separated tokens and drops any case-insensitive match of `$INSTDIR` before the new entry is appended, so re-installing on top of an existing install does not duplicate the entry. No NSIS plugins required (the Tauri-bundled `makensis` does not ship `EnVar`).
- `NSIS_HOOK_PREUNINSTALL` — reverses the PATH change: re-uses `MdrFilterPath` to strip `$INSTDIR` from PATH (collapses runs of `;`; `DeleteRegValue` if the result would be empty rather than writing `""`), then broadcasts `WM_SETTINGCHANGE` via the same helper.

Both broadcasts go through the shared `MdrBroadcastEnvChange` helper, which calls `user32::SendMessageTimeoutW` directly via `System::Call` with `SMTO_ABORTIFHUNG` and a 1 s per-window timeout. This is mandatory: NSIS's built-in `SendMessage … /TIMEOUT=…` lowers to `SMTO_NORMAL`, and with `HWND_BROADCAST` Windows applies the timeout per non-responsive top-level window, which stalled the silent install path for ~60 s on busy desktops. `SMTO_ABORTIFHUNG` skips hung windows immediately; Explorer / conhost / Cmd Shell host always respond within milliseconds. The helper mirrors `broadcast_environment_change` in `src-tauri/src/commands/cli_shim/windows.rs`, keeping the install-time and runtime (Settings-toggle) writers symmetric.

The installer writes PATH only; other platform integrations are managed at runtime via IPC commands (below).

## Onboarding state model

First-launch and "what's new" UX is driven by a small Rust ViewModel persisted at `app_config_dir/onboarding.json` (resolved via `tauri::Manager::path().app_config_dir()`). The schema is versioned from day one:

```jsonc
{
  "schema_version": 1,                              // u32; future versions are refused
  "last_seen_sections": ["cli", "default-handler"], // Vec<String> — onboarding cards already dismissed
  "author": "Alice",                                // Option<String> — display name on authored comments
  "theme": "system"                                 // Option<String> — "system" | "light" | "dark"; omitted when absent
}
```

Source: `src-tauri/src/core/onboarding.rs`. **Forward-compat refusal:** any file with `schema_version > 1`, malformed JSON, or I/O error returns `OnboardingState::default()` (a fresh state) — old binaries never blow up on a future-format file. Saves go through `core/atomic.rs::write_atomic` so a crash mid-write cannot corrupt the file.

`theme` is read at window-construction time by `commands::config::resolve_window_bg` to set the OS-painted `WebviewWindowBuilder::background_color` and the `WebviewWindowBuilder::theme` (Windows titlebar / macOS chrome) **before** WebView2/WebKit attaches — eliminating the cold-start light-theme flash that was a regression of PR #265's dark-only fix. `schema_version` stays at **1**: `theme: Option<String>` is declared with `#[serde(default, skip_serializing_if = "Option::is_none")]`, which is a backward-compat additive change — pre-existing on-disk payloads without the field deserialize cleanly with `theme: None` and never write the key back unless the user explicitly sets a preference.

The frontend reads via the `OnboardingSlice` in the Zustand store (`src/store/index.ts`) — `refreshOnboarding()` runs `Promise.allSettled` over all status reads + `onboarding_state`, and per-section action wrappers (e.g. `installCliShim`) chain a status refresh on settle.

## Platform integration commands

6 IPC commands expose the onboarding/integration surface (registered in `src-tauri/src/lib.rs` `shared_commands!` block, typed wrappers auto-generated by `tauri-specta` into `src/lib/bindings.ts` and re-exported through the `src/lib/tauri-commands.ts` façade). All status enums are `lowercase`-serialized to keep the TS union minimal.

| Group | Commands | Behavior |
|---|---|---|
| **Onboarding** (`commands/onboarding.rs`) | `onboarding_state` | Loads the schema-versioned state above. (The legacy `onboarding_mark_welcomed` / `onboarding_should_welcome` IPCs were removed in #79 along with the welcome/setup modal flow.) |
| **CLI shim** (`commands/cli_shim.rs`) | `cli_shim_status` → `Done \| Missing \| Broken \| Unsupported`, `install_cli_shim`, `remove_cli_shim` | macOS: manages `/usr/local/bin/mdownreview` symlink into the `.app` bundle; **destructive ops refuse unless the symlink's canonical target is inside the canonical app-bundle root** (`commands/cli_shim/macos.rs::remove_at`). Windows: status detects `mdownreview-cli.exe` next to the app exe and the install dir on `HKCU\Environment\Path` via `winreg`. Iter-4 onwards, `install_cli_shim` and `remove_cli_shim` mutate the same `HKCU\Environment\Path` value (dedup-aware add / case-insensitive filter), preserve REG_EXPAND_SZ vs REG_SZ value type, and broadcast `WM_SETTINGCHANGE` for `"Environment"`. This is complementary to the NSIS install-time hook (`installer-hooks.nsh`) — both writers target the same registry key with the same dedupe contract, so reinstalling and toggling in-app never double up. **HKCU only — never HKLM, no admin elevation.** |
| **Default handler** (`commands/default_handler.rs`) | `default_handler_status` → `Done \| Other \| Unknown \| Unsupported`, `set_default_handler` | Windows: reads `HKCU\…\FileExts\.md\UserChoice\ProgId` via `winreg` and matches `mdownreview`. macOS: returns `Unknown` (programmatic `LSCopyDefaultRoleHandlerForContentType` requires `core-foundation` FFI; deferred). `set_*` always punts to the OS UI (`ms-settings:defaultapps` / `x-apple.systempreferences:com.apple.preference.general`) via `tauri-plugin-opener` — UserChoice is hash-protected since Win10 and cannot be set programmatically. |

Each command file with OS divergence follows the **platform sub-module pattern** (rule 26 in [`docs/architecture.md`](../architecture.md)): a thin parent file dispatches to `commands/<feature>/{macos,windows,unsupported}.rs`. The `Unsupported` variant on every status enum lets the UI render a neutral state on platforms where the feature doesn't apply, without `cfg!` checks in TypeScript.

## Updater is separate

> **IMPORTANT** — The minisign signature on the auto-updater bundle (see [`docs/features/updates.md`](updates.md)) is **not** an Apple codesign identity. Our updater verifies update payloads with our own signing key, which is an entirely separate trust mechanism from Apple Gatekeeper. macOS Gatekeeper still sees the app as ad-hoc signed regardless of how strong the updater signature is.

## Key source

- `site/install.sh` — macOS install script
- `site/install.ps1` — Windows install script
- `src-tauri/tauri.conf.json` — bundle config (`signingIdentity`, `externalBin`, `bundle.targets`, `bundle.windows.nsis.installerHooks`)
- `src-tauri/installer/installer-hooks.nsh` — NSIS POST/PREINSTALL macros (HKCU PATH)
- `src-tauri/src/core/onboarding.rs` — schema-versioned onboarding state (load/save on injectable path)
- `src-tauri/src/commands/{onboarding,cli_shim,default_handler}.rs` — 6 platform-integration IPC commands
- `src/store/index.ts` — `OnboardingSlice` (state + actions) consumed by SettingsView and WelcomeView
- `scripts/stage-cli.mjs` — places the CLI at `src-tauri/binaries/mdownreview-cli-<triple>` so Tauri's `externalBin` build-time check passes
- `.github/workflows/release.yml` — build pipeline + codesign verification + DMG layout verification

## Related rules

- Updater signing (minisign, separate from Apple codesign) — [`docs/features/updates.md`](updates.md).
- What the CLI does once installed — [`docs/features/cli-and-associations.md`](cli-and-associations.md).
