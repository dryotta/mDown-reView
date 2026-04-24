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

## DMG layout (macOS)

The `.dmg` ships with a custom layout (`tauri.conf.json` `bundle.macOS.dmg`): 660×400 window, app icon at (180,170), Applications symlink at (480,170), background image at `src-tauri/dmg/background.png` (placeholder ships as a flat fill until design lands a real asset). A `README.txt` is bundled at `bundle.resources` so it appears at the DMG root with the unsigned-binary unquarantine instructions. The release workflow (`.github/workflows/release.yml` "Verify DMG layout") asserts these structural expectations on every macOS build.

## NSIS installer hooks (Windows)

`tauri.conf.json` `bundle.windows.nsis.installerHooks` points at `src-tauri/installer/installer-hooks.nsh`. Two macros, **HKCU only — no UAC**:

- `NSIS_HOOK_POSTINSTALL` — uses stock NSIS (`ReadRegStr` / `WriteRegExpandStr` on `HKCU\Environment`, with a `WM_SETTINGCHANGE` broadcast) to add `$INSTDIR` to per-user `PATH`. A small private macro `MdrFilterPath` walks the `;`-separated tokens and drops any case-insensitive match of `$INSTDIR` before the new entry is appended, so re-installing on top of an existing install does not duplicate the entry. Then writes folder context-menu keys under `HKCU\Software\Classes\Directory\shell` and `Directory\Background\shell`. No NSIS plugins required (the Tauri-bundled `makensis` does not ship `EnVar`).
- `NSIS_HOOK_PREUNINSTALL` — reverses both: re-uses `MdrFilterPath` to strip `$INSTDIR` from PATH (collapses runs of `;`; `DeleteRegValue` if the result would be empty rather than writing `""`), broadcasts `WM_SETTINGCHANGE`, and `DeleteRegKey` on the two context-menu trees.

The folder context menu is *also* exposed via the `register_folder_context` IPC command (below) so the UI can offer it as an opt-in toggle independent of the installer; the two writers target identical registry paths so they're idempotent.

## Onboarding state model

First-launch and "what's new" UX is driven by a small Rust ViewModel persisted at `app_config_dir/onboarding.json` (resolved via `tauri::Manager::path().app_config_dir()`). The schema is versioned from day one:

```jsonc
{
  "schema_version": 1,                          // u32; future versions are refused
  "last_welcomed_version": "0.3.4",             // Option<String> — last app version the user was welcomed into
  "last_seen_sections": ["cli", "default-handler"]  // Vec<String> — onboarding cards already dismissed
}
```

Source: `src-tauri/src/core/onboarding.rs:10-28`. **Forward-compat refusal:** any file with `schema_version > 1`, malformed JSON, or I/O error returns `OnboardingState::default()` (a fresh state) — old binaries never blow up on a future-format file. Saves go through `core/atomic.rs::write_atomic` so a crash mid-write cannot corrupt the file (`core/onboarding.rs:48-51`).

The frontend reads via the `useOnboarding` hook (`src/lib/vm/use-onboarding.ts`) which mirrors the `useComments` shape — a single read on mount, no event subscription.

## Platform integration commands

11 IPC commands expose the iter-2 onboarding/integration surface (registered in `src-tauri/src/lib.rs:245-255`, typed wrappers in `src/lib/tauri-commands.ts:253-284`). All status enums are `lowercase`-serialized to keep the TS union minimal.

| Group | Commands | Behavior |
|---|---|---|
| **Onboarding** (`commands/onboarding.rs`) | `onboarding_state`, `onboarding_mark_welcomed(version)`, `onboarding_skip` | Load/save the state above; `_skip` is a deliberate no-op kept as the IPC chokepoint for "user dismissed". |
| **CLI shim** (`commands/cli_shim.rs`) | `cli_shim_status` → `Done \| Missing \| Broken \| Unsupported`, `install_cli_shim`, `remove_cli_shim` | macOS: manages `/usr/local/bin/mdownreview` symlink into the `.app` bundle; **destructive ops refuse unless the symlink's canonical target is inside the canonical app-bundle root** (`commands/cli_shim/macos.rs:71-82`). Windows: status only — detects `mdownreview-cli.exe` next to the app exe and the install dir on `HKCU\Environment\Path` via `winreg`; install/remove are no-ops (the NSIS hooks own PATH mutation). |
| **Default handler** (`commands/default_handler.rs`) | `default_handler_status` → `Done \| Other \| Unknown \| Unsupported`, `set_default_handler` | Windows: reads `HKCU\…\FileExts\.md\UserChoice\ProgId` via `winreg` and matches `mdownreview`. macOS: returns `Unknown` (programmatic `LSCopyDefaultRoleHandlerForContentType` requires `core-foundation` FFI; deferred). `set_*` always punts to the OS UI (`ms-settings:defaultapps` / `x-apple.systempreferences:com.apple.preference.general`) via `tauri-plugin-opener` — UserChoice is hash-protected since Win10 and cannot be set programmatically. |
| **Folder context** (`commands/folder_context.rs`) | `folder_context_status` → `Done \| Missing \| Unsupported`, `register_folder_context`, `unregister_folder_context` | Windows-only. Writes `HKCU\Software\Classes\Directory\shell\Open with mdownreview` (and the `Directory\Background\shell` twin) with the running exe path; `unregister` deletes both subtrees. Other platforms report `Unsupported`. |

Each command file with OS divergence follows the **platform sub-module pattern** (rule 26 in [`docs/architecture.md`](../architecture.md)): a thin parent file dispatches to `commands/<feature>/{macos,windows,unsupported}.rs`. The `Unsupported` variant on every status enum lets the UI render a neutral state on platforms where the feature doesn't apply, without `cfg!` checks in TypeScript.

## Updater is separate

> **IMPORTANT** — The minisign signature on the auto-updater bundle (see [`docs/features/updates.md`](updates.md)) is **not** an Apple codesign identity. Our updater verifies update payloads with our own signing key, which is an entirely separate trust mechanism from Apple Gatekeeper. macOS Gatekeeper still sees the app as ad-hoc signed regardless of how strong the updater signature is.

## Key source

- `site/install.sh` — macOS install script
- `site/install.ps1` — Windows install script
- `src-tauri/tauri.conf.json` — bundle config (`signingIdentity`, `externalBin`, `bundle.targets`, `bundle.macOS.dmg` layout, `bundle.windows.nsis.installerHooks`)
- `src-tauri/installer/installer-hooks.nsh` — NSIS POST/PREINSTALL macros (HKCU PATH + folder context menu)
- `src-tauri/dmg/` — DMG layout assets (background image placeholder, `README.txt` shipped at DMG root via `bundle.resources`)
- `src-tauri/src/core/onboarding.rs` — schema-versioned onboarding state (load/save on injectable path)
- `src-tauri/src/commands/{onboarding,cli_shim,default_handler,folder_context}.rs` — 11 platform-integration IPC commands
- `src/lib/vm/use-onboarding.ts` — read-side ViewModel for onboarding state
- `scripts/stage-cli.mjs` — places the CLI at `src-tauri/binaries/mdownreview-cli-<triple>` so Tauri's `externalBin` build-time check passes
- `.github/workflows/release.yml` — build pipeline + codesign verification + DMG layout verification

## Related rules

- Updater signing (minisign, separate from Apple codesign) — [`docs/features/updates.md`](updates.md).
- What the CLI does once installed — [`docs/features/cli-and-associations.md`](cli-and-associations.md).
